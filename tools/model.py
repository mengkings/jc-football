#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
竞彩足球预测模型 —— 训练 / 回测 / 导出
模型: 时间加权泊松 (Dixon-Coles 低比分修正)
数据: football-data.co.uk 五大联赛 2024-25 / 2025-26 赛季 (免费)
输出:
  app/ratings.json  —— 球队攻防评分数据库 (供 App 内置)
  data/backtest.json —— 回测明细与策略验证结果
"""
import csv, json, math, os, sys
from datetime import datetime, timedelta

BASE = os.path.join(os.path.dirname(__file__), "..")
DATA = os.path.join(BASE, "data")
APP = os.path.join(BASE, "app")

LEAGUES = {"E0": "英超", "SP1": "西甲", "I1": "意甲", "D1": "德甲", "F1": "法甲"}

def parse_date(s):
    for fmt in ("%d/%m/%Y", "%d/%m/%y"):
        try:
            return datetime.strptime(s.strip(), fmt)
        except Exception:
            pass
    return None

def load_matches():
    matches = []
    for fname in os.listdir(DATA):
        if not fname.endswith(".csv") or "_" not in fname:
            continue
        code, season = fname.replace(".csv", "").split("_")
        if code not in LEAGUES:
            continue
        with open(os.path.join(DATA, fname), encoding="utf-8-sig") as f:
            for row in csv.DictReader(f):
                d = parse_date(row.get("Date", ""))
                if d is None:
                    continue
                try:
                    hg, ag = int(row["FTHG"]), int(row["FTAG"])
                    hh, ha = int(row.get("HTHG") or 0), int(row.get("HTAG") or 0)
                except (ValueError, KeyError):
                    continue
                odds = {}
                for k, o in (("H", "AvgH"), ("D", "AvgD"), ("A", "AvgA")):
                    try:
                        odds[k] = float(row[o]) if row.get(o) else None
                    except ValueError:
                        odds[k] = None
                matches.append({
                    "league": code, "date": d, "season": season,
                    "home": row["HomeTeam"].strip(), "away": row["AwayTeam"].strip(),
                    "hg": hg, "ag": ag, "hh": hh, "ha": ha,
                    "odds": odds,
                })
    matches.sort(key=lambda m: m["date"])
    return matches

# ---------------- 模型 ----------------

def pois(lmb, k):
    return math.exp(-lmb) * lmb**k / math.factorial(k)

def dc_tau(x, y, lh, la, rho):
    """Dixon-Coles 低比分修正因子"""
    if x == 0 and y == 0: return 1.0 - lh*la*rho
    if x == 0 and y == 1: return 1.0 + lh*rho
    if x == 1 and y == 0: return 1.0 + la*rho
    if x == 1 and y == 1: return 1.0 - rho
    return 1.0

def score_matrix(lh, la, rho=0.0, maxg=8):
    m = [[pois(lh, x) * pois(la, y) * dc_tau(x, y, lh, la, rho)
          for y in range(maxg+1)] for x in range(maxg+1)]
    s = sum(sum(r) for r in m)
    return [[p/s for p in r] for r in m]

def wdl_from_matrix(m):
    h = sum(m[x][y] for x in range(len(m)) for y in range(len(m)) if x > y)
    d = sum(m[x][y] for x in range(len(m)) for y in range(len(m)) if x == y)
    return h, d, 1.0-h-d

def log_loss(wdl_probs, actual):
    idx = {"H": 0, "D": 1, "A": 2}[actual]
    p = max(wdl_probs[idx], 1e-6)
    return -math.log(p)

class LeagueModel:
    """时间加权 attack/defense 泊松模型 (含主场优势)"""
    def __init__(self, half_life_days=240.0):
        self.half_life = half_life_days
        self.att = {}; self.dfn = {}
        self.mu_h = 1.5; self.mu_a = 1.2
        self.rho = 0.0
        self.ref_date = None

    def _w(self, d):
        return 0.5 ** (max((self.ref_date - d).days, 0) / self.half_life)

    def fit(self, matches, iterations=60, rho_grid=None):
        self.ref_date = max(m["date"] for m in matches)
        teams = set()
        for m in matches:
            teams.add(m["home"]); teams.add(m["away"])
        # 初始化
        self.att = {t: 1.0 for t in teams}
        self.dfn = {t: 1.0 for t in teams}
        # 迭代拟合 (加权 EM 风格)
        for _ in range(iterations):
            # 联赛均值 (主场/客场)
            num_h = num_a = wsum = 0.0
            for m in matches:
                w = self._w(m["date"])
                lh = self.mu_h * self.att[m["home"]] * self.dfn[m["away"]]
                la = self.mu_a * self.att[m["away"]] * self.dfn[m["home"]]
                # 期望进球 (在条件于比分的泊松下即实际进球)
                num_h += w * m["hg"]; num_a += w * m["ag"]
                wsum += w
            self.mu_h = num_h / wsum / max(sum(self._w(m['date'])*self.att[m['home']]*self.dfn[m['away']] for m in matches) / wsum, 1e-9)
            self.mu_a = num_a / wsum / max(sum(self._w(m['date'])*self.att[m['away']]*self.dfn[m['home']] for m in matches) / wsum, 1e-9)
            # 攻击/防守强度
            for t in teams:
                num_att = num_dfn = den_att = den_dfn = 0.0
                for m in matches:
                    w = self._w(m["date"])
                    if m["home"] == t:
                        num_att += w * m["hg"]; den_att += w * self.mu_h * self.dfn[m["away"]]
                        num_dfn += w * m["ag"]; den_dfn += w * self.mu_a * self.att[m["away"]]
                    elif m["away"] == t:
                        num_att += w * m["ag"]; den_att += w * self.mu_a * self.dfn[m["home"]]
                        num_dfn += w * m["hg"]; den_dfn += w * self.mu_h * self.att[m["home"]]
                if den_att > 0: self.att[t] = num_att / den_att
                if den_dfn > 0: self.dfn[t] = num_dfn / den_dfn
            # 归一化 (均值=1)
            ma = sum(self.att.values()) / len(self.att)
            md = sum(self.dfn.values()) / len(self.dfn)
            for t in teams:
                self.att[t] /= ma; self.dfn[t] /= md
        # rho 网格搜索
        if rho_grid is None:
            rho_grid = [i/100.0 for i in range(-20, 21, 2)]
        best_ll, best_rho = -1e18, 0.0
        for rho in rho_grid:
            ll = 0.0
            for m in matches:
                lh = self.mu_h * self.att[m["home"]] * self.dfn[m["away"]]
                la = self.mu_a * self.att[m["away"]] * self.dfn[m["home"]]
                try:
                    ll += math.log(pois(lh, m["hg"]) * pois(la, m["ag"]) *
                                   dc_tau(m["hg"], m["ag"], lh, la, rho))
                except ValueError:
                    ll += -1e6
            if ll > best_ll:
                best_ll, best_rho = ll, rho
        self.rho = best_rho
        return self

    def lambdas(self, home, away):
        lh = self.mu_h * self.att.get(home, 1.0) * self.dfn.get(away, 1.0)
        la = self.mu_a * self.att.get(away, 1.0) * self.dfn.get(home, 1.0)
        return lh, la

    def probs(self, home, away):
        lh, la = self.lambdas(home, away)
        m = score_matrix(lh, la, self.rho)
        return wdl_from_matrix(m), m, (lh, la)

# ---------------- 回测 ----------------

def totals_band(goals):
    if goals <= 1: return 0
    if goals <= 3: return 1
    if goals <= 6: return 2
    return 3

BANDS = ["0-1球", "2-3球", "4-6球", "7+球"]

def run_backtest(matches, league):
    """滚动回测: 用前70%训练, 预测后30%"""
    lm = matches[: int(len(matches)*0.7)]
    tm = matches[int(len(matches)*0.7): ]
    if len(lm) < 40 or len(tm) < 15:
        return None
    model = LeagueModel().fit(lm)
    res = {"n": len(tm), "correct": 0, "market_correct": 0, "ll_model": 0.0,
           "ll_market": 0.0, "brier_model": 0.0, "brier_market": 0.0,
           "band_correct": 0, "score_top5": 0, "score_top3": 0,
           "details": []}
    for m in tm:
        (ph, pd_, pa), mat, (lh, la) = model.probs(m["home"], m["away"])
        probs = (ph, pd_, pa)
        actual = {"H": 0, "D": 1, "A": 2}[ "H" if m["hg"]>m["ag"] else ("A" if m["hg"]<m["ag"] else "D")]
        pick = max(range(3), key=lambda i: probs[i])
        res["correct"] += (pick == actual)
        # 市场热门
        if m["odds"].get("H") and m["odds"].get("D") and m["odds"].get("A"):
            oh = 1/m["odds"]["H"]; od = 1/m["odds"]["D"]; oa = 1/m["odds"]["A"]
            s = oh+od+oa
            mk = (oh/s, od/s, oa/s)
            mpick = max(range(3), key=lambda i: mk[i])
            res["market_correct"] += (mpick == actual)
            res["ll_market"] += log_loss(mk, "HDA"[actual])
            res["brier_market"] += sum((mk[i] - (1 if i==actual else 0))**2 for i in range(3))
            res["market_n"] = res.get("market_n", 0) + 1
        else:
            mk = None
        res["ll_model"] += log_loss(probs, "HDA"[actual])
        res["brier_model"] += sum((probs[i] - (1 if i==actual else 0))**2 for i in range(3))
        # 总进球区间
        bands = [0.0]*4
        for x in range(9):
            for y in range(9):
                if x+y <= 8:
                    bands[totals_band(x+y)] += mat[x][y]
        bpick = max(range(4), key=lambda i: bands[i])
        res["band_correct"] += (bpick == totals_band(m["hg"]+m["ag"]))
        # 比分 top5
        scores = sorted(((mat[x][y], x, y) for x in range(9) for y in range(9)), reverse=True)[:5]
        res["score_top5"] += any(x==m["hg"] and y==m["ag"] for _, x, y in scores)
        res["score_top3"] += any(x==m["hg"] and y==m["ag"] for _, x, y in scores[:3])
        res["details"].append({
            "date": m["date"].strftime("%Y-%m-%d"), "home": m["home"], "away": m["away"],
            "score": f"{m['hg']}-{m['ag']}", "actual": "HDA"[actual],
            "model": [round(p,4) for p in probs], "pick": "HDA"[pick],
            "market": [round(v,4) for v in mk] if mk else None,
        })
    return res

def strategy_validation(matches, league):
    """策略验证: 不同选场策略的命中率与 ROI (以市场平均赔率为赔付基准)"""
    lm = matches[: int(len(matches)*0.7)]
    tm = matches[int(len(matches)*0.7): ]
    if len(tm) < 15:
        return None
    model = LeagueModel().fit(lm)
    strategies = {
        "模型最高概率(无过滤)": lambda p, mk: max(range(3), key=lambda i: p[i]),
        "高置信(p>50%)": lambda p, mk: (max(range(3), key=lambda i: p[i]) if max(p) > 0.5 else None),
        "模型与市场一致": lambda p, mk: (max(range(3), key=lambda i: p[i]) if mk and max(range(3), key=lambda i: p[i]) == max(range(3), key=lambda i: mk[i]) else None),
        "存在价值差(p>市场5个百分点)": lambda p, mk: (max(range(3), key=lambda i: p[i]) if mk and max(range(3), key=lambda i: p[i]-mk[i]) >= 0 and max(p) - max(mk) >= 0.05 else None),
    }
    out = {}
    for name, fn in strategies.items():
        n = hit = 0; ret = 0.0
        for m in tm:
            (ph, pd_, pa), mat, _ = model.probs(m["home"], m["away"])
            p = (ph, pd_, pa)
            o = m["odds"]
            if not (o.get("H") and o.get("D") and o.get("A")):
                continue
            oh = 1/o["H"]; od = 1/o["D"]; oa = 1/o["A"]
            s = oh+od+oa
            mk = (oh/s, od/s, oa/s)
            pick = fn(p, mk)
            if pick is None:
                continue
            n += 1
            actual = "H" if m["hg"]>m["ag"] else ("A" if m["hg"]<m["ag"] else "D")
            odds = [o["H"], o["D"], o["A"]][pick]
            if "HDA"[pick] == actual:
                hit += 1; ret += odds - 1
            else:
                ret -= 1
        out[name] = {"n": n, "hit": hit, "hit_rate": round(hit/n, 4) if n else 0,
                     "roi": round(ret/n, 4) if n else 0}
    return out

# ---------------- 主流程 ----------------

def main():
    all_matches = load_matches()
    print(f"共加载 {len(all_matches)} 场比赛 "
          f"({all_matches[0]['date'].date()} ~ {all_matches[0]['date'].date() if not all_matches else all_matches[-1]['date'].date()})")
    backtest, strat = {}, {}
    for lg in LEAGUES:
        ms = [m for m in all_matches if m["league"] == lg and m["season"] == "2425"]
        bt = run_backtest(ms, lg)
        if bt: backtest[lg] = bt
        st = strategy_validation(ms, lg)
        if st: strat[lg] = st

    # 汇总
    tot = {"n": sum(b["n"] for b in backtest.values()),
           "correct": sum(b["correct"] for b in backtest.values()),
           "market_correct": sum(b["market_correct"] for b in backtest.values()),
           "market_n": sum(b.get("market_n", 0) for b in backtest.values()),
           "ll_model": sum(b["ll_model"] for b in backtest.values()),
           "ll_market": sum(b["ll_market"] for b in backtest.values()),
           "brier_model": sum(b["brier_model"] for b in backtest.values()),
           "brier_market": sum(b["brier_market"] for b in backtest.values()),
           "band_correct": sum(b["band_correct"] for b in backtest.values()),
           "score_top5": sum(b["score_top5"] for b in backtest.values()),
           "score_top3": sum(b["score_top3"] for b in backtest.values())}
    n = tot["n"]
    print(f"\n===== 回测汇总 (2425赛季, 训练70%/预测30%, n={n}) =====")
    print(f"胜平负方向命中率: 模型 {tot['correct']/n:.1%} | 市场热门 {tot['market_correct']/max(tot['market_n'],1):.1%}")
    print(f"对数损失: 模型 {tot['ll_model']/n:.4f} | 市场 {tot['ll_market']/max(tot['market_n'],1):.4f}")
    print(f"Brier:   模型 {tot['brier_model']/n:.4f} | 市场 {tot['brier_market']/max(tot['market_n'],1):.4f}")
    print(f"总进球区间命中率: {tot['band_correct']/n:.1%}")
    print(f"比分Top3命中率: {tot['score_top3']/n:.1%} | Top5: {tot['score_top5']/n:.1%}")
    print("\n===== 策略验证 (以市场平均赔率结算) =====")
    agg = {}
    for lg, sts in strat.items():
        for name, s in sts.items():
            a = agg.setdefault(name, {"n":0,"hit":0,"ret":0.0})
            a["n"] += s["n"]; a["hit"] += s["hit"]; a["ret"] += s["roi"]*s["n"]
    for name, a in agg.items():
        if a["n"]:
            print(f"{name}: n={a['n']} 命中率={a['hit']/a['n']:.1%} ROI={a['ret']/a['n']:+.1%}")

    # 导出 ratings.json (用全部数据, 时间加权)
    ratings = {"meta": {"generated": datetime.now().isoformat(), "source": "football-data.co.uk",
                        "leagues": LEAGUES, "half_life_days": 240},
               "leagues": {}}
    for lg in LEAGUES:
        ms = [m for m in all_matches if m["league"] == lg]
        model = LeagueModel().fit(ms)
        teams = {}
        for t in set(model.att) | set(model.dfn):
            recent = [m for m in ms if t in (m["home"], m["away"])][-6:]
            gf = ga = 0
            for m in recent:
                if m["home"] == t: gf += m["hg"]; ga += m["ag"]
                else: gf += m["ag"]; ga += m["hg"]
            teams[t] = {
                "att": round(model.att[t], 4), "def": round(model.dfn[t], 4),
                "n": sum(1 for m in ms if t in (m["home"], m["away"])),
                "last6_gf": gf, "last6_ga": ga,
                "last6": len(recent),
            }
        ratings["leagues"][lg] = {
            "name": LEAGUES[lg],
            "mu_h": round(model.mu_h, 4), "mu_a": round(model.mu_a, 4),
            "rho": round(model.rho, 4),
            "teams": teams,
        }
        print(f"{LEAGUES[lg]}: mu_h={model.mu_h:.3f} mu_a={model.mu_a:.3f} rho={model.rho} 球队数={len(teams)}")

    with open(os.path.join(APP, "ratings.json"), "w", encoding="utf-8") as f:
        json.dump(ratings, f, ensure_ascii=False)
    # 回测明细
    bt_out = {"summary": {k: (round(v/n,4) if k in ("ll_model","ll_market","brier_model","brier_market") else v) for k,v in tot.items()},
              "leagues": {lg: {k: v for k, v in b.items() if k != "details"} for lg, b in backtest.items()},
              "strategies": strat,
              "details": {lg: b["details"][:60] for lg, b in backtest.items()}}
    with open(os.path.join(DATA, "backtest.json"), "w", encoding="utf-8") as f:
        json.dump(bt_out, f, ensure_ascii=False)
    print(f"\n已导出: app/ratings.json ({os.path.getsize(os.path.join(APP,'ratings.json'))//1024}KB), data/backtest.json")

if __name__ == "__main__":
    main()
