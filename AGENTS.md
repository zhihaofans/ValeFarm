# AGENTS.md · 微光农庄 Vale Farm

> 本文件面向 AI 编码代理：**开工前先读它**。人类交接文档见 [DEV_HANDOVER.md](dev-docs/DEV_HANDOVER.md)；这里只放硬约束、最短路径和验证方式，不复制整本手册。
>
> **仓库内一律使用相对路径。个人隐私不得写入或提交**：本机绝对路径、私人账号、密码/令牌、手机号、私人邮箱、设备标识等。公开项目信息（GitHub 仓库、GitHub Pages、项目用户名）可以保留。

## 0. 开始前

- 先读 [DEV_HANDOVER.md](dev-docs/DEV_HANDOVER.md)（架构、约定、踩坑、发版），再读 [GAME_DESIGN.md](dev-docs/GAME_DESIGN.md)（数值）和 [README.md](README.md)（总览）。
- 改代码前先看对应模块和测试；**以源码与测试为准**，不凭记忆。文档与代码冲突时在回复里指出，不要静默二选一。
- 先 `git status`。工作区可能已有用户暂存/未提交的改动，不要 reset、unstage 或覆盖。
- **Git 提交/推送由用户自己做**：agent 不执行 `git commit` / `git push`，也不擅自 `git add`；只改文件、跑验证并在回复里报告改动。不要启动长期服务、不安装全局依赖；需要时先征得用户同意。
- 跑不了测试/构建就如实说明，**不要声称“已通过”**。

### 0.1 协作铁律

1. **改动前先给方案**：新增功能 / 调数值 / 改 UI / 重构，先说清「改哪里、怎么改、影响面（存档兼容 / 测试 / 旧版本）」，等确认再动手。纯 bug 修复可直接做，但要在回复里说明判断依据。
2. **一次只推进一个可验证的小步**：改代码 → 验证 → 汇报 → 问下一步。不要一次改 5 个模块再一起验证（出问题无法定位，旧存档可能已经写脏）。
3. **验证必须显式给结果**：跑测试/类型检查要贴出退出码与结果行（如 `tsc: OK (exit=0, 错误 0)` / `RESULT: GREEN`），不要用"没有输出=通过"。
4. **版本号纪律**：`改代码（不动版本号） → 全量测试绿 → 一次性 stamp → build → e2e → 打 tag`。任何一步失败就停下说明，不要跳过。
5. **文档与代码冲突时以代码为准**，并在同一次改动里修正文档。

## 1. 项目速览

- Phaser 3 + TypeScript + Vite，纯前端、无后端、无账号；存档在 IndexedDB，失败降级 localStorage。
- 入口 [main.ts](src/main.ts)；纯逻辑 [core/](src/core/)；场景 [scenes/](src/scenes/)；UI 小件 [ui/](src/ui/)；屏幕适配 [layout.ts](src/layout.ts)；PWA / 横屏 [pwa.ts](src/pwa.ts)、[orientation.ts](src/orientation.ts)。
- [docs/](docs/) 是构建产物，**不入库**（`.gitignore` 已忽略），只用于本地 `preview` / `test:e2e` / `package`；线上由 GitHub Actions 构建后直接部署。 [dev-docs/](dev-docs/) 是人写文档；[public/](public/) 是静态资源。
- 版本唯一数据源是 [public/version.json](public/version.json)；不要把 `package.json` 的版本号当展示版本。
- 更新记录见 [CHANGELOG.md](CHANGELOG.md)；屏幕适配 / 安全区 / PWA / 触控细节见 [TECH_NOTES.md](dev-docs/TECH_NOTES.md)。

## 1.2 代码地图（改功能先定位到文件，再读那段代码）

### 模块速查

| 域 | 文件 | 关键导出 / 说明 |
|---|---|---|
| 入口 | `src/main.ts` | Phaser 配置、`new Phaser.Game()` 前 `waitPixelFont()`、`--app-h` 视口高度同步 |
| 屏幕适配 | `src/layout.ts` | `computeLayout()` / `gameZoom()` / `uiInsets()` / `currentSafeInsets()` / `isStandaloneApp()` / `watchViewport()` |
| 横竖屏与全屏 | `src/orientation.ts` | `initOrientation()`、`requestLandscape()`、`shouldShowTip()` |
| PWA | `src/pwa.ts`、`public/sw.js` | SW 注册、更新提示、离线提示；`sw.js` 的 `ASSETS` 由构建注入 |
| 启动加载 | `src/scenes/BootScene.ts` | 图集预载、读档、`scene.start('game')` |
| 地图/玩家/交互 | `src/scenes/GameScene.ts` | 地图绘制、`isBlockedTile()`、`doAction()`、移动/相机/自动存档 |
| HUD 与摇杆 | `src/scenes/UIScene.ts` | HUD、摇杆、动作键、提示条、相机安全区；**面板已拆到 `ui/panels/`** |
| 面板骨架 | `src/ui/widgets.ts` | `makePanel()` / `textButton()` / `label()` / `uiScale()`，**一律收 CSS 像素** |
| 摇杆 | `src/ui/joystick.ts` | 虚拟摇杆 |
| 字体 | `src/ui/font.ts` | `UI_FONT` / `UI_FONT_MONO` / `FONT_SCALE` / `fs()` / `waitPixelFont()` |
| 复制兜底 | `src/ui/copySheet.ts` | 剪贴板被系统拦下时的 DOM 手动复制面板 |

### core 纯逻辑（不 import Phaser，全部可单测）

| 域 | 文件 | 关键导出 |
|---|---|---|
| 世界与坐标 | `core/world.ts` | `createWorld()`、`plotAt()`、`farmCoord()`、`clockText()`、`seasonOf()` |
| 常量 | `core/config.ts` | 地图尺寸、时间流速、体力、`SAVE_FMT`、`PICKAXE/ORE/TREE` 常量 |
| 内容数据 | `core/data.ts` | 见下方「数据表速查」 |
| 玩家动作 | `core/actions.ts` | `doHoe` / `doWater` / `doPlant` / `doHarvest` / `doClear` / `spendEnergy` |
| 日循环 | `core/daycycle.ts` | `endDay()`（含集市日提示）、`advanceCrops()`、`applyRain()` |
| 林区 | `core/forest.ts` | `treeAt()`、`chopTree()` |
| 矿脉 | `core/mine.ts` | `oreAt()`、`canMine()`（三道门槛）、`mineOre()`、`refreshOres()` |
| 装饰 | `core/decor.ts` | `decorAt()`、`canPlaceDecor()`、`placeDecor()`、`removeDecor()`、`decorBlocks()`、`buyDecor()` |
| 经济 | `core/economy.ts` | `buySeed` / `sellCrop` / `sellOre` / `sellMat` / `craft` / `processItem` / `buyToolUpgrade` / `countItem` / `addItem` / `removeItem` / 各类 `*Entries()` |
| 集市日 | `core/market.ts` | `isMarketDay()`、`sellMultiplier()`、`marketTip()` |
| 农场评价 | `core/rating.ts` | `rating()` / `ratingDetail()` / `ratingSummary()`、权重与封顶常量 |
| 研究 | `core/research.ts` | `canResearch()` / `researchItem()` / `redeemKnowledge()` / `researchableEntries()` |
| 工具耐久 | `core/tools.ts` | `toolDur()` / `toolUsable()` / `damageTool()` / `restoreTool()` / `toolRatio()` |
| NPC | `core/npc.ts` | `npcDef()` / `talk()` / `giveGift()` / `tierOf()` / `tierName()` / `checkRewards()` |
| 存档 | `core/save.ts` | `normalizeWorld()`（逐字段登记）、`migrateFrom()`、`serialize/deserialize`、`exportSave/importSave` |
| 存储 | `core/storage.ts` | `loadSaveJson()` / `writeSaveJson()`（IndexedDB → localStorage 降级）、`loadSettings()` / `saveSettings()` |
| 音效 | `core/audio.ts` | `SFX.*`、`unlockAudio()`、`setSfxEnabled()` |
| 诊断 | `src/dev/envDiag.ts` | `collectEnvDiag()`、`copyText()`（三条复制路线） |

### 面板文件（`src/ui/panels/`）

| 文件 | 内容 |
|---|---|
| `envDiagPanel.ts` | 环境诊断（数值列表 + 复制按钮） |
| `inventoryPanel.ts` | 物品栏（种子/材料/作物/工具两列） |
| `quickbarPanel.ts` | 快捷栏三页签（种子/道具/装饰） |
| `shopPanel.ts` | 杂货铺四页签（买种子/出售/工具/装饰） |
| `craftingPanel.ts` | 制作台四页签（配方/加工/研究/兑换） |
| `dayPanels.ts` | 晨报、睡觉确认 |
| `dialogPanels.ts` | NPC 对话、送礼选择器 |
| `systemPanel.ts` | 系统菜单（导出/导入、音效、入口、统计行） |

### 数据表速查（**改数值先找这里**，别去场景里硬写）

| 表 | 位置 | 内容 |
|---|---|---|
| `CROPS` | `core/data.ts` | 作物（季节/天数/种子价/卖价/图标帧） |
| `QUALITY` / `DAILY_SEED_DISCOUNT` | 同上 | 品质倍率、每日特价 |
| `NPCS` | 同上 | NPC 站位、最爱礼物、里程碑、三档台词 |
| `TREE_SPOTS` / `ORE_SPOTS` | 同上 | 固定树点 / 固定矿脉点 |
| `DECORS` | 同上 | 装饰（名称/价格/是否挡路/帧名） |
| `RECIPES` / `TOOL_UPGRADES` | 同上 | 制作配方、商店工具升级 |
| `PROCESSES` / `PROCESS_SELL` | 同上 | 加工链（木板 / 金属锭）、加工品收购价 |
| `TOOLS` | 同上 | 带耐久的工具（`maxDur`），加新工具只加一行 |
| `ORE_SELL` | 同上 | 矿石收购价 |
| `RESEARCH_POINTS` / `RESEARCH_CROP_POINTS` | 同上 | 研究一件物品给多少知识点 |
| `KNOWLEDGE_SHOP` | 同上 | 知识点能换什么（工具升级 / 体力上限） |

> 生成物帧索引（`core/generated/tiles.frames.ts`、`ui.frames.ts`）**不是手写数据**，
> 要改请改 `tools/gen_assets.py` 后重跑 `npm run assets`。

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

> 判断标准：**新字段能在旧档上补齐、能在新档上往返、脏值被夹住** —— 三条都要有用例，
> 参考 `tests/unit/migrate.test.ts`（按 v1~v8 每一代旧档形态各写一条）。

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
| 改集市/评价数值 | [market.ts](src/core/market.ts)（周期与加成）、[rating.ts](src/core/rating.ts)（权重与档位） |
| 加装饰 / 改价格 | [data.ts](src/core/data.ts) 的 `DECORS` + [gen_assets.py](tools/gen_assets.py) 的 `ornament_*_tile()` + [decor.ts](src/core/decor.ts) |
| 加加工配方 / 调加工价 | [data.ts](src/core/data.ts) 的 `PROCESSES`（配方）+ `PROCESS_SELL`（价）+ `RESEARCH_POINTS`（研究点）；**新物品 id 必须同步 [save.ts](src/core/save.ts) 的 `normalizeInventory` 白名单并 +`SAVE_FMT`** |
| 加带耐久的工具 | [data.ts](src/core/data.ts) 的 `TOOLS`（写 `maxDur`）+ [tools.ts](src/core/tools.ts)，无需改存档结构 |
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

## 9. 禁区、冒烟与文档维护

### 9.1 绝对不要做

- 删 `migrateFrom` 里的旧 `fmt` 段，或改 `SAVE_FMT` 的语义（老存档会读不出来）。
- 在渲染函数之间互相调用 —— 统一走 `syncHud()` / 面板的单一 `render()` 入口。
- 把版本号写死进 `sw.js` / `manifest.json` / 多处源码（只认 `public/version.json` + `stamp`）。
- 给页面引任何 CDN / 外链字体 / 外链图标库（断网立刻失效）。
- 在 `normalizeWorld` 之前访问 `world.xxx`（还没构建完）。
- 为了"让测试变绿"改断言或放宽预期；先判断是产品错还是用例错。
- 提交用户导出的存档、抓包、日志、含个人信息的截图。

### 9.2 发布后线上冒烟（不是看 HTTP 200）

- [ ] `version.json` 是新版本与新构建号（含源码提交短 sha）
- [ ] 线上 `index.html` 引用的 chunk 都能 200（Phaser 分片后是 2 个 js）
- [ ] `sw.js` 的 `ASSETS` 含最新产物（含 `fonts/`）且 `BUILD` 与新构建号一致
- [ ] PWA：断网 reload 后界面在、存档在、更新提示不误弹
- [ ] 0 条 `pageerror`

可用 `node tools/live-check.mjs <URL>` 跑多视口冒烟（URL 由使用者传入，不写进仓库）。

### 9.3 本文件的维护约定

- 新增/修改数据表 → 更新 §4 的「改这里」映射。
- 新增系统（如研究点、集市日、工具耐久）→ 更新 [GAME_DESIGN.md](dev-docs/GAME_DESIGN.md) 对应小节 + [CHANGELOG.md](CHANGELOG.md)。
- 踩到新的"静默失败"类坑 → 补进 [DEV_HANDOVER.md](dev-docs/DEV_HANDOVER.md) §5 踩坑清单与本文件 §9.1。
- 改发布流程 → 同步 [GITHUB_PAGES.md](dev-docs/GITHUB_PAGES.md)；通用做法/模板改动同步 [CI_DEPLOY_GUIDE.md](dev-docs/CI_DEPLOY_GUIDE.md)。
- 本文件与代码冲突时**以代码为准，并立即修正本文件**。
- 文件名约定：本仓库是 `AGENTS.md`；若工作区里只有 `AGENT.md`（单数）也等价 —— **工作区里存在哪个就优先遵循哪个**。
