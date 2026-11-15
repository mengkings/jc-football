# 竞彩智算 ⚽ 竞彩足球赛前概率推演工具

基于**时间加权泊松模型 (Dixon-Coles 低比分修正) × 市场赔率去水概率**的竞彩足球赛前分析 PWA，可免费安装在 **安卓** 和 **苹果** 手机上。

## 功能

| 模块 | 说明 |
| --- | --- |
| 今日比赛 | 添加/导入比赛，输出完整推演：胜平负方向、让球胜平负、总进球区间与 8 选项、比分概率矩阵 Top10 + 热力图、半全场、双方进球 |
| 风险分歧 | 模型概率 vs 竞彩赔率隐含概率的偏差量化（低/中/高三级） |
| 价值分析 | 每个选项的 EV（概率 × 赔率 − 1），正 EV 高亮 |
| 串关方案 | 自动生成 2串1 / 3串1 / 4串1 / 5串1「稳健」「价值」双方案，含命中概率、总赔率、EV、凯利注金 |
| 球队库 | 五大联赛 110 支球队攻防评分（2024-25 / 2025-26 赛季 3500+ 场训练） |
| 校准系统 | 记录预测 → 填写赛果 → 自动统计方向命中率、进球区间命中率、比分 Top3/Top5 命中率、Brier 分数、校准表 |

## 三层推演体系（模型哲学）

1. **胜平负方向** —— 信息量最大，是所有玩法的基础
2. **总进球区间** —— 比分波动大，进球区间更容易被模型捕捉
3. **比分概率分布** —— 比分不是答案，而是一组按概率排序的可能性

模型输出 = `40% 泊松模型 + 60% 市场赔率`（该混合权重经 526 场回测优选，见 [VALIDATION.md](VALIDATION.md)）。

## 安装到手机（免费）

### 方式 A：PWA 直接安装（推荐，安卓 + 苹果）
1. 将本仓库开启 GitHub Pages（Settings → Pages → main 分支 /docs 或 root）
2. 手机浏览器打开页面
3. **安卓**：Chrome → 菜单 →「添加到主屏幕」
4. **苹果**：Safari → 分享 →「添加到主屏幕」

安装后以独立应用运行，支持离线（Service Worker 缓存全部资源）。

### 方式 B：Capacitor 打包原生 App
```bash
npm i -D @capacitor/cli @capacitor/core @capacitor/android
npx cap init 竞彩智算 com.example.jczhixuan --web-dir=../app
npx cap add android
npx cap open android   # Android Studio 中 Build APK (免费)
```
iOS 打包需要 Mac + Xcode（免费开发者账号即可真机调试）。

## 每日使用流程

1. 获取当日竞彩数据（二选一）：
   - 电脑浏览器打开体彩官网竞彩页面 → F12 → Network 搜索 `getMatchList` → 复制 JSON → App 内「导入体彩数据」粘贴
   - 或运行 `python3 tools/fetch_sporttery.py`，把生成的 `data/matches.json` 内容粘贴进 App
2. 查看每场比赛的三层推演与风险分歧
3. 到「串关」页查看自动生成的 2串1~5串1 方案
4. 赛后在「校准」页填写赛果，长期跟踪模型命中质量

## 数据与模型更新

```bash
# 重新下载最新五大联赛数据 (免费, football-data.co.uk)
for s in 2526 2627; do for l in E0 SP1 I1 D1 F1; do
  curl -o "data/${l}_${s}.csv" "https://www.football-data.co.uk/mmz4281/${s}/${l}.csv"
done; done

# 重新训练评分 + 回测 + 生成 app/js/ratings-data.js
python3 tools/model.py
```

内置评分由 GitHub Actions 每月自动刷新（见 `.github/workflows/update-ratings.yml`）。

## 回测结论（诚实声明）

2024-25 赛季五大联赛 526 场滚动回测：

- 方向命中率：模型 51.1%，40/60 混合 **54.6%**，高置信策略 **60.1%**
- 总进球区间命中率 44.1%，比分 Top3 命中率 33.5%
- 以市场赔率结算的 ROI 长期为负（约 -1% 至 -3%）

**足球赔率市场高度有效，任何模型都无法保证盈利。** 本工具的价值在于把「感觉」变成「概率」，帮助控制注金、理解风险。请理性购彩，量力而行，未满 18 周岁禁止购彩。

## 目录结构

```
app/                  # PWA 应用 (纯前端, 无构建依赖)
  index.html
  css/style.css
  js/model.js         # 泊松 + Dixon-Coles 引擎 (与 Python 同源)
  js/app.js           # 界面逻辑
  js/ratings-data.js  # 球队评分 (自动生成)
  manifest.webmanifest / sw.js / icons
tools/
  model.py            # 训练 / 回测 / 导出评分
  fetch_sporttery.py  # 抓取当日竞彩赛程赔率
data/                 # 历史比赛 CSV (football-data.co.uk)
VALIDATION.md         # 回测报告
```

## 参考

- Dixon & Coles (1997) *Modelling Association Football Scores and Inefficiencies in the Football Betting Market*
- 数据: [football-data.co.uk](https://www.football-data.co.uk/)（免费）
- 灵感参考: GitHub 上的 open-goal 预测项目与 Dixon-Coles 蒙特卡洛方案

## License

MIT
