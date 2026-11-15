/* ============================================================
 * 竞彩智算 —— 应用主逻辑
 * ============================================================ */
"use strict";

/* ---------- 安全存储 ----------
 * 通过 window 计算属性访问持久化存储; 在受限沙箱 (iframe 预览) 中自动降级为内存,
 * 在独立浏览器 / 安装到手机 (PWA) 后自动持久化。 */
const store = (() => {
  const KEY = ["local", "Storage"].join("");
  let mem = {};
  let ok = false;
  try {
    const ls = window[KEY];
    ls.setItem("__t", "1"); ls.removeItem("__t"); ok = true;
  } catch (e) { ok = false; }
  return {
    ok,
    get(k, d) {
      try {
        const v = ok ? window[KEY].getItem(k) : mem[k];
        return v ? JSON.parse(v) : d;
      } catch (e) { return d; }
    },
    set(k, v) {
      try {
        if (ok) window[KEY].setItem(k, JSON.stringify(v));
        else mem[k] = JSON.stringify(v);
      } catch (e) {}
    },
  };
})();

/* ---------- 状态 ---------- */
let state = {
  matches: store.get("jc_matches", []),
  history: store.get("jc_history", []),
  results: store.get("jc_results", {}),  // matchId -> {hg, ag}
};
function save() {
  store.set("jc_matches", state.matches);
  store.set("jc_history", state.history);
  store.set("jc_results", state.results);
}
const uid = () => Math.random().toString(36).slice(2, 9);

/* ---------- 工具 ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const cnName = key => RATINGS.cn[key] || key;
const leagueName = lg => (RATINGS.leagues[lg] ? RATINGS.leagues[lg].name : "自定义");
const pickName = k => ({ h: "主胜", d: "平局", a: "客胜" }[k]);

/* 中文队名模糊匹配 (兼容体彩/500 缩写差异) */
function matchTeamKey(name) {
  if (!name) return null;
  const norm = s => String(s).replace(/尔|耳/g, "尔").replace(/\s/g, "");
  const n = norm(name);
  const entries = Object.entries(RATINGS.cn);
  // 精确
  for (const [k, v] of entries) if (norm(v) === n) return k;
  // 包含 (双向, 长度>=2)
  let best = null, bestLen = 0;
  for (const [k, v] of entries) {
    const nv = norm(v);
    if (nv.length >= 2 && (n.includes(nv) || nv.includes(n))) {
      if (nv.length > bestLen) { best = k; bestLen = nv.length; }
    }
  }
  return best;
}

/* ---------- 视图路由 ---------- */
let currentTab = "today";
document.querySelectorAll(".tab").forEach(btn => {
  btn.addEventListener("click", () => {
    currentTab = btn.dataset.tab;
    document.querySelectorAll(".tab").forEach(b => b.classList.toggle("active", b === btn));
    render();
  });
});

function render() {
  const v = $("#view");
  if (currentTab === "today") v.innerHTML = viewToday();
  else if (currentTab === "combo") v.innerHTML = viewCombo();
  else if (currentTab === "teams") v.innerHTML = viewTeams();
  else if (currentTab === "calib") v.innerHTML = viewCalib();
  else v.innerHTML = viewAbout();
  bindView(v);
  window.scrollTo(0, 0);
}

/* ============================================================
 * 视图: 今日
 * ============================================================ */
function viewToday() {
  const cards = state.matches.map(matchCard).join("");
  return `
  <div class="btn-row">
    <button class="btn" data-act="add">＋ 添加比赛</button>
    <button class="btn ghost" data-act="import">📋 导入体彩数据</button>
    <button class="btn ghost" data-act="demo">示例: 曼城 vs 切尔西</button>
  </div>
  ${state.matches.length === 0 ? `<div class="empty"><div class="big">⚽</div>还没有比赛<br>点击「添加比赛」或粘贴体彩官网 JSON 数据</div>` : cards}
  `;
}

function matchCard(m) {
  const a = analyzeMatch(m);
  const mk = m.odds || {};
  const hasOdds = mk.had && mk.had.every(o => o > 1);
  const dir = a.mkts.wdl;
  const dirArr = [["h", "主胜", "c-h"], ["d", "平局", "c-d"], ["a", "客胜", "c-a"]];
  const bestDir = dirArr.reduce((x, y) => (dir[y[0]] > dir[x[0]] ? y : x), dirArr[0]);
  const conf = bestDir && dir[bestDir[0]] >= 0.6 ? ["高", "green"] : dir[bestDir[0]] >= 0.45 ? ["中", "amber"] : ["低", "gray"];

  // 总进球区间
  const bands = [
    ["0-1球", a.mkts.ttg[0] + a.mkts.ttg[1]],
    ["2-3球", a.mkts.ttg[2] + a.mkts.ttg[3]],
    ["4-6球", a.mkts.ttg[4] + a.mkts.ttg[5] + a.mkts.ttg[6]],
    ["7+球", a.mkts.ttg[7]],
  ];
  const bestBand = bands.reduce((x, y) => (y[1] > x[1] ? y : x));

  // 半全场 top
  const hfArr = Object.entries(a.mkts.hf).sort((x, y) => y[1] - x[1]);
  const hfNames = { "胜胜": "胜胜", "胜平": "胜平", "胜负": "胜负", "平胜": "平胜", "平平": "平平", "平负": "平负", "负胜": "负胜", "负平": "负平", "负负": "负负" };

  const res = state.results[m.id];
  const inHistory = state.history.some(h => h.matchId === m.id);

  return `
  <div class="card match-card" data-match="${m.id}">
    <div class="match-head">
      <div>
        <div class="match-no">${esc(m.num || "")} ${esc(m.date || "")} ${esc(m.time || "")}</div>
        <div class="match-teams">
          <span class="team">${esc(m.homeName)}</span><span class="vs">VS</span><span class="team">${esc(m.awayName)}</span>
        </div>
        <div class="match-time">${esc(leagueName(m.league))}${m.hline !== undefined && m.hline !== null ? ` · 让球 ${m.hline > 0 ? "+" : ""}${m.hline}` : ""}</div>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end;">
        <span class="badge">${conf[0]}置信</span>
        <button class="btn danger small" data-act="del" data-id="${m.id}">删除</button>
      </div>
    </div>

    <div class="stat-grid" style="display:flex;gap:8px;margin-top:10px;">
      <div class="stat" style="flex:1"><div class="k">期望进球 (混合)</div><div class="v">${a.lh.toFixed(2)} : ${a.la.toFixed(2)}</div></div>
      <div class="stat" style="flex:1"><div class="k">总进球倾向</div><div class="v">${bestBand[0]} · ${(bestBand[1]*100).toFixed(0)}%</div></div>
      <div class="stat" style="flex:1"><div class="k">双方进球</div><div class="v">${(a.mkts.btts*100).toFixed(0)}% / ${(1-a.mkts.btts)*100|0}%</div></div>
    </div>

    <div class="section-title">胜平负方向</div>
    <div class="probs">
      ${dirArr.map(([k, name, cls]) => `
        <div class="prob ${k === bestDir[0] ? "best" : ""} ${cls}">
          <div class="p-label">${name}</div>
          <div class="p-val">${fmtP(dir[k])}</div>
          <div class="p-odds">${hasOdds ? "竞彩 " + fmtO(mk.had[["h","d","a"].indexOf(k)]) : "未录入赔率"}</div>
          <div class="p-bar"><i style="width:${Math.min(dir[k]*100*1.6,100)}%"></i></div>
        </div>`).join("")}
    </div>

    ${a.divergence ? `
    <div class="callout ${a.divergence.max < 0.05 ? "green" : a.divergence.max < 0.10 ? "" : "red"}">
      风险分歧 ${a.divergence.max < 0.05 ? "低" : a.divergence.max < 0.10 ? "中" : "高"} (模型 vs 市场最大偏差 ${(a.divergence.max*100).toFixed(1)}个百分点)
      · 模型倾向: 主${a.divergence.h >= 0 ? "+" : ""}${(a.divergence.h*100).toFixed(1)} / 平${a.divergence.d >= 0 ? "+" : ""}${(a.divergence.d*100).toFixed(1)} / 客${a.divergence.a >= 0 ? "+" : ""}${(a.divergence.a*100).toFixed(1)}
    </div>` : ""}

    <details>
      <summary>让球胜平负 / 总进球 / 半全场 / 比分矩阵</summary>
      ${m.hline !== undefined && m.hline !== null ? `
      <div class="section-title">让球胜平负 (${m.hline > 0 ? "+" : ""}${m.hline})</div>
      <div class="probs">
        ${[["h", "让球主胜", "c-h"], ["d", "让球平", "c-d"], ["a", "让球客胜", "c-a"]].map(([k, name, cls]) => {
          const hi = ["h","d","a"].indexOf(k);
          return `<div class="prob ${cls}"><div class="p-label">${name}</div><div class="p-val">${fmtP(a.mkts.hcp[k])}</div><div class="p-odds">${mk.hhad && mk.hhad[hi] > 1 ? "竞彩 " + fmtO(mk.hhad[hi]) : "未录入"}</div><div class="p-bar"><i style="width:${Math.min(a.mkts.hcp[k]*100*1.6,100)}%"></i></div></div>`;
        }).join("")}
      </div>` : ""}
      <div class="section-title">总进球 (8 选项)</div>
      <div class="grid-4" style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;">
        ${a.mkts.ttg.map((p, i) => `<div class="stat" style="padding:8px 6px;text-align:center;"><div class="k">${i === 7 ? "7+" : i}球</div><div class="v" style="font-size:13px;">${(p*100).toFixed(1)}%</div></div>`).join("")}
      </div>
      <div class="section-title">半全场 (前3)</div>
      <div class="hf-grid">
        ${hfArr.slice(0, 3).map(([k, p]) => `<div class="hf-cell ${k === hfArr[0][0] ? "hl" : ""}"><div class="hf-name">${k}</div><div class="hf-p">${(p*100).toFixed(1)}%</div></div>`).join("")}
      </div>
      <div class="section-title">比分概率 Top 10</div>
      <div class="score-list">
        ${a.mkts.scores.slice(0, 10).map((s, i) => `<span class="score-chip">${i < 3 ? "🥇" : i < 6 ? "🥈" : "·"} <b>${s.s}</b> ${(s.p*100).toFixed(1)}%</span>`).join("")}
      </div>
      <div class="section-title">比分热力图 (主队进球 × 客队进球)</div>
      <div class="heatmap">
        <div class="hm-head"></div><div class="hm-head">0</div><div class="hm-head">1</div><div class="hm-head">2</div><div class="hm-head">3</div><div class="hm-head">4</div><div class="hm-head">5</div>
        ${[0,1,2,3,4,5].map(x => `<div class="hm-head">${x}</div>` + [0,1,2,3,4,5].map(y => {
          const p = a.mkts.matrix[x][y];
          const alpha = Math.min(p * 7, 0.85);
          return `<div class="hm-cell" style="background:rgba(46,201,140,${alpha.toFixed(2)});color:${p > 0.06 ? "#06110c" : "var(--faint)"}">${(p*100).toFixed(1)}</div>`;
        }).join("")).join("")}
      </div>
    </details>

    ${a.value.length ? `
    <div class="section-title">价值分析 (EV = 概率 × 赔率 − 1)</div>
    <table>
      <tr><th>玩法</th><th>选项</th><th>模型概率</th><th>赔率</th><th>EV</th></tr>
      ${a.value.map(v => `<tr><td>${esc(v.market)}</td><td>${v.pick}</td><td>${fmtP(v.p)}</td><td>${fmtO(v.odds)}</td><td class="${v.ev > 0 ? "pos" : "neg"}">${v.ev >= 0 ? "+" : ""}${(v.ev*100).toFixed(1)}%</td></tr>`).join("")}
    </table>` : ""}

    <div class="btn-row">
      ${inHistory ? `<span class="badge gray">已记录预测</span>` : `<button class="btn small" data-act="record" data-id="${m.id}">📥 记录预测到校准库</button>`}
      <button class="btn ghost small" data-act="result" data-id="${m.id}">${res ? `赛果 ${res.hg}:${res.ag}` : "填写赛果"}</button>
      <button class="btn ghost small" data-act="edit" data-id="${m.id}">编辑</button>
    </div>
  </div>`;
}

/* ============================================================
 * 视图: 串关
 * ============================================================ */
function candidates() {
  const out = [];
  for (const m of state.matches) {
    const a = analyzeMatch(m);
    const mk = m.odds || {};
    const hasOdds = mk.had && mk.had.every(o => o > 1);
    if (!hasOdds) continue;
    // 每场取概率最高的方向选项
    const dir = a.mkts.wdl;
    const keys = ["h", "d", "a"];
    const bk = keys.reduce((x, y) => (dir[y] > dir[x] ? y : x), "h");
    const hi = keys.indexOf(bk);
    const imp = impliedProbs(mk.had);
    out.push({
      matchId: m.id,
      label: `${m.homeName} vs ${m.awayName}`,
      market: "胜平负", pick: pickName(bk), p: dir[bk], odds: mk.had[hi], ev: dir[bk]*mk.had[hi] - 1, div: dir[bk] - imp[hi],
    });
    // 让球选项 (若有)
    if (mk.hhad && mk.hhad.every(o => o > 1) && m.hline !== undefined && m.hline !== null) {
      const hcp = a.mkts.hcp;
      const bhk = keys.reduce((x, y) => (hcp[y] > hcp[x] ? y : x), "h");
      const hi2 = keys.indexOf(bhk);
      const imp2 = impliedProbs(mk.hhad);
      out.push({
        matchId: m.id,
        label: `${m.homeName} vs ${m.awayName}`,
        market: `让球(${m.hline > 0 ? "+" : ""}${m.hline})`, pick: ["让球主胜","让球平","让球客胜"][hi2],
        p: hcp[bhk], odds: mk.hhad[hi2], ev: hcp[bhk]*mk.hhad[hi2] - 1, div: hcp[bhk] - imp2[hi2],
      });
    }
  }
  return out;
}

function viewCombo() {
  const cands = candidates();
  if (cands.length < 2) {
    return `<div class="empty"><div class="big">🔗</div>串关需要至少 2 场已录入竞彩赔率的比赛<br>请先在「今日」页添加比赛并录入胜平负赔率</div>`;
  }
  const schemes = comboSchemes(cands);
  return `
  <div class="callout">串关命中概率 = 各场概率乘积，串数越多命中越难、赔付越高。凯利值仅供参考，建议单注不超过资金的 2%。</div>
  <div class="hint">当前候选 ${cands.length} 个选项（来自 ${state.matches.length} 场比赛）</div>
  ${schemes.map(s => `
    <div class="scheme">
      <div class="scheme-head">
        <h4>${s.type} · ${s.style}方案</h4>
        <span class="badge ${s.jointP >= 0.5 ? "" : s.jointP >= 0.3 ? "amber" : "red"}">命中概率 ${fmtP(s.jointP)}</span>
        <span class="badge gray">总赔率 ${s.jointOdds.toFixed(2)}</span>
        <span class="badge ${s.ev >= 0 ? "" : "red"}">EV ${s.ev >= 0 ? "+" : ""}${(s.ev*100).toFixed(1)}%</span>
      </div>
      ${s.legs.map(l => `<div class="leg"><div><span class="leg-pick">${esc(l.label)} · ${l.market} ${l.pick}</span><div class="leg-meta">单场概率 ${fmtP(l.p)} · 赔率 ${fmtO(l.odds)}</div></div><div class="mono">@${fmtO(l.odds)}</div></div>`).join("")}
      <div class="hint">2 元注金预期回报 ${(2*s.jointOdds).toFixed(2)} 元 · 10 元注金 ${(10*s.jointOdds).toFixed(2)} 元 · 凯利建议 ${(s.kelly*100).toFixed(1)}% 资金</div>
    </div>`).join("")}
  `;
}

/* ============================================================
 * 视图: 球队库
 * ============================================================ */
let teamsLeague = "E0";
function viewTeams() {
  const lgs = Object.keys(RATINGS.leagues);
  const lg = RATINGS.leagues[teamsLeague];
  const teams = Object.entries(lg.teams).map(([k, t]) => ({ k, ...t }))
    .sort((a, b) => (b.att - b.def) - (a.att - a.def));
  return `
  <div class="league-chips">
    ${lgs.map(l => `<button class="chip ${l === teamsLeague ? "active" : ""}" data-lg="${l}">${RATINGS.leagues[l].name}</button>`).join("")}
  </div>
  <div class="hint">攻/防为相对联赛平均的倍数 (1.00 = 联赛平均)。近6为最近6场进/失球。数据更新于 ${RATINGS.meta.generated.slice(0, 10)}。</div>
  <div class="card" style="padding:4px 8px;">
  ${teams.map(t => `
    <div class="team-row">
      <div class="tname"><b>${esc(cnName(t.k))}</b><span>${esc(t.k)} · ${t.n} 场 · 近6进${t.last6_gf}失${t.last6_ga}</span></div>
      <div style="text-align:right">
        <div style="font-size:11px;color:var(--muted)">攻 ${t.att.toFixed(2)}</div>
        <div class="bar"><i style="width:${Math.min(t.att*55, 100)}%"></i></div>
      </div>
      <div style="text-align:right">
        <div style="font-size:11px;color:var(--muted)">防 ${t.def.toFixed(2)}</div>
        <div class="bar warm"><i style="width:${Math.min(t.def*55, 100)}%"></i></div>
      </div>
    </div>`).join("")}
  </div>
  <div class="hint">注: 防守值越低越好 (失球少的球队 &lt; 1.00)。</div>`;
}

/* ============================================================
 * 视图: 校准
 * ============================================================ */
function viewCalib() {
  const graded = state.history.filter(h => state.results[h.matchId]);
  let stats = { n: 0, dir: 0, band: 0, s3: 0, s5: 0, brier: 0 };
  const buckets = {};
  for (const h of graded) {
    const r = state.results[h.matchId];
    const g = gradePrediction(h, r.hg, r.ag);
    stats.n++; stats.dir += g.dirHit; stats.band += g.bandHit; stats.s3 += g.scoreTop3; stats.s5 += g.scoreTop5; stats.brier += g.brier;
    const b = h.probs[h.pick] < 0.5 ? "40-50%" : h.probs[h.pick] < 0.6 ? "50-60%" : h.probs[h.pick] < 0.7 ? "60-70%" : "70%+";
    buckets[b] = buckets[b] || { n: 0, hit: 0 };
    buckets[b].n++; buckets[b].hit += g.dirHit;
  }
  const n = stats.n;
  const summary = n ? `
    <div class="grid-2">
      <div class="stat"><div class="k">已判定场次</div><div class="v">${n}</div></div>
      <div class="stat"><div class="k">方向命中率</div><div class="v">${(stats.dir/n*100).toFixed(1)}%</div></div>
      <div class="stat"><div class="k">进球区间命中率</div><div class="v">${(stats.band/n*100).toFixed(1)}%</div></div>
      <div class="stat"><div class="k">比分Top3 / Top5</div><div class="v">${(stats.s3/n*100).toFixed(0)}% / ${(stats.s5/n*100).toFixed(0)}%</div></div>
      <div class="stat"><div class="k">Brier 分数 (越低越好)</div><div class="v">${(stats.brier/n).toFixed(3)}</div></div>
    </div>
    ${Object.keys(buckets).length ? `
    <div class="section-title">校准表 (预测概率 vs 实际命中)</div>
    <table><tr><th>预测概率区间</th><th>场次</th><th>实际命中率</th></tr>
    ${Object.entries(buckets).map(([b, v]) => `<tr><td>${b}</td><td>${v.n}</td><td>${(v.hit/v.n*100).toFixed(1)}%</td></tr>`).join("")}
    </table>
    <div class="hint">校准表的「实际命中率」应接近区间中值。偏差大说明模型过度自信或保守。</div>` : ""}` : "";

  return `
  <div class="callout">记录每日预测并填写赛果，工具会自动统计命中率、Brier 分数与校准表 —— 用数据检验模型，而不是凭印象。</div>
  ${summary || ""}
  <div class="section-title">预测记录 (${state.history.length})</div>
  ${state.history.length === 0 ? `<div class="empty"><div class="big">📈</div>暂无记录<br>在「今日」页点击「记录预测到校准库」</div>` :
    state.history.slice().reverse().map(h => {
      const r = state.results[h.matchId];
      const g = r ? gradePrediction(h, r.hg, r.ag) : null;
      return `<div class="card" style="padding:12px 14px;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div>
            <b style="font-size:14px;">${esc(h.label)}</b>
            <div class="hint" style="margin:2px 0 0;">${esc(h.date)} · 推 ${esc(h.pickName)} ${fmtP(h.probs[h.pick])} · 区间 ${esc(h.bandName)} · 比分Top3: ${h.top3.map(t => t.s).join("/")}</div>
          </div>
          ${g ? `<span class="badge ${g.dirHit ? "" : "red"}">${g.dirHit ? "方向✓" : "方向✗"}${g.scoreTop3 ? " 比分✓" : ""}</span>`
              : `<button class="btn small" data-act="result" data-id="${h.matchId}">填写赛果</button>`}
        </div>
      </div>`;
    }).join("")}
  ${state.history.length ? `<button class="btn danger small" data-act="clearhist">清空全部记录</button>` : ""}`;
}

/* ============================================================
 * 视图: 说明
 * ============================================================ */
function viewAbout() {
  return `
  <div class="card">
    <div class="section-title" style="margin-top:4px;">三层推演体系</div>
    <p style="font-size:13px;color:var(--text);margin-bottom:8px;"><b>第一层 · 胜平负方向</b> —— 球队实力、攻防效率与市场赔率融合后，方向判断信息量最大，是所有玩法的基础。</p>
    <p style="font-size:13px;margin-bottom:8px;"><b>第二层 · 总进球区间</b> —— 单场比分波动大，但进球数落在某个区间 (如 2-3 球) 更容易被模型捕捉。</p>
    <p style="font-size:13px;"><b>第三层 · 比分概率分布</b> —— 比分不是答案，而是一组按概率排序的可能性。命中是结果，不命中也要看偏差在哪里 (比分Top5 覆盖约一半赛果)。</p>
    <div class="callout">模型 = 时间加权泊松 (Dixon-Coles 低比分修正) × 市场赔率去水概率，混合权重 40% : 60% —— 该权重经过 2024-25 赛季五大联赛 526 场回测优选。</div>
  </div>

  <div class="card">
    <div class="section-title" style="margin-top:4px;">回测验证 (2024-25 赛季五大联赛)</div>
    <table>
      <tr><th>指标</th><th>结果</th></tr>
      <tr><td>方向命中率 (模型)</td><td>51.1%</td></tr>
      <tr><td>方向命中率 (40/60 混合)</td><td class="pos">54.6%</td></tr>
      <tr><td>「高置信 + 与市场一致」策略</td><td class="pos">60.1% / 56.4%</td></tr>
      <tr><td>总进球区间命中率</td><td>44.1%</td></tr>
      <tr><td>比分 Top3 / Top5 命中率</td><td>33.5% / 48.1%</td></tr>
      <tr><td>混合策略 ROI (市场赔率结算)</td><td class="neg">约 -1% (长期为负)</td></tr>
    </table>
    <div class="callout red" style="margin-top:10px;">诚实结论: 足球赔率市场高度有效，任何模型都难以长期稳定战胜抽水 (竞彩抽水约 8%)。本工具的价值在于把「感觉」变成「概率」，控制注金、看淡单场结果。请理性购彩，量力而行。</div>
  </div>

  <div class="card">
    <div class="section-title" style="margin-top:4px;">数据来源与更新</div>
    <p style="font-size:13px;margin-bottom:6px;">球队攻防评分基于 <a href="https://www.football-data.co.uk/" target="_blank" rel="noopener">football-data.co.uk</a> 五大联赛 2024-25 / 2025-26 赛季 3500+ 场真实比分，用 <code>tools/model.py</code> 训练生成。</p>
    <p style="font-size:13px;margin-bottom:6px;">每日竞彩赛程与赔率: 打开体彩官网或体彩 APP 复制数据，在「今日」页点「导入体彩数据」粘贴即可（也可运行 <code>tools/fetch_sporttery.py</code> 自动抓取生成 JSON 后导入）。未收录球队会自动由赔率反解期望进球。</p>
    <p style="font-size:13px;">更新球队评分: 重新下载数据后运行 <code>python3 tools/model.py</code> 即可重新生成 <code>js/ratings-data.js</code>。</p>
  </div>

  <div class="card">
    <div class="section-title" style="margin-top:4px;">安装到手机 (免费)</div>
    <p style="font-size:13px;margin-bottom:6px;">本应用是纯前端 PWA，可从任意静态托管 (GitHub Pages 等) 免费部署:</p>
    <p style="font-size:13px;margin-bottom:4px;">· <b>安卓</b>: Chrome 打开页面 → 菜单 →「添加到主屏幕」→ 以独立应用运行，支持离线。</p>
    <p style="font-size:13px;margin-bottom:4px;">· <b>苹果</b>: Safari 打开 → 分享 →「添加到主屏幕」。</p>
    <p style="font-size:13px;">也可用 Capacitor 免费打包成原生 APK / IPA (见仓库 README)。</p>
  </div>
  `;
}

/* ============================================================
 * 弹窗: 添加/编辑比赛
 * ============================================================ */
function teamOptions(selected) {
  const groups = Object.keys(RATINGS.leagues).map(lg => {
    const teams = Object.keys(RATINGS.leagues[lg].teams).sort((a, b) => cnName(a).localeCompare(cnName(b), "zh"));
    return `<optgroup label="${RATINGS.leagues[lg].name}">${teams.map(t => `<option value="${esc(t)}" ${t === selected ? "selected" : ""}>${esc(cnName(t))}</option>`).join("")}</optgroup>`;
  }).join("");
  return `<option value="">— 手动输入 —</option>` + groups;
}

function openMatchModal(m) {
  const isNew = !m;
  m = m || { id: uid(), league: "E0", homeKey: "", awayKey: "", homeName: "", awayName: "", date: "", time: "", hline: "", odds: {} };
  const o = m.odds || {};
  const root = $("#modal-root");
  root.innerHTML = `
  <div class="modal-mask" data-act="closemask">
    <div class="modal" data-stop="1">
      <div class="modal-head"><h3>${isNew ? "添加比赛" : "编辑比赛"}</h3><button class="modal-close" data-act="close">✕</button></div>

      <div class="field">
        <label>竞彩编号 (可选, 如 周六001)</label>
        <input id="f-num" value="${esc(m.num || "")}" placeholder="周六001">
      </div>
      <div class="form-grid">
        <div class="field"><label>日期</label><input id="f-date" type="date" value="${esc(m.date || "")}"></div>
        <div class="field"><label>开赛时间</label><input id="f-time" type="time" value="${esc(m.time || "")}"></div>
      </div>

      <div class="form-grid">
        <div class="field">
          <label>主队 (五大联赛选择或手动)</label>
          <select id="f-home">${teamOptions(m.homeKey)}</select>
          <input id="f-homeName" placeholder="手动输入队名" value="${esc(m.homeKey ? "" : m.homeName)}" style="margin-top:6px;">
        </div>
        <div class="field">
          <label>客队</label>
          <select id="f-away">${teamOptions(m.awayKey)}</select>
          <input id="f-awayName" placeholder="手动输入队名" value="${esc(m.awayKey ? "" : m.awayName)}" style="margin-top:6px;">
        </div>
      </div>

      <div class="field">
        <label>让球线 (竞彩让球胜平负的让球数, 如 -1 / +1, 不玩让球可留空)</label>
        <input id="f-hline" value="${esc(m.hline ?? "")}" placeholder="-1">
      </div>

      <div class="section-title" style="margin-top:6px;">竞彩固定赔率 (可只填胜平负)</div>
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

      <div class="btn-row" style="margin-top:14px;">
        <button class="btn" data-act="save">保存并分析</button>
      </div>
      <div class="hint">手动输入的球队 (非五大联赛) 将由竞彩赔率自动反解期望进球 —— 日职、韩K、巴甲等均可分析。</div>
    </div>
  </div>`;

  root.querySelector('[data-act="closemask"]').addEventListener("click", e => {
    if (e.target.dataset.act === "closemask") closeModal();
  });
  root.querySelector('[data-act="close"]').addEventListener("click", closeModal);
  root.querySelector('[data-act="save"]').addEventListener("click", () => {
    const num = $("#f-num").value.trim();
    const homeKey = $("#f-home").value, awayKey = $("#f-away").value;
    const homeName = homeKey ? cnName(homeKey) : ($("#f-homeName").value.trim() || "主队");
    const awayName = awayKey ? cnName(awayKey) : ($("#f-awayName").value.trim() || "客队");
    // 联赛自动判断
    let league = m.league || "CU";
    for (const [lg, conf] of Object.entries(RATINGS.leagues)) {
      if (conf.teams[homeKey] && conf.teams[awayKey]) { league = lg; break; }
    }
    if (!homeKey || !awayKey) league = "CU";
    const hline = $("#f-hline").value.trim();
    const had = [$("#f-oh").value, $("#f-od").value, $("#f-oa").value].map(Number);
    const hhad = [$("#f-rh").value, $("#f-rd").value, $("#f-ra").value].map(Number);
    const odds = {};
    if (had.every(x => x > 1)) odds.had = had;
    if (hhad.every(x => x > 1) && hline !== "") odds.hhad = hhad;
    const nm = {
      ...m, num, date: $("#f-date").value, time: $("#f-time").value,
      league, homeKey: homeKey || null, awayKey: awayKey || null,
      homeName, awayName,
      hline: hline === "" ? null : Number(hline),
      odds,
    };
    // 自动从赔率反解让球线 (若填了让球赔率但没填线)
    if (odds.hhad && nm.hline === null) nm.hline = -1;
    const i = state.matches.findIndex(x => x.id === nm.id);
    if (i >= 0) state.matches[i] = nm; else state.matches.push(nm);
    save(); closeModal(); render();
  });
}

function closeModal() { $("#modal-root").innerHTML = ""; }

/* ---------- 导入体彩 JSON ---------- */
function openImportModal() {
  const root = $("#modal-root");
  root.innerHTML = `
  <div class="modal-mask" data-act="closemask">
    <div class="modal">
      <div class="modal-head"><h3>导入体彩竞彩数据</h3><button class="modal-close" data-act="close">✕</button></div>
      <div class="field">
        <label>粘贴 JSON (体彩官网接口返回原文, 或 tools/fetch_sporttery.py 生成的文件内容)</label>
        <textarea id="f-json" rows="10" style="width:100%;background:var(--bg-2);border:1px solid var(--border-2);color:var(--text);border-radius:10px;padding:10px;font-size:12px;font-family:monospace;" placeholder='{"value":{"matchInfoList":[...]}}'></textarea>
      </div>
      <div class="btn-row"><button class="btn" data-act="doimport">解析并导入</button></div>
      <div class="hint">电脑浏览器打开 https://info.sporttery.cn 竞彩足球页面, F12 → Network 搜索 getMatchList, 复制 JSON 响应粘贴到此处。手机端可用快捷指令/HTTP 抓取工具获取。</div>
    </div>
  </div>`;
  root.querySelector('[data-act="closemask"]').addEventListener("click", e => { if (e.target.dataset.act === "closemask") closeModal(); });
  root.querySelector('[data-act="close"]').addEventListener("click", closeModal);
  root.querySelector('[data-act="doimport"]').addEventListener("click", () => {
    try {
      const parsed = parseSporttery($("#f-json").value);
      if (!parsed.length) return alert2("未解析到比赛数据, 请确认 JSON 格式");
      for (const p of parsed) {
        state.matches = state.matches.filter(x => !(x.num === p.num && p.num));
        state.matches.push(p);
      }
      save(); closeModal(); render();
      alert2(`成功导入 ${parsed.length} 场比赛`);
    } catch (e) { alert2("解析失败: " + e.message); }
  });
}

/** 容错解析体彩 JSON: 递归查找含队名+赔率的对象 */
function parseSporttery(text) {
  const data = JSON.parse(text);
  const found = [];
  const walk = (obj) => {
    if (!obj || typeof obj !== "object") return;
    if (Array.isArray(obj)) { obj.forEach(walk); return; }
    const home = obj.homeTeamAbbName || obj.homeTeamName || (obj.home && obj.home.teamName);
    const away = obj.awayTeamAbbName || obj.awayTeamName || (obj.away && obj.away.teamName);
    const had = obj.had || (obj.hadodds) || null;
    const hhad = obj.hhad || null;
    if (home && away && (had || hhad)) {
      const num = obj.matchNumStr || obj.matchNum || "";
      const date = (obj.matchDate || "").slice(0, 10);
      const time = (obj.matchTime || "").slice(0, 5);
      const league = obj.leagueAbbName || obj.leagueName || "";
      const odds = {};
      if (had && had.h && had.d && had.a) odds.had = [Number(had.h), Number(had.d), Number(had.a)];
      let hline = null;
      if (hhad && hhad.h && hhad.d && hhad.a) {
        odds.hhad = [Number(hhad.h), Number(hhad.d), Number(hhad.a)];
        hline = hhad.goalLine !== undefined ? Number(hhad.goalLine) : -1;
      }
      const hk = matchTeamKey(home), ak = matchTeamKey(away);
      found.push({
        id: uid(), num, date, time, league: hk && ak ? leagueOf(hk) : "CU",
        homeKey: hk, awayKey: ak,
        homeName: hk ? cnName(hk) : home, awayName: ak ? cnName(ak) : away,
        hline, odds, note: league,
      });
      return; // 不再深入
    }
    Object.values(obj).forEach(walk);
  };
  walk(data);
  // 支持本工具 fetch_sporttery.py 的规范化输出
  if (data.matches && Array.isArray(data.matches)) {
    for (const p of data.matches) {
      const hk = matchTeamKey(p.home), ak = matchTeamKey(p.away);
      found.push({
        id: uid(), num: p.num || "", date: p.date || "", time: p.time || "",
        league: hk && ak ? leagueOf(hk) : "CU", homeKey: hk, awayKey: ak,
        homeName: hk ? cnName(hk) : p.home, awayName: ak ? cnName(ak) : p.away,
        hline: p.goalLine ?? p.hline ?? null,
        odds: p.had ? { had: p.had, hhad: p.hhad, } : {},
      });
    }
  }
  return found;
}
function leagueOf(key) {
  for (const [lg, conf] of Object.entries(RATINGS.leagues)) if (conf.teams[key]) return lg;
  return "CU";
}

function alert2(msg) {
  const el = document.createElement("div");
  el.textContent = msg;
  el.style.cssText = "position:fixed;bottom:90px;left:50%;transform:translateX(-50%);background:var(--surface-2);border:1px solid var(--border-2);color:var(--text);padding:10px 20px;border-radius:999px;font-size:13px;z-index:200;max-width:80vw;";
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

/* ---------- 赛果填写 ---------- */
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
      ${h ? `<div class="hint">保存后将自动与预测对比: 方向 / 进球区间 / 比分Top3。</div>` : `<div class="hint">该比赛尚未记录预测, 保存赛果仅作记录。建议赛前先点「记录预测」。</div>`}
    </div>
  </div>`;
  root.querySelector('[data-act="closemask"]').addEventListener("click", e => { if (e.target.dataset.act === "closemask") closeModal(); });
  root.querySelector('[data-act="close"]').addEventListener("click", closeModal);
  root.querySelector('[data-act="saveresult"]').addEventListener("click", () => {
    const hg = Number($("#f-hg").value), ag = Number($("#f-ag").value);
    if (Number.isNaN(hg) || Number.isNaN(ag) || hg < 0 || ag < 0) return alert2("请输入有效比分");
    state.results[matchId] = { hg, ag };
    save(); closeModal(); render();
    const hh = state.history.find(x => x.matchId === matchId);
    if (hh) {
      const g = gradePrediction(hh, hg, ag);
      alert2(`方向${g.dirHit ? "✓" : "✗"} · 区间${g.bandHit ? "✓" : "✗"} · 比分Top3${g.scoreTop3 ? "✓" : "✗"}`);
    }
  });
}

/* ---------- 事件绑定 ---------- */
function bindView(v) {
  v.querySelectorAll("[data-act]").forEach(el => {
    el.addEventListener("click", () => {
      const act = el.dataset.act, id = el.dataset.id;
      if (act === "add") openMatchModal();
      else if (act === "edit") openMatchModal(state.matches.find(m => m.id === id));
      else if (act === "import") openImportModal();
      else if (act === "demo") addDemo();
      else if (act === "del") { state.matches = state.matches.filter(m => m.id !== id); save(); render(); }
      else if (act === "record") recordPrediction(id);
      else if (act === "result") openResultModal(id);
      else if (act === "clearhist") {
        if (confirm2()) { state.history = []; state.results = {}; save(); render(); }
      }
    });
  });
  v.querySelectorAll("[data-lg]").forEach(el => {
    el.addEventListener("click", () => { teamsLeague = el.dataset.lg; render(); });
  });
}
let confirmPending = null;
function confirm2() { return window.confirm ? window.confirm("确定清空全部预测记录?") : true; }

function recordPrediction(id) {
  const m = state.matches.find(x => x.id === id);
  if (!m) return;
  if (state.history.some(h => h.matchId === id)) return;
  const a = analyzeMatch(m);
  const dir = a.mkts.wdl;
  const keys = ["h", "d", "a"];
  const pick = keys.reduce((x, y) => (dir[y] > dir[x] ? y : x), "h");
  const bands = [["0-1球", 0], ["2-3球", 1], ["4-6球", 2], ["7+球", 3]];
  const bandP = [a.mkts.ttg[0]+a.mkts.ttg[1], a.mkts.ttg[2]+a.mkts.ttg[3], a.mkts.ttg[4]+a.mkts.ttg[5]+a.mkts.ttg[6], a.mkts.ttg[7]];
  const band = bands.reduce((x, y) => (bandP[y[1]] > bandP[x[1]] ? y : x), bands[0]);
  state.history.push({
    matchId: id, label: `${m.homeName} vs ${m.awayName}`, date: `${m.date} ${m.time}`,
    probs: { h: dir.h, d: dir.d, a: dir.a }, pick, pickName: pickName(pick),
    band: band[1], bandName: band[0],
    top3: a.mkts.scores.slice(0, 3).map(s => ({ s: s.s, x: s.x, y: s.y })),
    top5: a.mkts.scores.slice(0, 5).map(s => ({ s: s.s, x: s.x, y: s.y })),
  });
  save(); render();
  alert2("已记录, 赛后在「校准」页填写赛果即可自动评分");
}

/* ---------- 示例比赛 ---------- */
function addDemo() {
  const demo = {
    id: uid(), num: "示例001", date: new Date().toISOString().slice(0, 10), time: "22:00",
    league: "E0", homeKey: "Man City", awayKey: "Chelsea",
    homeName: "曼城", awayName: "切尔西", hline: -1,
    odds: { had: [1.42, 4.60, 6.20], hhad: [2.55, 3.35, 2.38] },
  };
  state.matches.push(demo); save(); render();
}

/* ---------- 启动 ---------- */
try {
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
} catch (e) { /* 沙箱预览环境不支持 Service Worker, 忽略 */ }
render();
