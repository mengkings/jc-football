#!/usr/bin/env python3
# 从 data/ratings_v2.json 生成 app/js/data.js (供 CI 每月刷新使用)
# 用法: python3 tools/gen_data_js.py
import json, re
from pathlib import Path

ROOT = Path(__file__).parent.parent
app_js = ROOT / "app" / "js" / "data.js"

# 1) 读取训练输出
ratings = json.loads((ROOT / "data" / "ratings_v2.json").read_text())

# 2) 从现有 data.js 保留中英映射 (cn) 与别名 (alias)
old = app_js.read_text()
m = re.search(r"const DATA = (\{.*\});\s*$", old, re.S)
old_data = json.loads(m.group(1)) if m else {}
cn = old_data.get("cn", {})
alias = old_data.get("alias", {})

# 3) 组装新 DATA (结构: meta + leagues + cn + alias, 与 app.js 读取一致)
data = {
    "meta": ratings["meta"],
    "leagues": ratings["leagues"],
    "cn": cn,
    "alias": alias,
}
app_js.write_text(
    "// 自动生成: tools/model.py + tools/gen_data_js.py —— 泊松/Elo/xG 三模型评分 (数据源 football-data.co.uk)\n"
    "const DATA = " + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n"
)
n_teams = sum(len(lg["teams"]) for lg in ratings["leagues"].values())
print(f"✓ app/js/data.js 已生成: {len(ratings['leagues'])} 联赛 / {n_teams} 队 / cn {len(cn)} / alias {len(alias)}")
