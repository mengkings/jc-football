#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
抓取体彩官网当日竞彩足球赛程与固定赔率, 生成 matches.json 供 App 导入。
用法:
  python3 tools/fetch_sporttery.py            # 抓取后写入 data/matches.json
  python3 tools/fetch_sporttery.py --print    # 直接打印 JSON
说明:
  体彩接口 (webapi.sporttery.cn) 对数据中心 IP 有风控, 在家庭/办公网络下通常可正常访问。
  抓不到时, 也可在电脑浏览器打开 https://info.sporttery.cn 竞彩足球页面,
  F12 -> Network 搜索 getMatchList, 复制 JSON 响应, 直接粘贴进 App 的「导入体彩数据」。
"""
import json
import sys
import urllib.request

URL = ("https://webapi.sporttery.cn/gateway/jc/football/getMatchListV1.qry"
       "?poolCode=hhad,had&channel=c")

def fetch():
    req = urllib.request.Request(URL, headers={
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                      "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        "Referer": "https://www.sporttery.cn/",
        "Accept": "application/json",
    })
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read().decode("utf-8"))

def normalize(raw):
    """把体彩原始 JSON 展平为 App 可导入的 matches 数组"""
    matches = []

    def walk(obj):
        if not isinstance(obj, dict):
            if isinstance(obj, list):
                for x in obj:
                    walk(x)
            return
        home = obj.get("homeTeamAbbName")
        away = obj.get("awayTeamAbbName")
        had, hhad = obj.get("had"), obj.get("hhad")
        if home and away and (had or hhad):
            matches.append({
                "num": obj.get("matchNumStr", ""),
                "league": obj.get("leagueAbbName", ""),
                "home": home, "away": away,
                "date": (obj.get("matchDate") or "")[:10],
                "time": (obj.get("matchTime") or "")[:5],
                "had": [float(had["h"]), float(had["d"]), float(had["a"])] if had and had.get("h") else None,
                "hhad": [float(hhad["h"]), float(hhad["d"]), float(hhad["a"])] if hhad and hhad.get("h") else None,
                "goalLine": float(hhad["goalLine"]) if hhad and hhad.get("goalLine") is not None else None,
            })
            return
        for v in obj.values():
            walk(v)

    walk(raw)
    return matches

def main():
    try:
        raw = fetch()
    except Exception as e:
        print(f"抓取失败 ({e})。请改用浏览器复制 JSON 的方式, 详见 App 内「说明」页。", file=sys.stderr)
        sys.exit(1)
    matches = normalize(raw)
    out = {"matches": matches, "count": len(matches)}
    if "--print" in sys.argv:
        print(json.dumps(out, ensure_ascii=False, indent=1))
    else:
        import os
        path = os.path.join(os.path.dirname(__file__), "..", "data", "matches.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(out, f, ensure_ascii=False, indent=1)
        print(f"已写入 {path} ({len(matches)} 场)。打开 App -> 今日 -> 导入体彩数据 -> 粘贴该文件内容。")

if __name__ == "__main__":
    main()
