/* ============================================================
 * Footballs AI —— 多模型预测引擎
 * ①泊松(攻防强度) ②Elo ③xG代理(射正) → 集成 → 市场赔率混合
 * 与 tools/model.py 同源 (回测: 集成优于任何单一模型)
 * ============================================================ */
"use strict";

const MODEL_W = 0.4;      // 集成模型权重 (市场 0.6) —— 526 场回测优选
const HALF_FRAC = 0.4419; // 半场进球占比
const MAXG = 8;

const Fact = (() => { const f = [1]; for (let i = 1; i <= 16; i++) f[i] = f[i-1]*i; return f; })();
function pois(lmb, k) { return Math.exp(-lmb + k*Math.log(lmb)) / Fact[k]; }
function dcTau(x, y, lh, la, rho) {
  if (x === 0 && y === 0) return 1 - lh*la*rho;
  if (x === 0 && y === 1) return 1 + lh*rho;
  if (x === 1 && y === 0) return 1 + la*rho;
  if (x === 1 && y === 1) return 1 - rho;
  return 1;
}
function scoreMatrix(lh, la, rho = -0.06) {
  const m = []; let s = 0;
  for (let x = 0; x <= MAXG; x++) { m[x] = [];
    for (let y = 0; y <= MAXG; y++) { const p = pois(lh,x)*pois(la,y)*dcTau(x,y,lh,la,rho); m[x][y] = p; s += p; } }
  for (let x = 0; x <= MAXG; x++) for (let y = 0; y <= MAXG; y++) m[x][y] /= s;
  return m;
}
function impliedProbs(odds) {
  const inv = odds.map(o => 1/o); const s = inv.reduce((a,b) => a+b, 0);
  return inv.map(v => v/s);
}

/* ---------- 三模型 λ ---------- */
function modelLambdas(match, data = DATA) {
  const out = {};
  const lg = data.leagues[match.league];
  const th = lg && lg.teams[match.homeKey], ta = lg && lg.teams[match.awayKey];
  if (th && ta) {
    out.poisson = [lg.mu_h * th.poisson_att * ta.poisson_def, lg.mu_a * ta.poisson_att * th.poisson_def];
    const diff = th.elo + lg.elo_ha - ta.elo;
    const sup = lg.elo_reg_a + lg.elo_reg_b * diff;
    out.elo = [Math.max((lg.avg_total + sup)/2, 0.15), Math.max((lg.avg_total - sup)/2, 0.15)];
    const eh = lg.base_sot * th.sot_att * ta.sot_def, ea = lg.base_sot * ta.sot_att * th.sot_def;
    out.xg = [Math.max(eh * lg.conv, 0.15), Math.max(ea * lg.conv, 0.15)];
  }
  return out;
}

/* ---------- 市场反解 λ ---------- */
function solveLambdas(had, ttgOdds) {
  const target = impliedProbs(had);
  let ttTarget = null;
  if (ttgOdds && ttgOdds.length === 8) ttTarget = impliedProbs(ttgOdds);
  let best = null;
  for (let lh = 0.15; lh <= 4.6; lh += 0.05) for (let la = 0.15; la <= 4.6; la += 0.05) {
    const m = scoreMatrix(lh, la, -0.06);
    const wdl = { h: 0, d: 0, a: 0 };
    for (let x = 0; x <= MAXG; x++) for (let y = 0; y <= MAXG; y++) wdl[x>y?"h":x<y?"a":"d"] += m[x][y];
    let err = Math.abs(wdl.h-target[0]) + Math.abs(wdl.d-target[1]) + Math.abs(wdl.a-target[2]);
    if (ttTarget) { const t = new Array(8).fill(0);
      for (let x = 0; x <= MAXG; x++) for (let y = 0; y <= MAXG; y++) t[Math.min(x+y,7)] += m[x][y];
      for (let i = 0; i < 8; i++) err += Math.abs(t[i]-ttTarget[i]) * 1.5; }
    if (!best || err < best.err) best = { lh, la, err };
  }
  return best;
}

/* ---------- 完整分析 ---------- */
function analyzeMatch(match, data = DATA) {
  const lg = data.leagues[match.league];
  const rho = lg ? lg.rho : -0.06;
  const models = modelLambdas(match, data);
  const modelKeys = Object.keys(models);

  // 集成 λ
  let lhEns = null, laEns = null;
  if (modelKeys.length) {
    lhEns = modelKeys.reduce((a, k) => a + models[k][0], 0) / modelKeys.length;
    laEns = modelKeys.reduce((a, k) => a + models[k][1], 0) / modelKeys.length;
  }
  // 市场 λ
  let mkt = null;
  if (match.odds && Array.isArray(match.odds.had) && match.odds.had.every(o => o > 1)) mkt = solveLambdas(match.odds.had, match.odds.ttg);
  // 混合
  let lh, la, lambdaSource;
  if (lhEns !== null && mkt) { lh = MODEL_W*lhEns + (1-MODEL_W)*mkt.lh; la = MODEL_W*laEns + (1-MODEL_W)*mkt.la; lambdaSource = "blend"; }
  else if (mkt) { lh = mkt.lh; la = mkt.la; lambdaSource = "market"; }
  else if (lhEns !== null) { lh = lhEns; la = laEns; lambdaSource = "ensemble"; }
  else { lh = 1.35; la = 1.15; lambdaSource = "default"; }

  const m = scoreMatrix(lh, la, rho);
  const mkts = marketsFromMatrix(m, lh, la, match.hline);

  // 各模型方向 (一致性)
  const modelPicks = {};
  let agreeCount = 0;
  if (modelKeys.length) {
    const keys = ["h", "d", "a"];
    for (const k of modelKeys) {
      const mm = scoreMatrix(models[k][0], models[k][1], rho);
      const w = { h: 0, d: 0, a: 0 };
      for (let x = 0; x <= MAXG; x++) for (let y = 0; y <= MAXG; y++) w[x>y?"h":x<y?"a":"d"] += mm[x][y];
      const pick = keys.reduce((a, b) => (w[b] > w[a] ? b : a), "h");
      modelPicks[k] = { pick, probs: w };
      if (pick === mkts.wdlPick) agreeCount++;
    }
  }

  // 数据质量
  let quality, qf;
  if (modelKeys.length === 3) { quality = "高"; qf = 1.0; }
  else if (modelKeys.length > 0) { quality = "中"; qf = 0.75; }
  else { quality = "低"; qf = 0.5; }

  // 价值 + 分歧
  const value = [];
  if (match.odds && Array.isArray(match.odds.had) && match.odds.had.every(o => o > 1)) {
    const imp = impliedProbs(match.odds.had);
    [["h","主胜"],["d","平局"],["a","客胜"]].forEach(([k, name], i) => {
      const o = match.odds.had[i];
      if (o > 1) value.push({ market: "胜平负", pick: name, p: mkts.wdl[k], odds: o, ev: mkts.wdl[k]*o - 1, div: mkts.wdl[k] - imp[i] });
    });
  }
  if (match.odds && Array.isArray(match.odds.hhad) && match.hline !== null && match.odds.hhad.every(o => o > 1)) {
    const imp = impliedProbs(match.odds.hhad);
    [["h","让球主胜"],["d","让球平"],["a","让球客胜"]].forEach(([k, name], i) => {
      const o = match.odds.hhad[i];
      if (o > 1) value.push({ market: `让球(${match.hline>0?"+":""}${match.hline})`, pick: name, p: mkts.hcp[k], odds: o, ev: mkts.hcp[k]*o - 1, div: mkts.hcp[k] - imp[i] });
    });
  }
  let divergence = null;
  if (lhEns !== null && mkt) {
    const mm = scoreMatrix(lhEns, laEns, rho);
    const pure = marketsFromMatrix(mm, lhEns, laEns).wdl;
    const imp = impliedProbs(match.odds.had);
    divergence = { h: pure.h-imp[0], d: pure.d-imp[1], a: pure.a-imp[2],
      max: Math.max(Math.abs(pure.h-imp[0]), Math.abs(pure.d-imp[1]), Math.abs(pure.a-imp[2])) };
  }
  // 风险等级
  const conf = Math.max(mkts.wdl.h, mkts.wdl.d, mkts.wdl.a);
  const divMax = divergence ? divergence.max : 0.12;
  const risk = conf >= 0.55 && divMax < 0.06 ? "低" : conf >= 0.45 && divMax < 0.11 ? "中" : "高";
  const riskF = risk === "低" ? 1.0 : risk === "中" ? 0.85 : 0.7;

  // 研究评分 (TOP5 排序)
  const researchScore = conf * qf * riskF * (modelKeys.length ? (0.8 + 0.2*agreeCount/modelKeys.length) : 0.8);

  return { lh, la, lhEns, laEns, mkt, models, modelKeys, modelPicks, lambdaSource, rho,
    mkts, value, divergence, quality, qf, risk, conf, researchScore };
}

/* ---------- 玩法概率 ---------- */
function marketsFromMatrix(m, lh, la, hline) {
  const wdl = { h: 0, d: 0, a: 0 };
  let btts = 0, ou25 = 0;
  const ttg = new Array(8).fill(0);
  const hf = {};
  for (const a of ["胜","平","负"]) for (const b of ["胜","平","负"]) hf[a+b] = 0;
  const lh1 = lh*HALF_FRAC, la1 = la*HALF_FRAC, lh2 = lh-lh1, la2 = la-la1;
  for (let x = 0; x <= MAXG; x++) for (let y = 0; y <= MAXG; y++) {
    const p = m[x][y];
    wdl[x > y ? "h" : x < y ? "a" : "d"] += p;
    ttg[Math.min(x+y, 7)] += p;
    if (x > 0 && y > 0) btts += p;
    if (x + y > 2.5) ou25 += p;
  }
  for (let x1 = 0; x1 <= 5; x1++) for (let y1 = 0; y1 <= 5; y1++) {
    const p1 = pois(lh1, x1)*pois(la1, y1);
    for (let x2 = 0; x2 <= 5; x2++) for (let y2 = 0; y2 <= 5; y2++) {
      const p2 = pois(lh2, x2)*pois(la2, y2);
      const ht = x1 > y1 ? "胜" : x1 < y1 ? "负" : "平";
      const ft = (x1+x2) > (y1+y2) ? "胜" : (x1+x2) < (y1+y2) ? "负" : "平";
      hf[ht+ft] += p1*p2;
    }
  }
  const hcp = { h: 0, d: 0, a: 0 };
  if (hline !== null && hline !== undefined) {
    for (let x = 0; x <= MAXG; x++) for (let y = 0; y <= MAXG; y++) {
      const adj = x + hline - y;
      hcp[adj > 0 ? "h" : adj < 0 ? "a" : "d"] += m[x][y];
    }
  }
  const scores = [];
  for (let x = 0; x <= MAXG; x++) for (let y = 0; y <= MAXG; y++) scores.push({ s: x+"-"+y, x, y, p: m[x][y] });
  scores.sort((a, b) => b.p - a.p);
  const wdlPick = ["h","d","a"].reduce((a, b) => (wdl[b] > wdl[a] ? b : a), "h");
  const bands = [
    ttg[0]+ttg[1], ttg[2]+ttg[3], ttg[4]+ttg[5]+ttg[6], ttg[7],
  ];
  return { wdl, wdlPick, hcp, ttg, hf, btts, ou25, scores, matrix: m, bands };
}

/* ---------- 串关 ---------- */
function comboSchemes(candidates) {
  const byP = [...candidates].sort((a, b) => b.p - a.p);
  const byEv = [...candidates].filter(c => c.ev > 0).sort((a, b) => b.ev - a.ev);
  const schemes = [];
  for (const n of [2, 3, 4, 5]) {
    if (byP.length < n) break;
    const legs = byP.slice(0, n);
    const jointP = legs.reduce((a, l) => a*l.p, 1);
    const jointOdds = legs.reduce((a, l) => a*l.odds, 1);
    const ev = jointP*jointOdds - 1;
    schemes.push({ type: `${n}串1`, style: "稳健", legs, jointP, jointOdds, ev, kelly: Math.max(0, ev/(jointOdds-1)) });
    if (byEv.length >= n) {
      const legs2 = byEv.slice(0, n);
      const jp = legs2.reduce((a, l) => a*l.p, 1);
      const jo = legs2.reduce((a, l) => a*l.odds, 1);
      const e2 = jp*jo - 1;
      schemes.push({ type: `${n}串1`, style: "价值", legs: legs2, jointP: jp, jointOdds: jo, ev: e2, kelly: Math.max(0, e2/(jo-1)) });
    }
  }
  return schemes;
}

/* ---------- 评分 ---------- */
function gradePrediction(pred, hg, ag) {
  const actual = hg > ag ? "h" : hg < ag ? "a" : "d";
  const total = Math.min(hg + ag, 7);
  const band = total <= 1 ? 0 : total <= 3 ? 1 : total <= 6 ? 2 : 3;
  return {
    dirHit: pred.pick === actual,
    bandHit: pred.band === band,
    scoreTop3: pred.top3.some(s => s.x === hg && s.y === ag),
    scoreTop5: pred.top5.some(s => s.x === hg && s.y === ag),
    brier: ["h","d","a"].reduce((a, k) => a + Math.pow((pred.probs[k]||0) - (k===actual?1:0), 2), 0),
  };
}

const fmtP = p => (p*100).toFixed(1) + "%";
const fmtO = o => o >= 100 ? o.toFixed(0) : o.toFixed(2);
