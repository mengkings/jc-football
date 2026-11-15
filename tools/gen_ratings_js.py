#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""由 app/ratings.json 生成带中文队名的 app/js/ratings-data.js"""
import json, os

BASE = os.path.join(os.path.dirname(__file__), "..")

CN = {
 "Arsenal":"阿森纳","Aston Villa":"阿斯顿维拉","Bournemouth":"伯恩茅斯","Brentford":"布伦特福德",
 "Brighton":"布莱顿","Burnley":"伯恩利","Chelsea":"切尔西","Crystal Palace":"水晶宫",
 "Everton":"埃弗顿","Fulham":"富勒姆","Ipswich":"伊普斯维奇","Leeds":"利兹联",
 "Leicester":"莱斯特城","Liverpool":"利物浦","Man City":"曼城","Man United":"曼联",
 "Newcastle":"纽卡斯尔","Nott'm Forest":"诺丁汉森林","Southampton":"南安普顿","Sunderland":"桑德兰",
 "Tottenham":"热刺","West Ham":"西汉姆联","Wolves":"狼队",
 "Alaves":"阿拉维斯","Ath Bilbao":"毕尔巴鄂竞技","Ath Madrid":"马德里竞技","Barcelona":"巴塞罗那",
 "Betis":"皇家贝蒂斯","Celta":"塞尔塔","Elche":"埃尔切","Espanol":"西班牙人",
 "Getafe":"赫塔菲","Girona":"赫罗纳","Las Palmas":"拉斯帕尔马斯","Leganes":"莱加内斯",
 "Levante":"莱万特","Mallorca":"马略卡","Osasuna":"奥萨苏纳","Oviedo":"奥维耶多",
 "Real Madrid":"皇家马德里","Sevilla":"塞维利亚","Sociedad":"皇家社会","Valencia":"瓦伦西亚",
 "Valladolid":"巴利亚多利德","Vallecano":"巴列卡诺","Villarreal":"比利亚雷亚尔",
 "Atalanta":"亚特兰大","Bologna":"博洛尼亚","Cagliari":"卡利亚里","Como":"科莫",
 "Cremonese":"克雷莫纳","Empoli":"恩波利","Fiorentina":"佛罗伦萨","Genoa":"热那亚",
 "Inter":"国际米兰","Juventus":"尤文图斯","Lazio":"拉齐奥","Lecce":"莱切",
 "Milan":"AC米兰","Monza":"蒙扎","Napoli":"那不勒斯","Parma":"帕尔马",
 "Pisa":"比萨","Roma":"罗马","Sassuolo":"萨索洛","Torino":"都灵",
 "Udinese":"乌迪内斯","Venezia":"威尼斯","Verona":"维罗纳",
 "Augsburg":"奥格斯堡","Bayern Munich":"拜仁慕尼黑","Bochum":"波鸿","Dortmund":"多特蒙德",
 "Ein Frankfurt":"法兰克福","FC Koln":"科隆","Freiburg":"弗赖堡","Hamburg":"汉堡",
 "Heidenheim":"海登海姆","Hoffenheim":"霍芬海姆","Holstein Kiel":"基尔","Leverkusen":"勒沃库森",
 "M'gladbach":"门兴","Mainz":"美因茨","RB Leipzig":"莱比锡红牛","St Pauli":"圣保利",
 "Stuttgart":"斯图加特","Union Berlin":"柏林联合","Werder Bremen":"不来梅","Wolfsburg":"沃尔夫斯堡",
 "Angers":"昂热","Auxerre":"欧塞尔","Brest":"布雷斯特","Le Havre":"勒阿弗尔",
 "Lens":"朗斯","Lille":"里尔","Lorient":"洛里昂","Lyon":"里昂",
 "Marseille":"马赛","Metz":"梅斯","Monaco":"摩纳哥","Montpellier":"蒙彼利埃",
 "Nantes":"南特","Nice":"尼斯","Paris FC":"巴黎FC","Paris SG":"巴黎圣日耳曼",
 "Reims":"兰斯","Rennes":"雷恩","St Etienne":"圣埃蒂安","Strasbourg":"斯特拉斯堡",
 "Toulouse":"图卢兹",
}

def main():
    with open(os.path.join(BASE, "app", "ratings.json"), encoding="utf-8") as f:
        r = json.load(f)
    missing = [t for lg in r["leagues"].values() for t in lg["teams"] if t not in CN]
    if missing:
        print("警告: 缺少中文队名:", missing)
    r["cn"] = CN
    out = os.path.join(BASE, "app", "js", "ratings-data.js")
    with open(out, "w", encoding="utf-8") as f:
        f.write("// 自动生成: tools/model.py + tools/gen_ratings_js.py —— 数据源 football-data.co.uk\n")
        f.write("const RATINGS = " + json.dumps(r, ensure_ascii=False, separators=(",", ":")) + ";\n")
    print(f"已生成 {out}")

if __name__ == "__main__":
    main()
