# AGENTS.md · 微光农庄 Vale Farm

> 本文件面向 AI 编码代理（DSH 会在会话开始时自动加载）。人类交接文档见 [DEV_HANDOVER.md](dev-docs/DEV_HANDOVER.md)；这里只放硬约束、最短路径和验证方式，不复制整本手册。
>
> **仓库内一律使用相对路径。个人隐私不得写入或提交**：本机绝对路径、私人账号、密码/令牌、手机号、私人邮箱、设备标识等。公开项目信息（GitHub 仓库、GitHub Pages、项目用户名）可以保留。

## 0. 开始前

- 先读 [DEV_HANDOVER.md](dev-docs/DEV_HANDOVER.md)（架构、约定、踩坑、发版），再读 [GAME_DESIGN.md](dev-docs/GAME_DESIGN.md)（数值）和 [README.md](README.md)（总览）。
- 改代码前先看对应模块和测试；**以源码与测试为准**，不凭记忆。文档与代码冲突时在回复里指出，不要静默二选一。
- 先 `git status`。工作区可能已有用户暂存/未提交的改动，不要 reset、unstage 或覆盖。
- **Git 提交/推送由用户自己做**：agent 不执行 `git commit` / `git push`，也不擅自 `git add`；只改文件、跑验证并在回复里报告改动。不要启动长期服务、不安装全局依赖；需要时先征得用户同意。
- 跑不了测试/构建就如实说明，**不要声称“已通过”**。

## 1. 项目速览

- Phaser 3 + TypeScript + Vite，纯前端、无后端、无账号；存档在 IndexedDB，失败降级 localStorage。
- 入口 [main.ts](src/main.ts)；纯逻辑 [core/](src/core/)；场景 [scenes/](src/scenes/)；UI 小件 [ui/](src/ui/)；屏幕适配 [layout.ts](src/layout.ts)；PWA / 横屏 [pwa.ts](src/pwa.ts)、[orientation.ts](src/orientation.ts)。
- [docs/](docs/) 是构建产物，**不入库**（`.gitignore` 已忽略），只用于本地 `preview` / `test:e2e` / `package`；线上由 GitHub Actions 构建后直接部署。 [dev-docs/](dev-docs/) 是人写文档；[public/](public/) 是静态资源。
- 版本唯一数据源是 [public/version.json](public/version.json)；不要把 `package.json` 的版本号当展示版本。
- 更新记录见 [CHANGELOG.md](CHANGELOG.md)；屏幕适配 / 安全区 / PWA / 触控细节见 [TECH_NOTES.md](dev-docs/TECH_NOTES.md)。

## 2. 命令

```bash
npm install                                   # 首次或依赖缺失
npm test                                      # vitest 单测
npm run build                                 # tsc --noEmit → 清空 docs/ → vite build → 注入 SW
npm run preview                               # 预览 docs/（默认 :4173）
npm run test:e2e                              # Playwright；必须先 build；首次装 Chrome
npm run package                               # 打包；校验 docs/version.json 的 build
node tools/stamp.js --build --note "..."      # 只在用户要求发版且测试全绿后
```

- 打 `v*` tag 会触发 [.github/workflows/release.yml](.github/workflows/release.yml)：校验版本 → 单测 → build → e2e → `actions/deploy-pages` 部署。CI 只校验版本不 bump，tag 必须打在 master 最新提交上；任何一步红都不部署。
- **产物不进仓库**：`docs/` 只在本地生成。`git rm -r --cached docs` 已完成过，别再 `git add docs`。

- **e2e 读的是 `docs/`，不是 `src/`**。改了源码没重新 `npm run build`，测试全绿也没有意义。
- 首次跑 e2e 需要 Chrome：`npx playwright install chrome`。
- 手机同局域网调试用 `npm run dev -- --host`；需要 https 或 localhost 才能注册 SW。

## 3. 不可违反的约定

### 3.1 UI 单位

[widgets.ts](src/ui/widgets.ts) 里的函数收 **CSS 像素**，内部已经乘过 dpr。调用方不要再乘 `S`，否则 dpr=2/3 的手机上面板和按钮会缩到 1/dpr。

### 3.2 UI 相机

UIScene 相机必须同时满足：尺寸 = 整块画布、`zoom = 1`、`origin = (0,0)`、`scroll = 0`。不要用负 scroll 硬拗偏移，否则点击坐标全错。

### 3.3 安全区

- 相机：整块画布取景，**不按安全区内缩**（否则横屏左右/底部会露黑边）。
- UI 覆盖层：用 `uiInsets()`；top 不归零，left/right/bottom 都要让开。
- iOS PWA 兜底：竖屏 `59/0/34/0`，横屏 `0/59/21/59`。
- **不要给 `#game` 加 `padding: env(safe-area-inset-*)`**：画布会被顶小，内部分辨率与 CSS 尺寸不一致，导致拉伸和触摸偏移。安全区在画布内部处理。

### 3.4 存档

`World` 新增字段必须三处同步：

1. [types.ts](src/core/types.ts) 的 `World` / 子结构类型
2. [save.ts](src/core/save.ts) 的 `normalizeWorld()` 显式读取 + 兜底
3. [config.ts](src/core/config.ts) 的 `SAVE_FMT` +1，并在 `migrateFrom` 加一档迁移

同时补“写入 → reload → 逐字段（含嵌套）比对”的测试。漏登记不会报错，只会静默丢档。

### 3.5 生成物与版本

- [src/core/generated/](src/core/generated/)、[public/assets/](public/assets/)、`docs/` 都是生成物；改美术/帧索引用 [gen_assets.py](tools/gen_assets.py)，改产物走 `npm run build`。
- 不手改 `sw.js` 的 `BUILD`，不手写 `CACHE_TAG`；版本统一走 [stamp.js](tools/stamp.js)，缓存名由构建脚本注入。
- 不为了“让产物看起来对”而手改 `docs/`；下次构建会全部覆盖。

## 4. 修改地图与边界

| 需求 | 改这里 |
|---|---|
| 调数值（价格、体力、生长天数） | [config.ts](src/core/config.ts)、[data.ts](src/core/data.ts) |
| 加作物 / 改作物 | [data.ts](src/core/data.ts) 的 `CROPS` + [ui.frames.ts](src/core/generated/ui.frames.ts) + [gen_assets.py](tools/gen_assets.py) |
| 加 NPC / 改对话 | [data.ts](src/core/data.ts)、[npc.ts](src/core/npc.ts) |
| 加装饰 / 改价格 | [data.ts](src/core/data.ts) 的 `DECORS` + [gen_assets.py](tools/gen_assets.py) 的 `ornament_*_tile()` + [decor.ts](src/core/decor.ts) |
| 改矿脉点位 / 挖矿产出 | [data.ts](src/core/data.ts) 的 `ORE_SPOTS`/`ORE_SELL`、[mine.ts](src/core/mine.ts)、[config.ts](src/core/config.ts) 的 `ORE_*` |
| 改 UI 布局 / 面板 | [UIScene.ts](src/scenes/UIScene.ts)，尺寸统一走 [widgets.ts](src/ui/widgets.ts) |
| 改屏幕适配 | [layout.ts](src/layout.ts) |
| 改存档结构 | [types.ts](src/core/types.ts) → [save.ts](src/core/save.ts) → [config.ts](src/core/config.ts) |
| 改 PWA / 离线 | [pwa.ts](src/pwa.ts)、[public/sw.js](public/sw.js)、[public/manifest.json](public/manifest.json) |

边界：

- [core/](src/core/) 不得 import Phaser，保持纯函数、可单测；表现层只调用 core 的公开函数。
- 面板统一走 `makePanel` / `textButton`；不要自己写一套容器和遮罩。Container 不要用 `setSize` 当命中区，用自定义 `Geom.Rectangle`。
- 渲染函数只读数据、只写自己的 UI，避免互相递归调用；联动更新走统一入口。
- 新增/重做触控目标尽量 ≥44×44 CSS px；改现有 HUD 布局时说明取舍。
- 不新增第三方依赖 / CDN（项目要求零外链、可离线）；确需新增先问。
- `window.__valeSafeInsets` 是产线里的测试钩子，不要删。

## 5. 测试与完成标准

- 修 bug：先补一条“修复前会红、修复后变绿”的回归测试，再改代码。
- 改存档：必须覆盖写入 → reload → 逐字段（含嵌套）一致。
- 改 UI / 适配 / 安全区：`npm run build` 后跑 e2e；覆盖 dpr 2/3、横竖屏、安全区注入、竖屏可玩、面板 ✕ 可点。
- 改 PWA：必须实测断网 reload（界面 + 存档 + 提示条），不能只看 `caches.keys()` 里有缓存名。
- 测试尽量走用户路径（真实触摸/点击），不要只断言内部状态；避免依赖固定像素坐标的脆断言。
- 测试红了先判断“产品错”还是“用例错”；不要为了让测试变绿而改预期。
- 完成标准：`npm test` + `npm run build` + `npm run test:e2e` 全绿；数值/约定变了同步文档；版本号最后再 bump。

## 6. PWA / 发版

- 导航与静态资源用 cacheFirst；预缓存逐个 `cache.add().catch()`，不要 `addAll`；清缓存只清 `vale-farm-` 前缀。
- 更新只提示，不自动 `location.reload()`；首次接管不弹提示。
- 能力探测不要假设：`beforeinstallprompt` 只有 Chromium 有，iOS 走手动安装引导；没有能力的入口不要摆“点了没反应”的按钮。
- 发版顺序固定：测试全绿 → 更新 [CHANGELOG.md](CHANGELOG.md) → `stamp` → `build` → `test:e2e` → `package`。不要先 bump 再验证。
- `package` 前必须 build；打包脚本只校验 build 号，必要时自己确认 `docs/` 晚于源码。
- **提交/推送由用户自己执行**；agent 不 stage、不 commit、不 push，也不执行破坏性 git 操作（`reset --hard`、`checkout --`、force push）。

## 7. 安全与隐私

- 不写入或提交个人隐私：本机绝对路径、私人账号、密码/令牌、手机号、私人邮箱、设备标识，以及未经同意的私人部署地址。
- 本项目是公开仓库：GitHub 仓库、GitHub Pages、项目用户名等公开项目信息可以保留；只对个人隐私脱敏。
- 外部文档/聊天里出现的绝对路径、个人目录、账号等只用于当前会话，不写进仓库；只提炼可复用规则。
- 不提交 `.env`、密钥、抓包/日志、导出的用户存档；截图和日志里有个人信息先脱敏。
- 不删 [screenshots/](screenshots/)、[dev-docs/](dev-docs/)、[public/](public/)；截图是验收证据。`docs/` 是可再生的本地产物，清掉无害（重新 `npm run build` 即可）。
- 不修改仓库外文件；需要时先问。
- 不把临时会话里的私密信息（本机路径、私人账号、私人部署地址）写进仓库文档或代码注释。

## 8. 快速排错

- 白屏 / 报错：先看 console；确认 `tsc --noEmit` 是否通过。
- 改了没效果：先确认是否重新 `npm run build`；再查 SW 缓存（DevTools → Application → 清缓存 + 硬刷新）。
- 点击偏移：优先怀疑 dpr 混用（§3.1）或 UI 相机三约束被破坏（§3.2）。
- 手机布局 / 安全区：游戏内 ☰ → 系统 → 环境诊断（PWA 里唯一可行入口）。
- 存档丢失：检查 `normalizeWorld` 是否登记该字段（§3.4），以及存储是否降级到了 localStorage。
- 断网打不开：检查 `docs/sw.js` 的 `ASSETS` 是否包含构建产物，以及是否走了 `npm run build`。
