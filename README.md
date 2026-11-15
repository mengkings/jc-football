# Footballs AI ⚽ 多模型竞彩足球研究工具

泊松 × Elo × xG **三模型集成** + **DeepSeek AI 研究 + 反方辩论**的竞彩足球赛前概率推演工具。
纯前端 PWA，可安装到**安卓**与**苹果**手机（也可下载 APK 原生包）。

## 功能

| 模块 | 说明 |
| --- | --- |
| 体彩竞彩直连 | 打开即自动拉取体彩官方在售场次 (胜平负/让球/总进球/半全场赔率)，国内网络免Key直连，顶部 🔄 一键刷新 |
| 三模型引擎 | ①泊松(时间加权攻防) ②Elo(在线评分) ③xG代理(射正数据) → 集成 → 市场赔率 40/60 混合 |
| 方向研究 | 胜平负、让球胜平负、总进球(8选项+区间)、比分矩阵Top10+热力图、半全场、双方进球 |
| AI 研究 | DeepSeek 主AI分析 + **反对者AI辩论**（唱反调找漏洞） |
| 每日TOP5 | 研究分 = 置信度 × 数据质量 × 风险控制 × 模型一致性，自动排名 |
| 数据质量标注 | 每场标注数据质量(高/中/低)与风险等级(低/中/高) |
| 每日组合 | 自动生成 2串1~5串1「稳健/价值」方案（联合概率、总赔率、EV、凯利注金） |
| 历史研究 | 记录预测 → 赛后填分 → 方向/区间/比分Top3 命中率 + Brier + 校准表 |
| 体彩数据导入 | 粘贴体彩官网 JSON，中文队名自动匹配，非收录球队赔率反解 |

## 安装

### 网页版（全平台）
- GitHub Pages: **https://mengkings.github.io/jc-football/**
- 安卓 Chrome → 菜单 →「添加到主屏幕」；苹果 Safari → 分享 →「添加到主屏幕」
- 支持**离线**（Service Worker）

### 安卓 APK（原生包）
GitHub **Releases** 页直接下载 `footballai-debug.apk`：手机「设置→安全→允许安装未知来源」后打开安装。
（仓库每次更新 app/ 会自动构建新 APK，见 Actions）

### iOS
Safari 添加到主屏幕即可，功能与原生一致。打包 IPA 需 Mac + Xcode（Capacitor 工程见下方说明）。

## 每日使用流程

1. 打开 App 即自动拉取体彩当日竞彩 (国内网络直连体彩官方接口, 无需任何 Key)
2. 首页切「今日 / 明日 / 全部」看 TOP5 重点研究 + 2串1~5串1 推荐组合 (仅基于所选日期的比赛)
3. 想更新赔率点顶部 🔄 一键刷新; 海外联赛可在设置里填 the-odds-api 免费 Key
4. 每场比赛可点「🤖 AI研究 + 反方辩论」(需 DeepSeek 免费 Key, 只存本机)
5. 赛后「历史记录」填赛果，长期校准

> 注意: 体彩接口有地域限制 (仅国内网络直连), 海外网络会拉取失败 — 此时用「导入体彩数据」粘贴 JSON 或 the-odds-api。

## 回测验证（2024-25赛季五大联赛526场）

| 模型 | 方向命中率 | 对数损失 |
| --- | --- | --- |
| 泊松 | 51.1% | 0.9985 |
| Elo | 51.9% | 1.0118 |
| xG代理 | 49.8% | 1.0176 |
| **三模型集成** | **52.3%** | **0.9924** |
| 集成+市场40/60 | **54.4%** | 0.9697 |
| 高置信策略 | 60.1% | — |

集成模型优于任何单一模型；市场仍是最强基准。**诚实声明：任何模型都难以长期战胜约8%的竞彩抽水，ROI 长期为负。本工具价值在于把感觉变成概率、控制注金。请理性购彩，量力而行，未满18周岁禁止购彩。**

详见 [VALIDATION.md](VALIDATION.md)。

## 更新数据 / 本地构建

```bash
# 刷新球队评分 (泊松+Elo+xG)
python3 tools/model.py

# 抓取当日体彩竞彩赛程
python3 tools/fetch_sporttery.py

# 本地 Capacitor 打包安卓
npm i -D @capacitor/cli @capacitor/core @capacitor/android
npx cap init "Footballs AI" com.footballai.app --web-dir=../app
npx cap add android && npx cap open android
```

## 目录结构

```
app/                  # PWA (纯前端)
  js/engine.js        # 三模型引擎 (与 Python 同源)
  js/ai.js             # DeepSeek 主AI + 反方辩论
  js/oddsapi.js        # the-odds-api 赛程获取 + 球队名映射
  js/app.js            # 界面 (首页/赛事研究/历史/数据中心)
  js/data.js           # 球队评分 (自动生成)
tools/                # 模型训练 / 回测 / 体彩抓取
data/                 # 历史数据 CSV
.github/workflows/    # Pages部署 / APK构建 / 每月评分刷新
```

## License

MIT
