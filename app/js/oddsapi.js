/* ============================================================
 * Footballs AI —— the-odds-api 自动赛程获取
 * 免费注册 the-odds-api.com (500请求/月), Key 在设置中填写
 * ============================================================ */
"use strict";

const ODDSAPI_BASE = "https://api.the-odds-api.com/v4";

/* 覆盖联赛 (key → 显示名)。竞彩常卖联赛优先 */
const ODDS_LEAGUES = {
  soccer_epl: "英超", soccer_spain_la_liga: "西甲", soccer_italy_serie_a: "意甲",
  soccer_germany_bundesliga: "德甲", soccer_france_ligue_one: "法甲",
  soccer_uefa_champs_league: "欧冠", soccer_uefa_europa_league: "欧联",
  soccer_japan_j_league: "日职", soccer_korea_kleague: "韩K联",
  soccer_usa_mls: "美职联", soccer_brazil_campeonato: "巴甲",
  soccer_netherlands_eredivisie: "荷甲", soccer_portugal_primeira_liga: "葡超",
  soccer_turkey_super_league: "土超", soccer_championship: "英冠",
  soccer_belgium_first_div: "比甲", soccer_switzerland_superleague: "瑞士超",
  soccer_austria_bundesliga: "奥甲", soccer_scotland_premiership: "苏超",
};

/* 球队名 → 数据库键 (别名 + 规范化匹配) */
function resolveTeam(name) {
  if (!name) return null;
  const raw = String(name).trim();
  const data = DATA;
  if (data.alias[raw]) return data.alias[raw];
  if (data.cn[raw]) return raw;
  // 规范化: 去变音符/小写/去常见冗词
  const norm = s => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/\b(fc|afc|sc|cfc|sv|as|ac|cd|rc|ud|sd|us|ss|ssd|vfb|vfl|tsg|bsc|hsc|calcio|club|de|the|1\.|1)\b/g, " ")
    .replace(/[^a-z\s]/g, "").replace(/\s+/g, " ").trim();
  const nr = norm(raw);
  if (!nr) return null;
  const entries = [...Object.keys(data.leagues).flatMap(lg => Object.keys(data.leagues[lg].teams))];
  let best = null, bestLen = 0;
  for (const k of entries) {
    const nk = norm(k);
    if (!nk) continue;
    if (nk === nr) return k;
    if (nk.length >= 4 && (nr.includes(nk) || nk.includes(nr))) {
      if (nk.length > bestLen) { best = k; bestLen = nk.length; }
    }
  }
  // 中文名直接匹配
  for (const [k, v] of Object.entries(data.cn)) if (v === raw) return k;
  return best;
}

/**
 * 获取某联赛未来比赛 + 平均赔率
 * 返回: [{date, time, homeName, awayName, homeKey, awayKey, league, leagueName, odds:{had}}]
 */
async function fetchLeague(sportKey, apiKey) {
  const url = `${ODDSAPI_BASE}/sports/${sportKey}/odds/?apiKey=${encodeURIComponent(apiKey)}&regions=eu,uk&markets=h2h&oddsFormat=decimal`;
  const res = await fetch(url);
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`API ${res.status}${res.status === 401 ? " (Key无效)" : ""} ${t.slice(0, 80)}`);
  }
  const games = await res.json();
  const out = [];
  for (const g of games) {
    if (!g.bookmakers?.length) continue;
    // 对所有博彩公司取中位赔率
    const collect = (team) => {
      const prices = g.bookmakers.map(b => b.markets?.find(mk => mk.key === "h2h")?.outcomes.find(o => o.name === team)?.price).filter(p => p > 1);
      if (!prices.length) return null;
      prices.sort((x, y) => x - y);
      return prices[Math.floor(prices.length / 2)];
    };
    const oh = collect(g.home_team), oa = collect(g.away_team);
    const od = (() => {
      const prices = g.bookmakers.map(b => b.markets?.find(mk => mk.key === "h2h")?.outcomes.find(o => o.name === "Draw")?.price).filter(p => p > 1);
      if (!prices.length) return null;
      prices.sort((x, y) => x - y);
      return prices[Math.floor(prices.length / 2)];
    })();
    if (!oh || !oa || !od) continue;
    const t = new Date(g.commence_time);
    const hk = resolveTeam(g.home_team), ak = resolveTeam(g.away_team);
    out.push({
      date: t.toISOString().slice(0, 10), time: t.toTimeString().slice(0, 5),
      homeName: hk ? DATA.cn[hk] : g.home_team, awayName: ak ? DATA.cn[ak] : g.away_team,
      homeKey: hk, awayKey: ak,
      league: hk && ak ? leagueOfKey(hk) : "CU",
      leagueName: ODDS_LEAGUES[sportKey] || sportKey,
      odds: { had: [oh, od, oa] },
      hline: null,
    });
  }
  return out;
}
function leagueOfKey(key) {
  for (const [lg, conf] of Object.entries(DATA.leagues)) if (conf.teams[key]) return lg;
  return "CU";
}
