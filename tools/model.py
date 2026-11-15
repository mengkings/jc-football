#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Footballs AI —— 多模型引擎 (v2)
模型: ①时间加权泊松 (Dixon-Coles) ②Elo ③xG代理(射正数据) → 集成
数据: football-data.co.uk 五大联赛 2024-25 / 2025-26 赛季 (免费)
输出:
  app/js/data.js         —— 全部评分数据 (供 App 内置)
  data/backtest.json     —— 回测明细与策略验证
"""
import csv, json, math, os
from datetime import datetime

BASE = os.path.join(os.path.dirname(__file__), "..")
DATA = os.path.join(BASE, "data")
APP = os.path.join(BASE, "app")

LEAGUES = {"E0": "英超", "SP1": "西甲", "I1": "意甲", "D1": "德甲", "F1": "法甲"}
MODELS = ["poisson", "elo", "xg"]

def parse_date(s):
    for fmt in ("%d/%m/%Y", "%d/%m/%y"):
        try: return datetime.strptime(s.strip(), fmt)
        except Exception: pass
    return None

def load_matches():
    matches = []
    for fname in os.listdir(DATA):
        if not fname.endswith(".csv") or "_" not in fname: continue
        code, season = fname.replace(".csv", "").split("_")
        if code not in LEAGUES: continue
        with open(os.path.join(DATA, fname), encoding="utf-8-sig") as f:
            for row in csv.DictReader(f):
                d = parse_date(row.get("Date", ""))
                if d is None: continue
                try:
                    hg, ag = int(row["FTHG"]), int(row["FTAG"])
                    hh, ha = int(row.get("HTHG") or 0), int(row.get("HTAG") or 0)
                    hst = int(row.get("HST") or 0); ast = int(row.get("AST") or 0)
                except (ValueError, KeyError): continue
                odds = {}
                for k, o in (("H","AvgH"),("D","AvgD"),("A","AvgA")):
                    try: odds[k] = float(row[o]) if row.get(o) else None
                    except ValueError: odds[k] = None
                matches.append({"league": code, "date": d, "season": season,
                    "home": row["HomeTeam"].strip(), "away": row["AwayTeam"].strip(),
                    "hg": hg, "ag": ag, "hh": hh, "ha": ha, "hst": hst, "ast": ast, "odds": odds})
    matches.sort(key=lambda m: m["date"])
    return matches

# ---------------- 泊松 ----------------
def pois(lmb, k): return math.exp(-lmb) * lmb**k / math.factorial(k)

def dc_tau(x, y, lh, la, rho):
    if x==0 and y==0: return 1.0 - lh*la*rho
    if x==0 and y==1: return 1.0 + lh*rho
    if x==1 and y==0: return 1.0 + la*rho
    if x==1 and y==1: return 1.0 - rho
    return 1.0

def score_matrix(lh, la, rho=0.0, maxg=8):
    m = [[pois(lh,x)*pois(la,y)*dc_tau(x,y,lh,la,rho) for y in range(maxg+1)] for x in range(maxg+1)]
    s = sum(sum(r) for r in m)
    return [[p/s for p in r] for r in m]

def wdl_from_matrix(m):
    h = sum(m[x][y] for x in range(len(m)) for y in range(len(m)) if x>y)
    d = sum(m[x][y] for x in range(len(m)) for y in range(len(m)) if x==y)
    return h, d, 1.0-h-d

class PoissonModel:
    def __init__(self, half_life_days=240.0):
        self.half_life = half_life_days
        self.att = {}; self.dfn = {}; self.mu_h = 1.5; self.mu_a = 1.2; self.rho = 0.0
        self.ref_date = None
    def _w(self, d): return 0.5 ** (max((self.ref_date-d).days,0)/self.half_life)
    def fit(self, matches, iterations=60):
        self.ref_date = max(m["date"] for m in matches)
        teams = set()
        for m in matches: teams.add(m["home"]); teams.add(m["away"])
        self.att = {t:1.0 for t in teams}; self.dfn = {t:1.0 for t in teams}
        for _ in range(iterations):
            num_h = num_a = wsum = 0.0
            for m in matches:
                w = self._w(m["date"])
                num_h += w*m["hg"]; num_a += w*m["ag"]; wsum += w
            self.mu_h = num_h/wsum / max(sum(self._w(m['date'])*self.att[m['home']]*self.dfn[m['away']] for m in matches)/wsum, 1e-9)
            self.mu_a = num_a/wsum / max(sum(self._w(m['date'])*self.att[m['away']]*self.dfn[m['home']] for m in matches)/wsum, 1e-9)
            for t in teams:
                na = nd = da = dd = 0.0
                for m in matches:
                    w = self._w(m["date"])
                    if m["home"] == t:
                        na += w*m["hg"]; da += w*self.mu_h*self.dfn[m["away"]]
                        nd += w*m["ag"]; dd += w*self.mu_a*self.att[m["away"]]
                    elif m["away"] == t:
                        na += w*m["ag"]; da += w*self.mu_a*self.dfn[m["home"]]
                        nd += w*m["hg"]; dd += w*self.mu_h*self.att[m["home"]]
                if da > 0: self.att[t] = na/da
                if dd > 0: self.dfn[t] = nd/dd
            ma = sum(self.att.values())/len(self.att); md = sum(self.dfn.values())/len(self.dfn)
            for t in teams: self.att[t] /= ma; self.dfn[t] /= md
        best_ll, best_rho = -1e18, 0.0
        for rho in [i/100.0 for i in range(-20,21,2)]:
            ll = 0.0
            for m in matches:
                lh = self.mu_h*self.att[m["home"]]*self.dfn[m["away"]]
                la = self.mu_a*self.att[m["away"]]*self.dfn[m["home"]]
                try: ll += math.log(pois(lh,m["hg"])*pois(la,m["ag"])*dc_tau(m["hg"],m["ag"],lh,la,rho))
                except ValueError: ll += -1e6
            if ll > best_ll: best_ll, best_rho = ll, rho
        self.rho = best_rho
        return self
    def lambdas(self, home, away):
        return (self.mu_h*self.att.get(home,1.0)*self.dfn.get(away,1.0),
                self.mu_a*self.att.get(away,1.0)*self.dfn.get(home,1.0))

# ---------------- Elo ----------------
class EloModel:
    """在线 Elo + Elo差→净胜球 线性回归"""
    def __init__(self, k=20.0, ha=60.0, start=1500.0):
        self.k = k; self.ha = ha; self.start = start
        self.elo = {}; self.reg_a = 0.0; self.reg_b = 0.35
        self.avg_total = 2.7
    def _elo(self, t): return self.elo.get(t, self.start)
    def process(self, matches):
        """按时间顺序在线更新, 同时收集 (赛前elo差, 实际净胜球) 样本"""
        xs, ys = [], []
        for m in matches:
            eh, ea = self._elo(m["home"]), self._elo(m["away"])
            diff = eh + self.ha - ea
            xs.append(diff); ys.append(m["hg"] - m["ag"])
            expected = 1.0/(1.0+10**(-diff/400.0))
            actual = 1.0 if m["hg"]>m["ag"] else (0.0 if m["hg"]<m["ag"] else 0.5)
            delta = self.k*(actual-expected)
            self.elo[m["home"]] = eh + delta
            self.elo[m["away"]] = ea - delta
        # 线性回归 y = a + b*x
        n = len(xs)
        mx = sum(xs)/n; my = sum(ys)/n
        sxy = sum((x-mx)*(y-my) for x,y in zip(xs,ys))
        sxx = sum((x-mx)**2 for x in xs)
        self.reg_b = sxy/sxx if sxx > 0 else 0.3
        self.reg_a = my - self.reg_b*mx
        self.avg_total = sum(m["hg"]+m["ag"] for m in matches)/n
        return self
    def lambdas(self, home, away):
        diff = self._elo(home) + self.ha - self._elo(away)
        sup = self.reg_a + self.reg_b*diff  # 期望净胜球
        lh = max((self.avg_total + sup)/2, 0.15)
        la = max((self.avg_total - sup)/2, 0.15)
        return lh, la

# ---------------- xG 代理 (射正数据) ----------------
class XGModel:
    """基于射正(SoT)的攻防强度 → 期望进球"""
    def __init__(self, half_life_days=240.0):
        self.half_life = half_life_days
        self.att = {}; self.dfn = {}; self.conv = 0.33
        self.ref_date = None
    def _w(self, d): return 0.5 ** (max((self.ref_date-d).days,0)/self.half_life)
    def fit(self, matches, iterations=40):
        self.ref_date = max(m["date"] for m in matches)
        teams = set()
        for m in matches: teams.add(m["home"]); teams.add(m["away"])
        self.att = {t:1.0 for t in teams}; self.dfn = {t:1.0 for t in teams}
        # 场均射正基准
        tot_sot = sum(m["hst"]+m["ast"] for m in matches)
        self.base_sot = tot_sot/len(matches)/2.0  # 单队场均射正
        for _ in range(iterations):
            for t in teams:
                na = nd = da = dd = 0.0
                for m in matches:
                    w = self._w(m["date"])
                    if m["home"] == t:
                        na += w*m["hst"]; da += w*self.dfn[m["away"]]
                        nd += w*m["ast"]; dd += w*self.att[m["away"]]
                    elif m["away"] == t:
                        na += w*m["ast"]; da += w*self.dfn[m["home"]]
                        nd += w*m["hst"]; dd += w*self.att[m["home"]]
                if da > 0: self.att[t] = na/da
                if dd > 0: self.dfn[t] = nd/dd
            ma = sum(self.att.values())/len(self.att); md = sum(self.dfn.values())/len(self.dfn)
            for t in teams: self.att[t] /= ma; self.dfn[t] /= md
        # 转化率 = 进球 / 射正
        goals = sum(m["hg"]+m["ag"] for m in matches)
        sots = sum(m["hst"]+m["ast"] for m in matches)
        self.conv = goals/sots if sots > 0 else 0.33
        return self
    def lambdas(self, home, away):
        eh = self.base_sot*self.att.get(home,1.0)*self.dfn.get(away,1.0)
        ea = self.base_sot*self.att.get(away,1.0)*self.dfn.get(home,1.0)
        return max(eh*self.conv, 0.15), max(ea*self.conv, 0.15)

# ---------------- 集成 ----------------
class Ensemble:
    def __init__(self):
        self.pm = None; self.em = None; self.xm = None
    def fit(self, matches):
        self.pm = PoissonModel().fit(matches)
        self.em = EloModel().process(matches)
        self.xm = XGModel().fit(matches)
        return self
    def model_lambdas(self, home, away):
        out = {}
        out["poisson"] = self.pm.lambdas(home, away)
        out["elo"] = self.em.lambdas(home, away)
        out["xg"] = self.xm.lambdas(home, away)
        return out
    def ensemble_lambdas(self, home, away):
        ms = self.model_lambdas(home, away)
        lh = sum(v[0] for v in ms.values())/len(ms)
        la = sum(v[1] for v in ms.values())/len(ms)
        return lh, la, ms
    def probs(self, home, away, rho):
        lh, la, ms = self.ensemble_lambdas(home, away)
        m = score_matrix(lh, la, rho)
        return wdl_from_matrix(m), m, (lh, la), ms

# ---------------- 回测 ----------------
def totals_band(g):
    if g <= 1: return 0
    if g <= 3: return 1
    if g <= 6: return 2
    return 3

def backtest(matches, rho_default=-0.06):
    lm = matches[:int(len(matches)*0.7)]
    tm = matches[int(len(matches)*0.7):]
    if len(lm) < 40 or len(tm) < 15: return None
    ens = Ensemble().fit(lm)
    rho = ens.pm.rho
    res = {"n": len(tm), "ll": 0.0, "correct": 0, "band": 0, "s3": 0, "s5": 0,
           "brier": 0.0, "model_ll": {}, "model_correct": {}, "details": []}
    for name in MODELS: res["model_ll"][name] = 0.0; res["model_correct"][name] = 0
    market_ll = 0.0; market_n = 0; market_correct = 0
    blend_ll = 0.0; blend_correct = 0
    for m in tm:
        (ph, pd_, pa), mat, (lh, la), ms = ens.probs(m["home"], m["away"], rho)
        probs = (ph, pd_, pa)
        actual = 0 if m["hg"]>m["ag"] else (2 if m["hg"]<m["ag"] else 1)
        pick = max(range(3), key=lambda i: probs[i])
        res["correct"] += (pick == actual)
        res["ll"] += -math.log(max(probs[actual],1e-6))
        res["brier"] += sum((probs[i]-(1 if i==actual else 0))**2 for i in range(3))
        # 单模型对比
        for name in MODELS:
            lh2, la2 = ms[name]
            p2 = wdl_from_matrix(score_matrix(lh2, la2, rho))
            pk2 = max(range(3), key=lambda i: p2[i])
            res["model_correct"][name] += (pk2 == actual)
            res["model_ll"][name] += -math.log(max(p2[actual],1e-6))
        # 市场
        o = m["odds"]
        if o.get("H") and o.get("D") and o.get("A"):
            oh, od, oa = 1/o["H"], 1/o["D"], 1/o["A"]
            s = oh+od+oa
            mk = (oh/s, od/s, oa/s)
            mpick = max(range(3), key=lambda i: mk[i])
            market_correct += (mpick == actual); market_ll += -math.log(max(mk[actual],1e-6)); market_n += 1
            # 40/60 混合
            bp = tuple(0.4*probs[i]+0.6*mk[i] for i in range(3))
            bpick = max(range(3), key=lambda i: bp[i])
            blend_correct += (bpick == actual); blend_ll += -math.log(max(bp[actual],1e-6))
        # 区间 / 比分
        bands = [0.0]*4
        for x in range(9):
            for y in range(9):
                if x+y <= 8: bands[totals_band(x+y)] += mat[x][y]
        bpick = max(range(4), key=lambda i: bands[i])
        res["band"] += (bpick == totals_band(m["hg"]+m["ag"]))
        scores = sorted(((mat[x][y],x,y) for x in range(9) for y in range(9)), reverse=True)[:5]
        res["s5"] += any(x==m["hg"] and y==m["ag"] for _,x,y in scores)
        res["s3"] += any(x==m["hg"] and y==m["ag"] for _,x,y in scores[:3])
    res["market_ll"] = market_ll; res["market_n"] = market_n; res["market_correct"] = market_correct
    res["blend_ll"] = blend_ll; res["blend_correct"] = blend_correct
    return res

# ---------------- 主流程 ----------------
def main():
    all_matches = load_matches()
    print(f"加载 {len(all_matches)} 场比赛")
    # 回测 (2425 赛季)
    tot = {"n":0,"correct":0,"ll":0.0,"band":0,"s3":0,"s5":0,"brier":0.0,
           "model_correct":{k:0 for k in MODELS},"model_ll":{k:0.0 for k in MODELS},
           "market_ll":0.0,"market_n":0,"market_correct":0,"blend_ll":0.0,"blend_correct":0}
    for lg in LEAGUES:
        ms = [m for m in all_matches if m["league"]==lg and m["season"]=="2425"]
        r = backtest(ms)
        if not r: continue
        for k in ("n","correct","band","s3","s5"): tot[k] += r[k]
        tot["ll"] += r["ll"]; tot["brier"] += r["brier"]
        for k in MODELS:
            tot["model_correct"][k] += r["model_correct"][k]; tot["model_ll"][k] += r["model_ll"][k]
        tot["market_ll"] += r["market_ll"]; tot["market_n"] += r["market_n"]
        tot["market_correct"] += r["market_correct"]
        tot["blend_ll"] += r["blend_ll"]; tot["blend_correct"] += r["blend_correct"]
    n = tot["n"]; mn = max(tot["market_n"],1)
    print(f"\n===== 多模型回测 (2425赛季, 70/30, n={n}) =====")
    for k in MODELS:
        print(f"  {k:8s}: 命中率 {tot['model_correct'][k]/n:.1%}  对数损失 {tot['model_ll'][k]/n:.4f}")
    print(f"  集成     : 命中率 {tot['correct']/n:.1%}  对数损失 {tot['ll']/n:.4f}")
    print(f"  市场     : 命中率 {tot['market_correct']/mn:.1%}  对数损失 {tot['market_ll']/mn:.4f}")
    print(f"  集成40/60混合: 命中率 {tot['blend_correct']/mn:.1%}  对数损失 {tot['blend_ll']/mn:.4f}")
    print(f"  进球区间 {tot['band']/n:.1%} | 比分Top3 {tot['s3']/n:.1%} Top5 {tot['s5']/n:.1%} | Brier {tot['brier']/n:.4f}")

    # 导出全量数据
    out = {"meta": {"generated": datetime.now().isoformat(), "source": "football-data.co.uk",
                    "half_life_days": 240, "models": MODELS},
           "leagues": {}}
    for lg in LEAGUES:
        ms = [m for m in all_matches if m["league"]==lg]
        ens = Ensemble().fit(ms)
        teams = {}
        for t in set(ens.pm.att) | set(ens.em.elo):
            recent = [m for m in ms if t in (m["home"],m["away"])][-6:]
            gf = ga = gf_sot = ga_sot = 0
            for m in recent:
                if m["home"]==t: gf+=m["hg"]; ga+=m["ag"]; gf_sot+=m["hst"]; ga_sot+=m["ast"]
                else: gf+=m["ag"]; ga+=m["hg"]; gf_sot+=m["ast"]; ga_sot+=m["hst"]
            teams[t] = {
                "poisson_att": round(ens.pm.att.get(t,1.0),4), "poisson_def": round(ens.pm.dfn.get(t,1.0),4),
                "elo": round(ens.em.elo.get(t,1500.0),1),
                "sot_att": round(ens.xm.att.get(t,1.0),4), "sot_def": round(ens.xm.dfn.get(t,1.0),4),
                "n": sum(1 for m in ms if t in (m["home"],m["away"])),
                "last6": {"gf": gf, "ga": ga, "sot_f": gf_sot, "sot_a": ga_sot},
            }
        out["leagues"][lg] = {
            "name": LEAGUES[lg],
            "mu_h": round(ens.pm.mu_h,4), "mu_a": round(ens.pm.mu_a,4), "rho": round(ens.pm.rho,4),
            "conv": round(ens.xm.conv,4), "base_sot": round(ens.xm.base_sot,3),
            "avg_total": round(ens.em.avg_total,4),
            "elo_reg_a": round(ens.em.reg_a,4), "elo_reg_b": round(ens.em.reg_b,5),
            "elo_ha": ens.em.ha, "elo_start": ens.em.start,
            "teams": teams,
        }
        print(f"{LEAGUES[lg]}: rho={ens.pm.rho} conv={ens.xm.conv:.3f} elo_b={ens.em.reg_b:.4f} 球队={len(teams)}")
    with open(os.path.join(DATA, "ratings_v2.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False)
    bt = {k: (round(v/n,4) if k in ("ll","brier") else v) for k,v in tot.items() if k not in ("model_ll",)}
    bt["model_ll"] = {k: round(v/n,4) for k,v in tot["model_ll"].items()}
    with open(os.path.join(DATA, "backtest.json"), "w", encoding="utf-8") as f:
        json.dump(bt, f, ensure_ascii=False, indent=1)
    print(f"\n已导出 data/ratings_v2.json")

if __name__ == "__main__":
    main()
