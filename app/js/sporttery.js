/* ============================================================
 * 体彩竞彩官方接口直连 (getMatchCalculatorV1)
 * - 从用户手机/浏览器直接调用 (接口返回 access-control-allow-origin: *)
 * - 体彩 WAF 拦数据中心/海外 IP, 但用户本地网络正常
 * - 无需任何 Key, 返回当前在售的全部竞彩场次 + 全玩法赔率
 * ============================================================ */
const SPORTTERY_URL = "https://webapi.sporttery.cn/gateway/jc/football/getMatchCalculatorV1.qry?poolCode=hhad,had,crs,ttg,hafu&channel=c";

function fetchWithTimeout(url, ms) {
  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = ctrl && setTimeout(() => ctrl.abort(), ms);
  return fetch(url, ctrl ? { signal: ctrl.signal } : {}).finally(() => ctrl && clearTimeout(timer));
}

/* 数值清洗: 体彩赔率字段可能为 "" 或数字 */
const num = v => { const n = Number(v); return n > 1 ? n : null; };

/* 官方 JSON → App 比赛对象数组 */
function parseCalculator(data) {
  const out = [];
  const infoList = data && data.value && data.value.matchInfoList;
  if (!Array.isArray(infoList)) return out;
  for (const day of infoList) {
    const subs = day.subMatchList || [];
    for (const m of subs) {
      if (!m || !m.homeTeamAbbName || !m.awayTeamAbbName) continue;
      if (m.matchStatus && m.matchStatus !== "Selling") continue;
      const had = m.had || {}, hhad = m.hhad || {}, ttg = m.ttg || {}, hafu = m.hafu || {};
      const odds = {};
      const hArr = [num(had.h), num(had.d), num(had.a)];
      const hhArr = [num(hhad.h), num(hhad.d), num(hhad.a)];
      if (hArr.every(x => x)) odds.had = hArr;
      if (hhArr.every(x => x)) odds.hhad = hhArr;
      const ttgArr = ["s0","s1","s2","s3","s4","s5","s6","s7"].map(k => num(ttg[k]));
      if (ttgArr.every(x => x)) odds.ttg = ttgArr;
      const hfKeys = ["hh","hd","ha","dh","dd","da","ah","ad","aa"];
      const hfOdds = {};
      let hfOk = true;
      for (const k of hfKeys) { const v = num(hafu[k]); if (!v) { hfOk = false; break; } hfOdds[k] = v; }
      if (hfOk) odds.hafu = hfOdds;
      if (!odds.had && !odds.hhad && !odds.ttg) continue; // 无任何赔率的场次跳过
      const hk = matchTeamKey(m.homeTeamAbbName), ak = matchTeamKey(m.awayTeamAbbName);
      out.push({
        id: "SP" + m.matchId,
        num: m.matchNumStr || "",
        date: (m.matchDate || day.businessDate || "").slice(0, 10),
        time: (m.matchTime || "").slice(0, 5),
        league: hk && ak ? leagueOfKey(hk) : "CU",
        leagueName: m.leagueAbbName || m.leagueAllName || "竞彩",
        homeKey: hk, awayKey: ak,
        homeName: hk ? cnName(hk) : m.homeTeamAbbName,
        awayName: ak ? cnName(ak) : m.awayTeamAbbName,
        hline: hhad.goalLine !== undefined && hhad.goalLine !== "" ? Number(hhad.goalLine) : null,
        odds,
        live: true, // 标记: 体彩官方实时数据
      });
    }
  }
  return out;
}

/* 拉取体彩在售场次 (Promise<matches[]>) */
async function fetchSportteryLive() {
  const res = await fetchWithTimeout(SPORTTERY_URL, 9000);
  if (!res.ok) throw new Error("HTTP " + res.status);
  const data = await res.json();
  const matches = parseCalculator(data);
  if (!matches.length) throw new Error("接口无在售场次");
  return matches;
}
