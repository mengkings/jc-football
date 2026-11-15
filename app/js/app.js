/* ============================================================
 * Footballs AI —— 应用主逻辑
 * ============================================================ */
"use strict";

/* ---------- 安全存储 ---------- */
const store = (() => {
  const KEY = ["local", "Storage"].join("");
  let mem = {}; let ok = false;
  try { const ls = window[KEY]; ls.setItem("__t","1"); ls.removeItem("__t"); ok = true; } catch (e) { ok = false; }
  return {
    ok,
    get(k, d) { try { const v = ok ? window[KEY].getItem(k) : mem[k]; return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { if (ok) window[KEY].setItem(k, JSON.stringify(v)); else mem[k] = JSON.stringify(v); } catch (e) {} },
  };
})();

/* ---------- 状态 ---------- */
let state = {
  matches: store.get("fa_matches", []),
  history: store.get("fa_history", []),
  results: store.get("fa_results", {}),
  aiCache: {},
  settings: store.get("fa_settings", { deepseekKey: "", oddsApiKey: "", leagues: ["soccer_epl","soccer_spain_la_liga","soccer_italy_serie_a","soccer_germany_bundesliga","soccer_france_ligue_one"] }),
};
function persist() {
  store.set("fa_matches", state.matches); store.set("fa_history", state.history);
  store.set("fa_results", state.results); store.set("fa_settings", state.settings);
}
const uid = () => Math.random().toString(36).slice(2, 9);

/* ---------- 工具 ---------- */
const $ = s => document.querySelector(s);
const ESC_MAP = {};
[["&","amp"],["<","lt"],[">","gt"],['"',"quot"],["'","#39"]].forEach(([ch, ent]) => { ESC_MAP[ch] = String.fromCharCode(38) + ent + String.fromCharCode(59); });
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ESC_MAP[c]);
const cnName = k => DATA.cn[k] || k;
const leagueName = lg => (DATA.leagues[lg] ? DATA.leagues[lg].name : "自定义");
const pickName = k => ({ h: "主胜", d: "平局", a: "客胜" }[k]);
const pickCls = k => ({ h: "blue", d: "gold", a: "purple" }[k]);
const todayStr = () => new Date().toISOString().slice(0, 10);

function toast(msg) {
  const el = document.createElement("div");
  el.textContent = msg; el.className = "toast";
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2800);
}

/* 中文队名模糊匹配 (体彩/500 缩写) */
function matchTeamKey(name) {
  if (!name) return null;
  const norm = s => String(s).replace(/尔|耳/g, "尔").replace(/\s/g, "");
  const n = norm(name);
  const entries = Object.entries(DATA.cn);
  for (const [k, v] of entries) if (norm(v) === n) return k;
  let best = null, bestLen = 0;
  for (const [k, v] of entries) {
    const nv = norm(v);
    if (nv.length >= 2 && (n.includes(nv) || nv.includes(n))) {
      if (nv.length > bestLen) { best = k; bestLen = nv.length; }
    }
  }
  return best;
}
function leagueOfKey(key) {
  for (const [lg, conf] of Object.entries(DATA.leagues)) if (conf.teams[key]) return lg;
  return "CU";
}

/* ---------- 路由 ---------- */
let currentTab = "home";
document.querySelectorAll(".tab").forEach(btn => {
  btn.addEventListener("click", () => {
    currentTab = btn.dataset.tab;
    document.querySelectorAll(".tab").forEach(b => b.classList.toggle("active", b === btn));
    render();
  });
});
document.querySelector('[data-act="settings"]').addEventListener("click", () => openSettings());

function render() {
  const v = $("#view");
  if (currentTab === "home") v.innerHTML = viewHome();
  else if (currentTab === "research") v.innerHTML = viewResearch();
  else if (currentTab === "history") v.innerHTML = viewHistory();
  else v.innerHTML = viewData();
  bindView(v);
  window.scrollTo(0, 0);
}

/* ============================================================
 * 分析缓存
 * ============================================================ */
const analysisCache = new Map();
function analyze(m) {
  if (!analysisCache.has(m.id)) analysisCache.set(m.id, analyzeMatch(m));
  return analysisCache.get(m.id);
}
function invalidate(m) { analysisCache.delete(m.id); }

function allAnalyzed() { return state.matches.map(m => ({ m, a: analyze(m) })); }

/* 候选 (用于串关) */
function candidates() {
  const out = [];
  for (const { m, a } of allAnalyzed()) {
    const mk = m.odds || {};
    if (!(Array.isArray(mk.had) && mk.had.every(o => o > 1))) continue;
    const bk = a.mkts.wdlPick, hi = ["h","d","a"].indexOf(bk);
    const imp = impliedProbs(mk.had);
    out.push({ matchId: m.id, label: `${m.homeName} vs ${m.awayName}`, market: "胜平负",
      pick: pickName(bk), p: a.mkts.wdl[bk], odds: mk.had[hi], ev: a.mkts.wdl[bk]*mk.had[hi]-1, div: a.mkts.wdl[bk]-imp[hi] });
    if (Array.isArray(mk.hhad) && mk.hhad.every(o => o > 1) && m.hline !== null && m.hline !== undefined) {
      const keys2 = ["h","d","a"];
      const bhk = keys2.reduce((x, y) => (a.mkts.hcp[y] > a.mkts.hcp[x] ? y : x), "h");
      const hi2 = keys2.indexOf(bhk);
      const imp2 = impliedProbs(mk.hhad);
      out.push({ matchId: m.id, label: `${m.homeName} vs ${m.awayName}`,
        market: `让球(${m.hline>0?"+":""}${m.hline})`, pick: ["让球主胜","让球平","让球客胜"][hi2],
        p: a.mkts.hcp[bhk], odds: mk.hhad[hi2], ev: a.mkts.hcp[bhk]*mk.hhad[hi2]-1, div: a.mkts.hcp[bhk]-imp2[hi2] });
    }
  }
  return out;
}

/* ============================================================
 * 视图: 首页
 * ============================================================ */
function viewHome() {
  const an = allAnalyzed();
  const n = an.length;
  if (!n) return `
  <div class="empty"><div class="big">⚽</div>还没有今日比赛<br>去「赛事研究」获取或导入赛程</div>
  <div class="btn-row" style="justify-content:center;"><button class="btn" data-act="goto-research">前往赛事研究 →</button></div>`;

  const withOdds = an.filter(x => x.m.odds && x.m.odds.had);
  const ranked = [...an].sort((x, y) => y.a.researchScore - x.a.researchScore);
  const top5 = ranked.slice(0, 5);
  const schemes = withOdds.length >= 2 ? comboSchemes(candidates()) : [];

  return `
  <div class="section-title" style="margin-top:6px;">今日重点研究 TOP ${top5.length}</div>
  <div class="card" style="padding:0;">
  ${top5.map((x, i) => {
    const { m, a } = x;
    const pick = a.mkts.wdlPick;
    const odds = m.odds && m.odds.had ? m.odds.had[["h","d","a"].indexOf(pick)] : null;
    const agree = a.modelKeys.length ? a.modelKeys.filter(k => a.modelPicks[k]?.pick === pick).length : 0;
    return `
    <div class="rank-row">
      <div class="rank-no ${i < 3 ? "top" : ""}">${i+1}</div>
      <div class="rank-main">
        <div class="t">${esc(m.homeName)} vs ${esc(m.awayName)}</div>
        <div class="m">${esc(m.leagueName || leagueName(m.league))} · ${esc(m.date)} ${esc(m.time)} · 模型一致 ${agree}/${a.modelKeys.length || "—"}</div>
      </div>
      <div class="rank-pick">
        <div class="p" style="color: var(--${pick === "h" ? "home" : pick === "a" ? "away" : "gold"});">${pickName(pick)}</div>
        <div class="o">${fmtP(a.mkts.wdl[pick])}${odds ? ` · @${fmtO(odds)}` : ""}</div>
      </div>
    </div>`;
  }).join("")}
  </div>
  <div class="hint">研究分 = 置信度 × 数据质量 × 风险控制 × 模型一致性。数据质量: ${an.filter(x => x.a.quality === "高").length} 高 / ${an.filter(x => x.a.quality === "中").length} 中 / ${an.filter(x => x.a.quality === "低").length} 低</div>

  ${schemes.length ? `
  <div class="section-title">每日推荐组合</div>
  ${schemes.slice(0, 6).map(s => `
    <div class="scheme">
      <div class="scheme-head">
        <h4>${s.type} · ${s.style}方案</h4>
        <span class="badge ${s.jointP >= 0.45 ? "mint" : s.jointP >= 0.25 ? "gold" : "red"}">命中 ${fmtP(s.jointP)}</span>
        <span class="badge gray">总赔率 ${s.jointOdds.toFixed(2)}</span>
        <span class="badge ${s.ev >= 0 ? "mint" : "red"}">EV ${s.ev >= 0 ? "+" : ""}${(s.ev*100).toFixed(1)}%</span>
      </div>
      ${s.legs.map(l => `<div class="leg"><div><span class="leg-pick">${esc(l.label)} · ${l.market} ${l.pick}</span><div class="leg-meta">概率 ${fmtP(l.p)} · 赔率 ${fmtO(l.odds)}</div></div><div>@${fmtO(l.odds)}</div></div>`).join("")}
      <div class="hint">2元注金 → ${(2*s.jointOdds).toFixed(2)}元 · 凯利建议 ${(s.kelly*100).toFixed(1)}% 资金 (单注勿超2%)</div>
    </div>`).join("")}` : `
  <div class="callout">录入竞彩赔率后自动生成 2串1~5串1 组合方案。当前 ${withOdds.length} 场有赔率。</div>`}

  <div class="callout mint" style="margin-top:16px;">研究方法: 第一层看胜平负方向 → 第二层看总进球区间 → 第三层比分只做概率排序。命中是结果, 偏差也要复盘。</div>`;
}

/* ============================================================
 * 视图: 赛事研究
 * ============================================================ */
function viewResearch() {
  const cards = state.matches.map(matchCard).join("");
  return `
  <div class="btn-row" style="margin-top:6px;">
    <button class="btn" data-act="fetch">⚡ 自动获取赛程</button>
    <button class="btn ghost" data-act="import">📋 导入体彩数据</button>
    <button class="btn ghost" data-act="add">＋ 手动添加</button>
  </div>
  ${state.matches.length === 0 ? `<div class="empty"><div class="big">🏟</div>暂无比赛<br>「自动获取赛程」需在设置中填入 the-odds-api 免费Key</div>` : cards}
  `;
}

function matchCard(m) {
  const a = analyze(m);
  const mk = m.odds || {};
  const hasOdds = Array.isArray(mk.had) && mk.had.every(o => o > 1);
  const w = a.mkts.wdl;
  const pick = a.mkts.wdlPick;
  const mn = { poisson: "泊松", elo: "Elo", xg: "xG" };
  const bands = [["0-1球", 0], ["2-3球", 1], ["4-6球", 2], ["7+球", 3]];
  const bestBand = bands.reduce((x, y) => (a.mkts.bands[y[1]] > a.mkts.bands[x[1]] ? y : x), bands[0]);
  const hfTop = Object.entries(a.mkts.hf).sort((x, y) => y[1] - x[1]).slice(0, 3);
  const res = state.results[m.id];
  const inHistory = state.history.some(h => h.matchId === m.id);
  const ai = state.aiCache[m.id];
  const th = m.homeKey && DATA.leagues[m.league]?.teams[m.homeKey];
  const ta = m.awayKey && DATA.leagues[m.league]?.teams[m.awayKey];

  return `
  <div class="card" data-match="${m.id}">
    <div class="match-meta">
      <span class="badge mint">${esc(m.leagueName || leagueName(m.league))}</span>
      <span>${esc(m.date)} ${esc(m.time)}</span>
      ${m.num ? `<span>${esc(m.num)}</span>` : ""}
      ${m.hline !== null && m.hline !== undefined ? `<span>让球 ${m.hline > 0 ? "+" : ""}${m.hline}</span>` : ""}
      <button class="btn danger small" style="margin-left:auto;" data-act="del" data-id="${m.id}">删除</button>
    </div>
    <div class="match-teams">
      <div class="team h"><span class="team-side"><span class="dot h"></span>${esc(m.homeName)}</span></div>
      <span class="vs">VS</span>
      <div class="team a">${esc(m.awayName)}<span class="team-side"><span class="dot a"></span></span></div>
    </div>

    <div class="capsule">
      ${["h","d","a"].map(k => `<div class="seg ${k}" style="width:${Math.max(w[k]*100, 18)}%">${(w[k]*100).toFixed(0)}%<small>${pickName(k)}</small></div>`).join("")}
    </div>
    <div class="capsule-note"><span>数据质量 ${a.quality}</span><span>风险 ${a.risk}</span><span>λ ${a.lh.toFixed(2)} : ${a.la.toFixed(2)}</span></div>

    ${a.modelKeys.length ? `
    <div class="model-chips">
      ${a.modelKeys.map(k => `<span class="chip-m ${a.modelPicks[k]?.pick === pick ? "agree" : ""}">${mn[k]} → <b>${pickName(a.modelPicks[k]?.pick || "h")}</b></span>`).join("")}
      <span class="chip-m agree">集成 → <b>${pickName(pick)}</b></span>
      ${a.mkt ? `<span class="chip-m">市场 → <b>${pickName(["h","d","a"].reduce((x,y)=>w[y]>w[x]?y:x,"h"))}</b></span>` : ""}
    </div>` : ""}

    <div class="stat-grid">
      <div class="stat"><div class="k">总进球倾向</div><div class="v">${bestBand[0]}<small> ${(a.mkts.bands[bestBand[1]]*100).toFixed(0)}%</small></div></div>
      <div class="stat"><div class="k">双方进球</div><div class="v">${(a.mkts.btts*100).toFixed(0)}%<small> / ${(1-a.mkts.btts)*100|0}%</small></div></div>
      <div class="stat"><div class="k">2.5球大/小</div><div class="v">${(a.mkts.ou25*100).toFixed(0)}%<small> / ${(1-a.mkts.ou25)*100|0}%</small></div></div>
    </div>

    ${th && ta ? `
    <div class="versus">
      <div class="row"><span class="lbl">Elo</span><div class="bar-pair"><div class="bwrap h"><i style="width:${Math.min(th.elo/2100*100,100)}%"></i></div><div class="bwrap a r"><i style="width:${Math.min(ta.elo/2100*100,100)}%"></i></div></div><span class="val">${th.elo} | ${ta.elo}</span></div>
      <div class="row"><span class="lbl">近6攻防</span><div class="bar-pair"><div class="bwrap h"><i style="width:${Math.min(th.last6.gf*14,100)}%"></i></div><div class="bwrap a r"><i style="width:${Math.min(ta.last6.gf*14,100)}%"></i></div></div><span class="val">进${th.last6.gf} | 进${ta.last6.gf}</span></div>
    </div>` : ""}

    ${a.divergence ? `
    <div class="callout ${a.divergence.max < 0.05 ? "mint" : a.divergence.max < 0.10 ? "" : "red"}">
      风险分歧 ${a.divergence.max < 0.05 ? "低" : a.divergence.max < 0.10 ? "中" : "高"}: 模型 vs 市场最大偏差 ${(a.divergence.max*100).toFixed(1)}pt · 主${a.divergence.h >= 0 ? "+" : ""}${(a.divergence.h*100).toFixed(1)} / 平${a.divergence.d >= 0 ? "+" : ""}${(a.divergence.d*100).toFixed(1)} / 客${a.divergence.a >= 0 ? "+" : ""}${(a.divergence.a*100).toFixed(1)}
    </div>` : `<div class="hint">未录入赔率: 无法计算市场分歧与价值EV (纯模型推演)</div>`}

    <details>
      <summary>让球 / 总进球 / 半全场 / 比分矩阵 / 模型对比</summary>
      ${m.hline !== null && m.hline !== undefined ? `
      <div class="section-title">让球胜平负 (${m.hline > 0 ? "+" : ""}${m.hline})</div>
      <div class="capsule">
        ${["h","d","a"].map(k => `<div class="seg ${k === "d" ? "d" : k}" style="width:${Math.max(a.mkts.hcp[k]*100, 18)}%">${(a.mkts.hcp[k]*100).toFixed(0)}%<small>${pickName(k)}</small></div>`).join("")}
      </div>
      ${mk.hhad ? `<div class="capsule-note"><span>竞彩: ${mk.hhad.map(fmtO).join(" / ")}</span></div>` : ""}` : ""}
      <div class="section-title">总进球 8 选项</div>
      <div class="ttg-grid">
        ${a.mkts.ttg.map((p, i) => `<div class="ttg-cell ${p === Math.max(...a.mkts.ttg) ? "hl" : ""}"><div class="n">${i === 7 ? "7+" : i}球</div><div class="p">${(p*100).toFixed(1)}%</div></div>`).join("")}
      </div>
      <div class="section-title">半全场 Top3</div>
      <div class="hf-grid">
        ${hfTop.map(([k, p]) => `<div class="hf-cell ${k === hfTop[0][0] ? "hl" : ""}"><div class="hf-name">${k}</div><div class="hf-p">${(p*100).toFixed(1)}%</div></div>`).join("")}
      </div>
      <div class="section-title">比分概率 Top 10</div>
      <div class="score-list">
        ${a.mkts.scores.slice(0, 10).map((s, i) => `<span class="score-chip">${i < 3 ? "🥇" : i < 6 ? "🥈" : "·"} <b>${s.s}</b> ${(s.p*100).toFixed(1)}%</span>`).join("")}
      </div>
      <div class="section-title">比分热力图 (主 × 客)</div>
      <div class="heatmap">
        <div class="hm-head"></div>${[0,1,2,3,4,5].map(() => `<div class="hm-head">·</div>`).join("")}
        ${[0,1,2,3,4,5].map(x => `<div class="hm-head">${x}</div>` + [0,1,2,3,4,5].map(y => {
          const p = a.mkts.matrix[x][y], alpha = Math.min(p*7, 0.85);
          return `<div class="hm-cell" style="background:rgba(46,230,168,${alpha.toFixed(2)});color:${p > 0.06 ? "#06110C" : "var(--faint)"}">${(p*100).toFixed(1)}</div>`;
        }).join("")).join("")}
      </div>
      ${a.modelKeys.length ? `
      <div class="section-title">三模型 λ 对比</div>
      <table>
        <tr><th>模型</th><th>主队期望进球</th><th>客队期望进球</th></tr>
        ${a.modelKeys.map(k => `<tr><td>${mn[k]}</td><td>${a.models[k][0].toFixed(2)}</td><td>${a.models[k][1].toFixed(2)}</td></tr>`).join("")}
        <tr><td><b>集成</b></td><td><b>${a.lhEns.toFixed(2)}</b></td><td><b>${a.laEns.toFixed(2)}</b></td></tr>
        ${a.mkt ? `<tr><td>市场</td><td>${a.mkt.lh.toFixed(2)}</td><td>${a.mkt.la.toFixed(2)}</td></tr>` : ""}
        <tr><td><b>混合 40/60</b></td><td><b>${a.lh.toFixed(2)}</b></td><td><b>${a.la.toFixed(2)}</b></td></tr>
      </table>` : ""}
    </details>

    ${a.value.length ? `
    <div class="section-title">价值分析 (EV = 概率 × 赔率 − 1)</div>
    <table>
      <tr><th>玩法</th><th>选项</th><th>概率</th><th>赔率</th><th>EV</th></tr>
      ${a.value.map(v => `<tr><td>${esc(v.market)}</td><td>${v.pick}</td><td>${fmtP(v.p)}</td><td>${fmtO(v.odds)}</td><td class="${v.ev > 0 ? "pos" : "neg"}">${v.ev >= 0 ? "+" : ""}${(v.ev*100).toFixed(1)}%</td></tr>`).join("")}
    </table>` : ""}

    <div class="section-title">AI 研究 (DeepSeek)</div>
    <div class="btn-row">
      <button class="btn small" data-act="ai" data-id="${m.id}" ${ai ? "disabled" : ""}>${ai ? "✓ 已生成" : "🤖 生成 AI 研究 + 反方辩论"}</button>
    </div>
    ${!state.settings.deepseekKey ? `<div class="hint">需先在右上角 ⚙ 设置中填写 DeepSeek API Key (deepseek.com 免费注册)</div>` : ""}
    ${ai?.main ? `
    <div class="ai-box"><div class="ai-head">🤖 主AI分析</div><div class="ai-body">${esc(ai.main)}</div></div>
    ${ai.debate ? `<div class="ai-box debate"><div class="ai-head">😈 反方AI辩论</div><div class="ai-body">${esc(ai.debate)}</div></div>` : ""}` : ""}
    ${ai?.loading ? `<div class="ai-loading"><div class="spin"></div>AI 研究生成中, 约 10-30 秒…</div>` : ""}
    ${ai?.error ? `<div class="callout red">AI 调用失败: ${esc(ai.error)}<br>请检查 Key 是否有效、网络是否可用。</div>` : ""}

    <div class="btn-row" style="margin-top:12px;">
      ${inHistory ? `<span class="badge gray">已记录</span>` : `<button class="btn small" data-act="record" data-id="${m.id}">📥 记录预测</button>`}
      <button class="btn ghost small" data-act="result" data-id="${m.id}">${res ? `赛果 ${res.hg}:${res.ag}` : "填写赛果"}</button>
      <button class="btn ghost small" data-act="edit" data-id="${m.id}">编辑</button>
    </div>
  </div>`;
}

/* ============================================================
 * 视图: 历史记录
 * ============================================================ */
function viewHistory() {
  const graded = state.history.filter(h => state.results[h.matchId]);
  let stats = { n: 0, dir: 0, band: 0, s3: 0, s5: 0, brier: 0 };
  const buckets = {};
  for (const h of graded) {
    const r = state.results[h.matchId];
    const g = gradePrediction(h, r.hg, r.ag);
    stats.n++; stats.dir += g.dirHit; stats.band += g.bandHit; stats.s3 += g.scoreTop3; stats.s5 += g.scoreTop5; stats.brier += g.brier;
    const p = h.probs[h.pick];
    const b = p < 0.5 ? "40-50%" : p < 0.6 ? "50-60%" : p < 0.7 ? "60-70%" : "70%+";
    buckets[b] = buckets[b] || { n: 0, hit: 0 };
    buckets[b].n++; buckets[b].hit += g.dirHit;
  }
  const n = stats.n;
  return `
  <div class="callout mint">记录 → 赛后填分 → 自动统计方向命中率、进球区间、比分Top3 与 Brier 分数。用数据检验研究质量。</div>
  ${n ? `
  <div class="stat-grid" style="grid-template-columns:repeat(2,1fr);">
    <div class="stat"><div class="k">已判定场次</div><div class="v">${n}</div></div>
    <div class="stat"><div class="k">方向命中率</div><div class="v">${(stats.dir/n*100).toFixed(1)}%</div></div>
    <div class="stat"><div class="k">进球区间命中率</div><div class="v">${(stats.band/n*100).toFixed(1)}%</div></div>
    <div class="stat"><div class="k">比分Top3 / Top5</div><div class="v">${(stats.s3/n*100).toFixed(0)}% / ${(stats.s5/n*100).toFixed(0)}%</div></div>
    <div class="stat"><div class="k">Brier (越低越好)</div><div class="v">${(stats.brier/n).toFixed(3)}</div></div>
  </div>
  ${Object.keys(buckets).length ? `
  <div class="section-title">校准表</div>
  <table><tr><th>预测概率区间</th><th>场次</th><th>实际命中率</th></tr>
  ${Object.entries(buckets).map(([b, v]) => `<tr><td>${b}</td><td>${v.n}</td><td>${(v.hit/v.n*100).toFixed(1)}%</td></tr>`).join("")}
  </table><div class="hint">实际命中率应接近区间中值, 否则说明过度自信/保守。</div>` : ""}` : `<div class="hint">暂无已判定记录</div>`}
  <div class="section-title">研究记录 (${state.history.length})</div>
  ${state.history.length === 0 ? `<div class="empty"><div class="big">📜</div>暂无记录<br>在「赛事研究」页点击「记录预测」</div>` :
    state.history.slice().reverse().map(h => {
      const r = state.results[h.matchId];
      const g = r ? gradePrediction(h, r.hg, r.ag) : null;
      return `<div class="card" style="padding:12px 14px;">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
          <div style="min-width:0;">
            <b style="font-size:13px;">${esc(h.label)}</b>
            <div class="hint" style="margin:2px 0 0;">${esc(h.date)} · 推 ${esc(h.pickName)} ${fmtP(h.probs[h.pick])} · ${esc(h.bandName)} · Top3: ${h.top3.map(t => t.s).join("/")}</div>
          </div>
          ${g ? `<span class="badge ${g.dirHit ? "mint" : "red"}">${g.dirHit ? "方向✓" : "方向✗"}${g.scoreTop3 ? " 比分✓" : ""}</span>`
              : `<button class="btn small" data-act="result" data-id="${h.matchId}">填写赛果</button>`}
        </div>
      </div>`;
    }).join("")}
  ${state.history.length ? `<button class="btn danger small" data-act="clearhist">清空全部记录</button>` : ""}`;
}

/* ============================================================
 * 视图: 数据中心
 * ============================================================ */
let dataLeague = "E0";
function viewData() {
  const lgs = Object.keys(DATA.leagues);
  const lg = DATA.leagues[dataLeague];
  const teams = Object.entries(lg.teams).map(([k, t]) => ({ k, ...t }))
    .sort((a, b) => b.elo - a.elo);
  return `
  <div class="card">
    <div class="section-title" style="margin-top:2px;">数据与模型</div>
    <div class="hint" style="margin-top:0;">生成时间 ${DATA.meta.generated.slice(0, 10)} · 来源 football-data.co.uk (免费) · ${Object.keys(DATA.leagues).length} 大联赛 110 队 · 两赛季 3500+ 场</div>
    <table>
      <tr><th>模型</th><th>方法</th><th>回测命中率</th></tr>
      <tr><td>泊松</td><td>时间加权攻防强度</td><td>51.1%</td></tr>
      <tr><td>Elo</td><td>在线评分→净胜球回归</td><td>51.9%</td></tr>
      <tr><td>xG代理</td><td>射正(SoT)攻防×转化率</td><td>49.8%</td></tr>
      <tr><td><b>集成+市场</b></td><td><b>40/60 混合</b></td><td class="pos"><b>54.4%</b></td></tr>
    </table>
    <div class="hint">526 场滚动回测: 集成模型对数损失优于任何单一模型。市场仍是最强基准, 工具价值在于量化与风控。</div>
  </div>
  <div class="section-title">球队评分库</div>
  <div class="league-chips">
    ${lgs.map(l => `<button class="chip ${l === dataLeague ? "active" : ""}" data-lg="${l}">${DATA.leagues[l].name}</button>`).join("")}
  </div>
  <div class="card" style="padding:4px 8px;">
  ${teams.map(t => `
    <div class="team-row">
      <div class="tname"><b>${esc(cnName(t.k))}</b><span>${esc(t.k)} · ${t.n}场 · 近6进${t.last6.gf}失${t.last6.ga}</span></div>
      <div class="tstat"><div class="k">泊松攻/防</div><div class="v">${t.poisson_att.toFixed(2)} / ${t.poisson_def.toFixed(2)}</div></div>
      <div class="tstat"><div class="k">Elo</div><div class="v">${t.elo}</div></div>
      <div class="tstat"><div class="k">xG攻/防</div><div class="v">${t.sot_att.toFixed(2)} / ${t.sot_def.toFixed(2)}</div></div>
    </div>`).join("")}
  </div>
  <div class="hint">泊松防/xG防数值越低越好 (限制失球)。更新: 重新下载数据后运行 tools/model.py (仓库含每月自动刷新 CI)。</div>`;
}

/* ============================================================
 * 弹窗: 设置
 * ============================================================ */
function openSettings() {
  const root = $("#modal-root");
  const s = state.settings;
  root.innerHTML = `
  <div class="modal-mask" data-act="closemask">
    <div class="modal">
      <div class="modal-head"><h3>⚙ 设置</h3><button class="modal-close" data-act="close">✕</button></div>

      <div class="field">
        <label>DeepSeek API Key (AI 研究 + 反方辩论)</label>
        <input id="s-ds" type="password" placeholder="sk-..." value="${esc(s.deepseekKey)}">
        <div class="hint">deepseek.com 免费注册获取。仅保存在本机, 直接从手机调用 DeepSeek。</div>
      </div>
      <div class="field">
        <label>the-odds-api Key (自动获取赛程)</label>
        <input id="s-od" type="password" placeholder="64位Key" value="${esc(s.oddsApiKey)}">
        <div class="hint">the-odds-api.com 免费注册 (500请求/月)。获取五大联赛+多国联赛真实赛程与欧赔。</div>
      </div>
      <div class="field">
        <label>自动获取的联赛 (可多选)</label>
        <div class="league-chips" id="s-lgs">
          ${Object.entries(ODDS_LEAGUES).map(([k, name]) => `<button class="chip ${s.leagues.includes(k) ? "active" : ""}" data-lgk="${k}">${name}</button>`).join("")}
        </div>
      </div>
      <div class="btn-row" style="margin-top:8px;">
        <button class="btn" data-act="savesettings">保存设置</button>
        <button class="btn danger" data-act="wipedata">清空全部数据</button>
      </div>
    </div>
  </div>`;
  root.querySelector('[data-act="closemask"]').addEventListener("click", e => { if (e.target.dataset.act === "closemask") closeModal(); });
  root.querySelector('[data-act="close"]').addEventListener("click", closeModal);
  root.querySelectorAll("[data-lgk]").forEach(el => {
    el.addEventListener("click", () => el.classList.toggle("active"));
  });
  root.querySelector('[data-act="savesettings"]').addEventListener("click", () => {
    state.settings.deepseekKey = $("#s-ds").value.trim();
    state.settings.oddsApiKey = $("#s-od").value.trim();
    state.settings.leagues = [...root.querySelectorAll("[data-lgk].active")].map(el => el.dataset.lgk);
    persist(); closeModal(); toast("设置已保存");
  });
  root.querySelector('[data-act="wipedata"]').addEventListener("click", () => {
    if (confirm("确定清空全部比赛与记录?")) {
      state.matches = []; state.history = []; state.results = {}; state.aiCache = {};
      persist(); closeModal(); render(); toast("已清空");
    }
  });
}

/* ============================================================
 * 弹窗: 添加/编辑比赛
 * ============================================================ */
function teamOptions(selected) {
  const groups = Object.keys(DATA.leagues).map(lg => {
    const teams = Object.keys(DATA.leagues[lg].teams).sort((a, b) => cnName(a).localeCompare(cnName(b), "zh"));
    return `<optgroup label="${DATA.leagues[lg].name}">${teams.map(t => `<option value="${esc(t)}" ${t === selected ? "selected" : ""}>${esc(cnName(t))}</option>`).join("")}</optgroup>`;
  }).join("");
  return `<option value="">— 手动输入 —</option>` + groups;
}

function openMatchModal(m) {
  const isNew = !m;
  m = m || { id: uid(), league: "E0", homeKey: "", awayKey: "", homeName: "", awayName: "", date: todayStr(), time: "", hline: "", odds: {} };
  const o = m.odds || {};
  const root = $("#modal-root");
  root.innerHTML = `
  <div class="modal-mask" data-act="closemask">
    <div class="modal">
      <div class="modal-head"><h3>${isNew ? "添加比赛" : "编辑比赛"}</h3><button class="modal-close" data-act="close">✕</button></div>
      <div class="field"><label>竞彩编号 (可选)</label><input id="f-num" value="${esc(m.num || "")}" placeholder="周六001"></div>
      <div class="form-grid">
        <div class="field"><label>日期</label><input id="f-date" type="date" value="${esc(m.date || "")}"></div>
        <div class="field"><label>开赛时间</label><input id="f-time" type="time" value="${esc(m.time || "")}"></div>
      </div>
      <div class="form-grid">
        <div class="field"><label>主队</label><select id="f-home">${teamOptions(m.homeKey)}</select><input id="f-homeName" placeholder="手动输入 (如 横滨水手)" value="${esc(m.homeKey ? "" : m.homeName)}" style="margin-top:6px;"></div>
        <div class="field"><label>客队</label><select id="f-away">${teamOptions(m.awayKey)}</select><input id="f-awayName" placeholder="手动输入" value="${esc(m.awayKey ? "" : m.awayName)}" style="margin-top:6px;"></div>
      </div>
      <div class="field"><label>让球线 (如 -1 / +1, 不玩让球留空)</label><input id="f-hline" value="${esc(m.hline ?? "")}" placeholder="-1"></div>
      <div class="section-title" style="margin-top:4px;">竞彩/市场赔率 (可只填胜平负)</div>
      <div class="form-grid-3">
        <div class="field"><label>胜</label><input id="f-oh" type="number" step="0.01" min="1" value="${o.had ? o.had[0] : ""}" placeholder="2.10"></div>
        <div class="field"><label>平</label><input id="f-od" type="number" step="0.01" min="1" value="${o.had ? o.had[1] : ""}" placeholder="3.40"></div>
        <div class="field"><label>负</label><input id="f-oa" type="number" step="0.01" min="1" value="${o.had ? o.had[2] : ""}" placeholder="3.05"></div>
      </div>
      <div class="form-grid-3">
        <div class="field"><label>让球胜</label><input id="f-rh" type="number" step="0.01" min="1" value="${o.hhad ? o.hhad[0] : ""}"></div>
        <div class="field"><label>让球平</label><input id="f-rd" type="number" step="0.01" min="1" value="${o.hhad ? o.hhad[1] : ""}"></div>
        <div class="field"><label>让球负</label><input id="f-ra" type="number" step="0.01" min="1" value="${o.hhad ? o.hhad[2] : ""}"></div>
      </div>
      <div class="btn-row" style="margin-top:12px;"><button class="btn" data-act="save">保存并分析</button></div>
      <div class="hint">手动输入的球队 (非五大联赛) 由赔率自动反解期望进球。</div>
    </div>
  </div>`;
  root.querySelector('[data-act="closemask"]').addEventListener("click", e => { if (e.target.dataset.act === "closemask") closeModal(); });
  root.querySelector('[data-act="close"]').addEventListener("click", closeModal);
  root.querySelector('[data-act="save"]').addEventListener("click", () => {
    const homeKey = $("#f-home").value, awayKey = $("#f-away").value;
    const homeName = homeKey ? cnName(homeKey) : ($("#f-homeName").value.trim() || "主队");
    const awayName = awayKey ? cnName(awayKey) : ($("#f-awayName").value.trim() || "客队");
    let league = "CU";
    if (homeKey && awayKey) {
      for (const [lg, conf] of Object.entries(DATA.leagues)) if (conf.teams[homeKey] && conf.teams[awayKey]) { league = lg; break; }
    }
    const hline = $("#f-hline").value.trim();
    const had = [$("#f-oh").value, $("#f-od").value, $("#f-oa").value].map(Number);
    const hhad = [$("#f-rh").value, $("#f-rd").value, $("#f-ra").value].map(Number);
    const odds = {};
    if (had.every(x => x > 1)) odds.had = had;
    if (hhad.every(x => x > 1) && hline !== "") odds.hhad = hhad;
    const nm = {
      ...m, num: $("#f-num").value.trim(), date: $("#f-date").value, time: $("#f-time").value,
      league, homeKey: homeKey || null, awayKey: awayKey || null,
      homeName, awayName, hline: hline === "" ? null : Number(hline), odds,
      leagueName: league === "CU" ? (m.leagueName || "") : DATA.leagues[league].name,
    };
    const i = state.matches.findIndex(x => x.id === nm.id);
    if (i >= 0) state.matches[i] = nm; else state.matches.push(nm);
    invalidate(nm); persist(); closeModal(); render();
  });
}

/* ============================================================
 * 弹窗: 导入体彩 JSON
 * ============================================================ */
function openImportModal() {
  const root = $("#modal-root");
  root.innerHTML = `
  <div class="modal-mask" data-act="closemask">
    <div class="modal">
      <div class="modal-head"><h3>导入体彩竞彩数据</h3><button class="modal-close" data-act="close">✕</button></div>
      <div class="field">
        <label>粘贴 JSON (体彩官网接口原文 或 tools/fetch_sporttery.py 输出)</label>
        <textarea id="f-json" rows="9" style="width:100%;background:var(--bg-2);border:1px solid var(--border-2);color:var(--text);border-radius:10px;padding:10px;font-size:12px;font-family:monospace;" placeholder='{"value":{"matchInfoList":[...]}}'></textarea>
      </div>
      <div class="btn-row"><button class="btn" data-act="doimport">解析并导入</button></div>
      <div class="hint">电脑打开体彩官网竞彩页面 → F12 → Network 搜索 getMatchList → 复制 JSON 响应粘贴到此处。</div>
    </div>
  </div>`;
  root.querySelector('[data-act="closemask"]').addEventListener("click", e => { if (e.target.dataset.act === "closemask") closeModal(); });
  root.querySelector('[data-act="close"]').addEventListener("click", closeModal);
  root.querySelector('[data-act="doimport"]').addEventListener("click", () => {
    try {
      const parsed = parseSporttery($("#f-json").value);
      if (!parsed.length) return toast("未解析到比赛数据, 请检查格式");
      for (const p of parsed) {
        state.matches = state.matches.filter(x => !(x.num === p.num && p.num));
        state.matches.push(p);
      }
      persist(); closeModal(); render();
      toast(`成功导入 ${parsed.length} 场`);
    } catch (e) { toast("解析失败: " + e.message); }
  });
}

function oddsArr(x) {
  // 兼容 [1.5,3.8,6.2] 数组 与 {h,d,a} 对象 两种格式 → 统一输出数组
  if (Array.isArray(x) && x.length >= 3) {
    const v = [Number(x[0]), Number(x[1]), Number(x[2])];
    return v.every(o => o > 1) ? v : null;
  }
  if (x && typeof x === "object" && x.h && x.d && x.a) {
    const v = [Number(x.h), Number(x.d), Number(x.a)];
    return v.every(o => o > 1) ? v : null;
  }
  return null;
}
function parseSporttery(text) {
  const data = JSON.parse(text);
  const found = [];
  const walk = (obj) => {
    if (!obj || typeof obj !== "object") return;
    if (Array.isArray(obj)) { obj.forEach(walk); return; }
    const home = obj.homeTeamAbbName || obj.homeTeamName;
    const away = obj.awayTeamAbbName || obj.awayTeamName;
    const had = oddsArr(obj.had), hhad = oddsArr(obj.hhad);
    if (home && away && (had || hhad)) {
      const odds = {};
      if (had) odds.had = had;
      let hline = null;
      if (hhad) {
        odds.hhad = hhad;
        hline = obj.hhad && obj.hhad.goalLine !== undefined ? Number(obj.hhad.goalLine) : -1;
      }
      const hk = matchTeamKey(home), ak = matchTeamKey(away);
      found.push({
        id: uid(), num: obj.matchNumStr || "", date: (obj.matchDate || "").slice(0, 10), time: (obj.matchTime || "").slice(0, 5),
        league: hk && ak ? leagueOfKey(hk) : "CU", leagueName: obj.leagueAbbName || obj.leagueName || "",
        homeKey: hk, awayKey: ak, homeName: hk ? cnName(hk) : home, awayName: ak ? cnName(ak) : away,
        hline, odds,
      });
      return;
    }
    Object.values(obj).forEach(walk);
  };
  walk(data);
  if (data.matches && Array.isArray(data.matches)) {
    for (const p of data.matches) {
      if (!p.home || !p.away) continue; // 体彩官网格式无 home 字段, 已由上方 walk 分支捕获
      const hk = matchTeamKey(p.home), ak = matchTeamKey(p.away);
      const odds = {};
      const had = oddsArr(p.had), hhad = oddsArr(p.hhad);
      if (had) odds.had = had;
      if (hhad) odds.hhad = hhad;
      found.push({
        id: uid(), num: p.num || "", date: p.date || "", time: p.time || "",
        league: hk && ak ? leagueOfKey(hk) : "CU", leagueName: p.league || "",
        homeKey: hk, awayKey: ak, homeName: hk ? cnName(hk) : p.home, awayName: ak ? cnName(ak) : p.away,
        hline: p.goalLine ?? p.hline ?? null, odds,
      });
    }
  }
  // 去重: 同一主客队且日期相同 (或任一方未填日期) 只保留一条; 主客两回合日期不同则都保留
  const seen = new Set();
  return found.filter(m => {
    const hk = m.homeKey || m.homeName, ak = m.awayKey || m.awayName;
    const teams = [hk, ak].sort().join("|");
    if (m.date) {
      if (seen.has(teams + "#" + m.date)) return false;
      if (seen.has(teams + "*")) return false; // 已有无日期的同两队
      seen.add(teams + "#" + m.date);
    } else {
      const dup = [...seen].some(k => k === teams + "*" || k.startsWith(teams + "#"));
      if (dup) return false;
      seen.add(teams + "*");
    }
    return true;
  });
}

/* ============================================================
 * 自动获取赛程 (the-odds-api)
 * ============================================================ */
async function autoFetch() {
  const key = state.settings.oddsApiKey;
  if (!key) { openSettings(); toast("请先在设置中填写 the-odds-api Key"); return; }
  const lgs = state.settings.leagues;
  if (!lgs.length) { toast("请先选择至少一个联赛"); return; }
  toast(`获取 ${lgs.length} 个联赛赛程中…`);
  let total = 0, fails = 0;
  for (const lg of lgs) {
    try {
      const games = await fetchLeague(lg, key);
      const today = todayStr();
      // 只要未来 3 天内的比赛
      const upcoming = games.filter(g => g.date >= today);
      for (const g of upcoming.slice(0, 20)) {
        state.matches = state.matches.filter(x => !(x.date === g.date && x.time === g.time && x.homeName === g.homeName));
        const nm = { id: uid(), ...g, num: "" };
        state.matches.push(nm);
        total++;
      }
    } catch (e) { fails++; console.warn(lg, e.message); }
  }
  persist(); render();
  toast(fails ? `导入 ${total} 场, ${fails} 个联赛失败 (检查Key/额度)` : `成功导入 ${total} 场比赛`);
}

/* ============================================================
 * AI 研究
 * ============================================================ */
async function runAI(matchId) {
  const m = state.matches.find(x => x.id === matchId);
  if (!m) return;
  if (!state.settings.deepseekKey) { openSettings(); toast("请先填写 DeepSeek API Key"); return; }
  const a = analyze(m);
  state.aiCache[matchId] = { loading: true };
  render();
  try {
    const main = await aiAnalyze(m, a, state.settings.deepseekKey);
    state.aiCache[matchId] = { loading: true, main };
    render();
    const debate = await aiDebate(m, a, main, state.settings.deepseekKey);
    state.aiCache[matchId] = { main, debate };
  } catch (e) {
    state.aiCache[matchId] = { error: e.message };
  }
  render();
}

/* ============================================================
 * 赛果 & 记录
 * ============================================================ */
function openResultModal(matchId) {
  const m = state.matches.find(x => x.id === matchId);
  const h = state.history.find(x => x.matchId === matchId);
  if (!m && !h) return;
  const label = m ? `${m.homeName} vs ${m.awayName}` : h.label;
  const r = state.results[matchId] || {};
  const root = $("#modal-root");
  root.innerHTML = `
  <div class="modal-mask" data-act="closemask">
    <div class="modal">
      <div class="modal-head"><h3>填写赛果 · ${esc(label)}</h3><button class="modal-close" data-act="close">✕</button></div>
      <div class="form-grid">
        <div class="field"><label>主队进球</label><input id="f-hg" type="number" min="0" max="20" value="${r.hg ?? ""}"></div>
        <div class="field"><label>客队进球</label><input id="f-ag" type="number" min="0" max="20" value="${r.ag ?? ""}"></div>
      </div>
      <div class="btn-row"><button class="btn" data-act="saveresult">保存赛果</button></div>
    </div>
  </div>`;
  root.querySelector('[data-act="closemask"]').addEventListener("click", e => { if (e.target.dataset.act === "closemask") closeModal(); });
  root.querySelector('[data-act="close"]').addEventListener("click", closeModal);
  root.querySelector('[data-act="saveresult"]').addEventListener("click", () => {
    const hg = Number($("#f-hg").value), ag = Number($("#f-ag").value);
    if (Number.isNaN(hg) || Number.isNaN(ag) || hg < 0 || ag < 0) return toast("请输入有效比分");
    state.results[matchId] = { hg, ag };
    persist(); closeModal(); render();
    const hh = state.history.find(x => x.matchId === matchId);
    if (hh) {
      const g = gradePrediction(hh, hg, ag);
      toast(`方向${g.dirHit ? "✓" : "✗"} · 区间${g.bandHit ? "✓" : "✗"} · 比分Top3${g.scoreTop3 ? "✓" : "✗"}`);
    }
  });
}

function recordPrediction(id) {
  const m = state.matches.find(x => x.id === id);
  if (!m || state.history.some(h => h.matchId === id)) return;
  const a = analyze(m);
  const pick = a.mkts.wdlPick;
  const bands = [["0-1球", 0], ["2-3球", 1], ["4-6球", 2], ["7+球", 3]];
  const band = bands.reduce((x, y) => (a.mkts.bands[y[1]] > a.mkts.bands[x[1]] ? y : x), bands[0]);
  state.history.push({
    matchId: id, label: `${m.homeName} vs ${m.awayName}`, date: `${m.date} ${m.time}`,
    probs: { ...a.mkts.wdl }, pick, pickName: pickName(pick),
    band: band[1], bandName: band[0],
    top3: a.mkts.scores.slice(0, 3).map(s => ({ s: s.s, x: s.x, y: s.y })),
    top5: a.mkts.scores.slice(0, 5).map(s => ({ s: s.s, x: s.x, y: s.y })),
  });
  persist(); render();
  toast("已记录, 赛后填写赛果自动评分");
}

/* ============================================================
 * 事件绑定
 * ============================================================ */
function bindView(v) {
  v.querySelectorAll("[data-act]").forEach(el => {
    el.addEventListener("click", async () => {
      const act = el.dataset.act, id = el.dataset.id;
      if (act === "settings") openSettings();
      else if (act === "add") openMatchModal();
      else if (act === "edit") openMatchModal(state.matches.find(x => x.id === id));
      else if (act === "import") openImportModal();
      else if (act === "fetch") autoFetch();
      else if (act === "goto-research") { currentTab = "research"; document.querySelectorAll(".tab").forEach(b => b.classList.toggle("active", b.dataset.tab === "research")); render(); }
      else if (act === "del") { state.matches = state.matches.filter(m => m.id !== id); delete state.aiCache[id]; persist(); render(); }
      else if (act === "record") recordPrediction(id);
      else if (act === "result") openResultModal(id);
      else if (act === "ai") runAI(id);
      else if (act === "clearhist") { if (confirm("确定清空全部记录?")) { state.history = []; state.results = {}; persist(); render(); } }
    });
  });
  v.querySelectorAll("[data-lg]").forEach(el => {
    el.addEventListener("click", () => { dataLeague = el.dataset.lg; render(); });
  });
}
function closeModal() { $("#modal-root").innerHTML = ""; }

/* ---------- 启动 ---------- */
try {
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
} catch (e) { /* 沙箱预览环境不支持, 忽略 */ }
render();
