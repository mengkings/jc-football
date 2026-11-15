/* ============================================================
 * 竞彩智算 —— 预测引擎
 * 泊松模型 + Dixon-Coles 低比分修正 + 市场赔率混合
 * 与 tools/model.py 保持一致 (回测验证过的同一套数学)
 * ============================================================ */
"use strict";

const MODEL_W = 0.4;   // 模型权重 (市场权重 1-W) —— 回测最优混合比
const HALF_FRAC = 0.4419; // 半场进球占全场比例 (五大联赛实测)
const MAXG = 8;

/* ---------- 基础数学 ---------- */
const Fact = (() => { const f = [1]; for (let i = 1; i <= 16; i++) f[i] = f[i-1]*i; return f; })();
function pois(lmb, k) { return Math.exp(-lmb + k*Math.log(lmb)) / Fact[k]; }

function dcTau(x, y, lh, la, rho) {
  if (x === 0 && y === 0) return 1 - lh*la*rho;
  if (x === 0 && y === 1) return 1 + lh*rho;
  if (x === 1 && y === 0) return 1 + la*rho;
  if (x === 1 && y === 1) return 1 - rho;
  return 1;
}

/** 比分概率矩阵 m[x][y] (x=主队进球) */
function scoreMatrix(lh, la, rho = -0.06) {
  const m = [];
  let s = 0;
  for (let x = 0; x <= MAXG; x++) {
    m[x] = [];
    for (let y = 0; y <= MAXG; y++) {
      const p = pois(lh, x) * pois(la, y) * dcTau(x, y, lh, la, rho);
      m[x][y] = p; s += p;
    }
  }
  for (let x = 0; x <= MAXG; x++) for (let y = 0; y <= MAXG; y++) m[x][y] /= s;
  return m;
}

/** 从矩阵提取各类玩法概率 */
function marketsFromMatrix(m, lh, la, hline) {
  const wdl = { h: 0, d: 0, a: 0 };
  let btts = 0, ou25 = 0;
  const ttg = new Array(8).fill(0);       // 总进球 0..6, 7+
  const hf = {};                          // 半全场
  const HTR = ["胜", "平", "负"], FTR = ["胜", "平", "负"];
  for (const a of HTR) for (const b of FTR) hf[a+b] = 0;
  const lh1 = lh*HALF_FRAC, la1 = la*HALF_FRAC, lh2 = lh-lh1, la2 = la-la1;

  for (let x = 0; x <= MAXG; x++) for (let y = 0; y <= MAXG; y++) {
    const p = m[x][y];
    wdl[x > y ? "h" : x < y ? "a" : "d"] += p;
    ttg[Math.min(x+y, 7)] += p;
    if (x > 0 && y > 0) btts += p;
    if (x + y > 2.5) ou25 += p;
  }
  // 半全场: 上半场泊松 + 下半场泊松
  for (let x1 = 0; x1 <= 5; x1++) for (let y1 = 0; y1 <= 5; y1++) {
    const p1 = pois(lh1, x1)*pois(la1, y1);
    for (let x2 = 0; x2 <= 5; x2++) for (let y2 = 0; y2 <= 5; y2++) {
      const p2 = pois(lh2, x2)*pois(la2, y2);
      const ht = x1 > y1 ? "胜" : x1 < y1 ? "负" : "平";
      const ft = (x1+x2) > (y1+y2) ? "胜" : (x1+x2) < (y1+y2) ? "负" : "平";
      hf[ht+ft] += p1*p2;
    }
  }
  // 让球胜平负
  const hcp = { h: 0, d: 0, a: 0 };
  if (hline !== undefined && hline !== null) {
    for (let x = 0; x <= MAXG; x++) for (let y = 0; y <= MAXG; y++) {
      const adj = x + hline - y;
      hcp[adj > 0 ? "h" : adj < 0 ? "a" : "d"] += m[x][y];
    }
  }
  // 比分排序
  const scores = [];
  for (let x = 0; x <= MAXG; x++) for (let y = 0; y <= MAXG; y++) scores.push({ s: x+"-"+y, x, y, p: m[x][y] });
  scores.sort((a, b) => b.p - a.p);

  return { wdl, hcp, ttg, hf, btts, ou25, scores, matrix: m };
}

/* ---------- 赔率工具 ---------- */
/** 赔率 → 去水概率 */
function impliedProbs(odds) {
  const inv = odds.map(o => 1/o);
  const s = inv.reduce((a, b) => a + b, 0);
  return inv.map(v => v/s);
}
function marginOf(odds) { return odds.reduce((a, o) => a + 1/o, 0) - 1; }

/** 由市场赔率反解期望进球 (胜平负 + 可选总进球赔率) */
function solveLambdas(had, ttgOdds) {
  const target = impliedProbs(had); // [H, D, A]
  let ttTarget = null;
  if (ttgOdds && ttgOdds.length === 8) ttTarget = impliedProbs(ttgOdds);
  let best = null;
  for (let lh = 0.15; lh <= 4.6; lh += 0.05) {
    for (let la = 0.15; la <= 4.6; la += 0.05) {
      const m = scoreMatrix(lh, la, -0.06);
      const wdl = { h: 0, d: 0, a: 0 };
      for (let x = 0; x <= MAXG; x++) for (let y = 0; y <= MAXG; y++)
        wdl[x > y ? "h" : x < y ? "a" : "d"] += m[x][y];
      let err = Math.abs(wdl.h - target[0]) + Math.abs(wdl.d - target[1]) + Math.abs(wdl.a - target[2]);
      if (ttTarget) {
        const t = new Array(8).fill(0);
        for (let x = 0; x <= MAXG; x++) for (let y = 0; y <= MAXG; y++) t[Math.min(x+y,7)] += m[x][y];
        for (let i = 0; i < 8; i++) err += Math.abs(t[i] - ttTarget[i]) * 1.5;
      }
      if (!best || err < best.err) best = { lh, la, err };
    }
  }
  return best;
}

/* ---------- 单场完整分析 ---------- */
function analyzeMatch(match, ratings = RATINGS) {
  // 1) 模型 λ
  let lhModel = null, laModel = null, leagueInfo = null;
  const lg = ratings.leagues[match.league];
  if (lg && lg.teams[match.homeKey] && lg.teams[match.awayKey]) {
    const th = lg.teams[match.homeKey], ta = lg.teams[match.awayKey];
    lhModel = lg.mu_h * th.att * ta.def;
    laModel = lg.mu_a * ta.att * th.def;
    leagueInfo = lg;
  } else if (match.customLambda) {
    lhModel = match.customLambda.lh; laModel = match.customLambda.la;
  }
  // 2) 市场 λ
  let lhMkt = null, laMkt = null, mktSolved = null;
  if (match.odds && match.odds.had && match.odds.had.every(o => o > 1)) {
    mktSolved = solveLambdas(match.odds.had, match.odds.ttg);
    lhMkt = mktSolved.lh; laMkt = mktSolved.la;
  }
  // 3) 混合 λ
  let lh, la, lambdaSource;
  if (lhModel !== null && lhMkt !== null) {
    lh = MODEL_W*lhModel + (1-MODEL_W)*lhMkt;
    la = MODEL_W*laModel + (1-MODEL_W)*laMkt;
    lambdaSource = "blend";
  } else if (lhMkt !== null) {
    lh = lhMkt; la = laMkt; lambdaSource = "market";
  } else if (lhModel !== null) {
    lh = lhModel; la = laModel; lambdaSource = "model";
  } else {
    lh = 1.35; la = 1.15; lambdaSource = "default";
  }
  const rho = leagueInfo ? leagueInfo.rho : -0.06;
  const m = scoreMatrix(lh, la, rho);
  const mkts = marketsFromMatrix(m, lh, la, match.odds && match.odds.hadLine !== undefined ? match.odds.hadLine : (match.hline ?? null));

  // 4) 价值分析 (有赔率时)
  const value = [];
  if (match.odds && match.odds.had) {
    const imp = impliedProbs(match.odds.had);
    [["h","主胜"],["d","平局"],["a","客胜"]].forEach(([k, name], i) => {
      const p = mkts.wdl[k], o = match.odds.had[i];
      if (o > 1) value.push({ market: "胜平负", pick: name, p, odds: o, ev: p*o - 1, div: p - imp[i] });
    });
  }
  if (match.odds && match.odds.hhad && match.odds.hline !== undefined) {
    const imp = impliedProbs(match.odds.hhad);
    [["h","让球主胜"],["d","让球平"],["a","让球客胜"]].forEach(([k, name], i) => {
      const p = mkts.hcp[k], o = match.odds.hhad[i];
      if (o > 1) value.push({ market: `让球(${match.odds.hline>0?"+":""}${match.odds.hline})`, pick: name, p, odds: o, ev: p*o - 1, div: p - imp[i] });
    });
  }
  // 风险分歧: 模型(纯)与市场概率的最大偏差
  let divergence = null;
  if (lhModel !== null && lhMkt !== null) {
    const mm = scoreMatrix(lhModel, laModel, rho);
    const pure = marketsFromMatrix(mm, lhModel, laModel).wdl;
    const imp = impliedProbs(match.odds.had);
    divergence = {
      h: pure.h - imp[0], d: pure.d - imp[1], a: pure.a - imp[2],
      max: Math.max(Math.abs(pure.h-imp[0]), Math.abs(pure.d-imp[1]), Math.abs(pure.a-imp[2])),
    };
  }
  return { lh, la, lhModel, laModel, lhMkt, laMkt, lambdaSource, rho, mkts, value, divergence, mktSolved };
}

/* ---------- 串关 ---------- */
function comboSchemes(candidates) {
  // candidates: [{matchId, label, pick, market, p, odds}]
  const byP = [...candidates].sort((a, b) => b.p - a.p);
  const byEv = [...candidates].filter(c => c.ev > 0).sort((a, b) => b.ev - a.ev);
  const schemes = [];
  for (const n of [2, 3, 4, 5]) {
    if (byP.length < n) break;
    const legs = byP.slice(0, n);
    const jointP = legs.reduce((a, l) => a * l.p, 1);
    const jointOdds = legs.reduce((a, l) => a * l.odds, 1);
    const ev = jointP * jointOdds - 1;
    schemes.push({
      type: `${n}串1`, style: "稳健", legs,
      jointP, jointOdds, ev,
      payout: jointOdds, // 每注 1 元
      kelly: Math.max(0, ev / (jointOdds - 1)),
    });
    if (byEv.length >= n) {
      const legs2 = byEv.slice(0, n);
      const jp = legs2.reduce((a, l) => a * l.p, 1);
      const jo = legs2.reduce((a, l) => a * l.odds, 1);
      const e2 = jp * jo - 1;
      schemes.push({ type: `${n}串1`, style: "价值", legs: legs2, jointP: jp, jointOdds: jo, ev: e2, payout: jo, kelly: Math.max(0, e2/(jo-1)) });
    }
  }
  return schemes;
}

/* ---------- 历史校准 ---------- */
function gradePrediction(pred, homeGoals, awayGoals) {
  const actual = homeGoals > awayGoals ? "h" : homeGoals < awayGoals ? "a" : "d";
  const total = Math.min(homeGoals + awayGoals, 7);
  const band = total <= 1 ? 0 : total <= 3 ? 1 : total <= 6 ? 2 : 3;
  return {
    dirHit: pred.pick === actual,
    bandHit: pred.band === band,
    scoreTop3: pred.top3.some(s => s.x === homeGoals && s.y === awayGoals),
    scoreTop5: pred.top5.some(s => s.x === homeGoals && s.y === awayGoals),
    brier: ["h","d","a"].reduce((a, k) => a + Math.pow((pred.probs[k] || 0) - (k === actual ? 1 : 0), 2), 0),
  };
}

/* 工具 */
const fmtP = p => (p*100).toFixed(1) + "%";
const fmtO = o => o >= 100 ? o.toFixed(0) : o.toFixed(2);
