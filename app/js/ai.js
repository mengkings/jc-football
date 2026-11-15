/* ============================================================
 * Footballs AI —— DeepSeek AI 研究 + 反对者辩论
 * API Key 由用户在设置中填写 (deepseek.com 免费注册)
 * ============================================================ */
"use strict";

const AI_MODEL = "deepseek-chat";
const AI_URL = "https://api.deepseek.com/chat/completions";

async function dsChat(messages, apiKey, temperature = 0.7) {
  const res = await fetch(AI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + apiKey },
    body: JSON.stringify({ model: AI_MODEL, messages, temperature, max_tokens: 900, stream: false }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`DeepSeek ${res.status}: ${t.slice(0, 120)}`);
  }
  const j = await res.json();
  return j.choices?.[0]?.message?.content || "(空响应)";
}

/** 构造比赛数据摘要 (供 AI 阅读的事实) */
function matchBrief(match, a) {
  const L = [];
  L.push(`比赛: ${match.homeName} (主) vs ${match.awayName} (客)`);
  if (match.leagueName) L.push(`联赛: ${match.leagueName}`);
  L.push(`开赛: ${match.date} ${match.time}`);
  const mn = { poisson: "泊松模型", elo: "Elo模型", xg: "xG模型" };
  for (const k of a.modelKeys) L.push(`${mn[k]}: 期望进球 ${a.models[k][0].toFixed(2)} : ${a.models[k][1].toFixed(2)}`);
  if (a.lhEns !== null) L.push(`三模型集成: 期望进球 ${a.lhEns.toFixed(2)} : ${a.laEns.toFixed(2)}`);
  if (a.mkt) L.push(`市场赔率隐含: 期望进球 ${a.mkt.lh.toFixed(2)} : ${a.mkt.la.toFixed(2)}`);
  L.push(`最终混合概率: 主胜 ${fmtP(a.mkts.wdl.h)} / 平局 ${fmtP(a.mkts.wdl.d)} / 客胜 ${fmtP(a.mkts.wdl.a)}`);
  L.push(`总进球区间: 0-1球 ${fmtP(a.mkts.bands[0])}, 2-3球 ${fmtP(a.mkts.bands[1])}, 4-6球 ${fmtP(a.mkts.bands[2])}, 7+球 ${fmtP(a.mkts.bands[3])}`);
  L.push(`比分Top5: ${a.mkts.scores.slice(0, 5).map(s => `${s.s}(${(s.p*100).toFixed(1)}%)`).join(", ")}`);
  if (match.odds && match.odds.had) L.push(`竞彩/市场赔率: 胜 ${match.odds.had[0]} 平 ${match.odds.had[1]} 负 ${match.odds.had[2]}`);
  if (match.hline !== null && match.hline !== undefined) L.push(`让球线: ${match.hline > 0 ? "+" : ""}${match.hline}, 让球概率: 主 ${fmtP(a.mkts.hcp.h)} 平 ${fmtP(a.mkts.hcp.d)} 客 ${fmtP(a.mkts.hcp.a)}`);
  L.push(`数据质量: ${a.quality} (模型覆盖 ${a.modelKeys.length}/3) | 风险等级: ${a.risk}`);
  if (a.divergence) L.push(`模型与市场最大分歧: ${(a.divergence.max*100).toFixed(1)} 个百分点`);
  if (a.value.length) L.push(`正EV选项: ${a.value.filter(v => v.ev > 0).map(v => `${v.market}-${v.pick} EV+${(v.ev*100).toFixed(1)}%`).join("; ") || "无"}`);
  const th = match.homeKey && DATA.leagues[match.league]?.teams[match.homeKey];
  const ta = match.awayKey && DATA.leagues[match.league]?.teams[match.awayKey];
  if (th && ta) {
    L.push(`主队近6场进${th.last6.gf}失${th.last6.ga} (Elo ${th.elo}) | 客队近6场进${ta.last6.gf}失${ta.last6.ga} (Elo ${ta.elo})`);
  }
  return L.join("\n");
}

/** 主 AI 分析 */
async function aiAnalyze(match, a, apiKey) {
  const sys = `你是专业的足球竞彩数据研究员。基于给定的多模型量化数据（泊松/Elo/xG/市场赔率），输出简洁的研究结论。必须遵守:
1. 用纯文本短段落+要点, 不使用markdown标题
2. 结构: 【核心判断】(方向+置信) → 【三个理由】(引用数据) → 【主要风险】
3. 明确给出: 胜平负方向、总进球区间、比分倾向Top3
4. 数据说话, 不编造数据中不存在的信息
5. 200字以内, 中文`;
  const user = `以下是这场比赛的量化研究数据:\n\n${matchBrief(match, a)}\n\n请给出研究结论。`;
  return dsChat([{ role: "system", content: sys }, { role: "user", content: user }], apiKey, 0.5);
}

/** 反对者 AI 辩论 */
async function aiDebate(match, a, mainAnalysis, apiKey) {
  const sys = `你是一位专门唱反调的足球数据批评家。你的任务是反驳给定的研究结论, 找出其中的漏洞、被忽略的风险和可能反噬的场景。必须遵守:
1. 用纯文本短段落+要点, 不使用markdown标题
2. 结构: 【反驳要点】(2-3条, 每条引用具体数据或逻辑漏洞) → 【最可能的翻车剧本】(具体的比分/进球场景) → 【反方结论】(该研究什么情况下完全错误)
3. 态度犀利但专业, 只基于数据推理, 不人身攻击
4. 200字以内, 中文`;
  const user = `比赛数据:\n${matchBrief(match, a)}\n\n另一位研究员的结论:\n${mainAnalysis}\n\n请反驳这个结论。`;
  return dsChat([{ role: "system", content: sys }, { role: "user", content: user }], apiKey, 0.8);
}
