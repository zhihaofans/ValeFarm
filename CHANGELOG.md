# 更新记录

> 版本号以 [public/version.json](public/version.json) 为唯一数据源；本文件只做人类可读的记录。
> 技术变更与踩坑见 [DEV_HANDOVER.md](dev-docs/DEV_HANDOVER.md)，数值见 [GAME_DESIGN.md](dev-docs/GAME_DESIGN.md)。

## Unreleased

- 新增 [AGENTS.md](AGENTS.md)：给 AI 编码代理的工作区硬约束。
- README 重构为项目介绍；长篇实现细节移到 [TECH_NOTES.md](dev-docs/TECH_NOTES.md)。
- 版本历史从 README 抽出为本文件。
- 移除 README 中的旧部署地址，改用 GitHub Pages 项目页；`tools/live-check.mjs` 改为必须显式传入 URL。
- **iPhone 15 Pro 横竖屏适配**：HUD / ☰ / 摇杆 / 互动键改用左右安全区；相机改为整块画布，消除横屏左右/底部黑边；iOS PWA 横屏兜底 `0/59/21/59`。
- **修复面板遮罩错位**：遮罩始终保持屏幕中心并铺满全屏；补「左上角点外关闭」回归测试。
- 修复一批已知问题：体力条视觉不缩短；音效开关重载后失效；切后台/pagehide 不存档；雨天或浇湿地播种不继承水分；跨季枯萎晚一天；2:00 强制睡觉没有昏倒惩罚；转屏后安全区看门狗失效；摇杆/按钮监听器累积；雨滴只在启动时下雨才创建；存储降级读不到 localStorage；存档失败无提示；season 脏值；送礼面板嵌套状态；`showTip` 抬手误关。
- 清理死代码：移除未使用的 `rowTargets`、`save()` 空操作、重复三元表达式。
- 补充 GitHub Pages 的 `base: './'` 说明；部署文档分支修正为 `master`。

## 0.4.2 — build 19

- 构建产物改到 `docs/`：源码与可部署文件同仓，GitHub Pages 直接把 `/docs` 设为发布源。
- 新增 `tools/build.mjs`（清空重建 + 注入 SW 清单）、`tools/package.mjs`、`public/.nojekyll`。
- 增加 `dev-docs/` 与产物目录的分工：`docs/` 是纯产物，`dev-docs/` 放人写文档。
- 补充仓库 `.gitignore`（系统垃圾、依赖、测试缓存、日志等）。

## 0.4.2 — builds 11–18

- **顶部 HUD 可读性**：HUD 高度改为按内容实算并留 `padY=9` 内边距，修「能点但看不清」。
- **铺满 + 底部黑带**：`100dvh` + `--app-h` + 画布尺寸同源；`#game` 加兜底色。
- **☰ 居中对话框**：重复点 ☰ 时提示不再贴右上角。
- **iOS 独立模式**：新增 `env()` 失效兜底（`IOS_PWA_FALLBACK = { top: 59, bottom: 34 }`）与冷启动高度补测；manifest 改为 `standalone`。
- **build 15**：环境诊断做进游戏内（☰ → 系统 → 环境诊断），PWA 无地址栏也能用。
- **build 16**：按顶部实测判据去掉重复让出；提示框/对话框按「HUD 下可用区」垂直居中。
- **build 17**：更新提示条改为屏幕中部居中，触控目标 ≥44px。
- **build 18**：UI 与相机的安全区口径拆开（`uiInsets` vs `contentInsets`）；`--app-h` 改认 `innerHeight`；消除「状态栏看不到 + 底部黑条空白」。

## 0.4.1 — build 10

- **修 dpr 单位混用**：面板与按钮在 dpr>1 的机器上缩水到 1/dpr、✕ 点不中。
- `tools/stamp.js` 修 `--set` 被 `--build` 抢占、`--note` 漏写两处。

## 0.4.0 — builds 5–9

- **全屏自适应 + 竖屏可玩**：`Scale.NONE` 铺满 + 相机 zoom 反补，地块永不变形。
- 摇杆固定左下、互动键右下、种子槽居中，尺寸按屏幕短边计算。
- 竖屏改为不挡触摸的建议卡片。

## 0.3.0 — build 4

- iPhone 降级体验：按能力探测换按钮，增加 PWA 安装引导与「先竖着玩」出口。

## 0.2.0 — build 3

- 横屏分层策略：手势内请求全屏 + 锁横屏，竖屏遮罩兜底；晨报按钮改为「横屏开始」。

## 0.1.1 — build 2

- 触控三处根因修复：按钮命中区偏移、图标压层级、`pointer.id` 复用。

## 0.1.0 — build 1

- 首个可玩版本：种植循环、日循环、商店、NPC、存档、PWA。
