# 微光农庄 · Vale Farm —— 开发交接手册

> 给接手这个项目的人。目标：**读完后能独立改需求、跑测试、发版本，不踩我们已经踩过的坑。**
>
> 相关文档：
> - [`TECH_NOTES.md`](./TECH_NOTES.md) —— 屏幕适配 / 安全区 / PWA / 触控的实现推理
> - [`CHANGELOG.md`](../CHANGELOG.md) —— 版本与 build 历史
> - [`GAME_DESIGN.md`](./GAME_DESIGN.md) —— 游戏设定与数值（改平衡先看这个）
> - [`GITHUB_PAGES.md`](./GITHUB_PAGES.md) —— 部署到 GitHub Pages 的步骤
> - [`../README.md`](../README.md) —— 项目总览与快速开始

---

## 1. 一句话概括

Phaser 3 + TypeScript + Vite 的手机端 2D 像素农场页游，纯前端、无后端、无账号。
存档在浏览器本地（IndexedDB，降级 localStorage），支持随时导出 / 导入 JSON。
已做成 PWA，可加到手机主屏离线玩。

**当前版本**：v0.4.2 build 19 · 源码约 4100 行 TS，测试约 2100 行。

---

## 2. 环境与命令

```bash
npm install          # Node 18+，建议 20
npm run dev          # 开发服务器 :5173
npm run dev -- --host   # 手机同局域网调试（需 https 或 localhost 才能注册 SW）

npm run build        # 类型检查 + 构建 → docs/
npm run preview      # 预览构建产物 :4173
npm test             # 单元测试（vitest，73 条，秒级）
npm run test:e2e     # 端到端（playwright，38 条，约 50 秒）
npm run package      # 打 zip（源码 + docs/）
```

### 各命令的作用与注意点

| 命令 | 做什么 | 坑 |
|---|---|---|
| `npm run build` | `tsc --noEmit` 类型检查 → `tools/build.mjs` 清空 `docs/` → `vite build` → 注入 SW 清单 | **必须走这个**，直接 `vite build` 会漏掉 SW 预缓存注入，断网直接白屏 |
| `npm test` | 纯逻辑单测，不启浏览器 | 改了 `core/` 下的经济、存档、作物逻辑，这条必须绿 |
| `npm run test:e2e` | 真浏览器跑交互 | 首次要 `npx playwright install chrome`；**构建产物变了要先 `npm run build`**，它跑的是 `docs/` 的 preview |
| `npm run package` | 打包分发 | 会校验 `docs/version.json` 与源码构建号一致，防止把旧产物打进去 |

> **e2e 的一个隐形依赖**：`playwright.config.ts` 的 webServer 用 `npm run preview`，
> 读的是 `docs/`。改了源码但没重新 build，e2e 测的还是旧代码 —— 这时测试全绿也说明不了什么。
> 排查"代码明明改了测试却没变"时，先怀疑这个。

---

## 3. 目录结构与"改哪里"

```
src/
├── main.ts            入口：Phaser 配置、--app-h 视口高度同步
├── layout.ts          ★ 屏幕适配核心：画布尺寸、相机 zoom、安全区计算
├── orientation.ts     横屏策略、竖屏建议卡片、全屏请求
├── pwa.ts             SW 注册、更新提示、离线提示（与玩法完全解耦，删掉游戏照样跑）
├── core/              ★ 纯逻辑，不 import Phaser，全部可单测
│   ├── config.ts      全局常量：地图尺寸、时间流速、体力消耗、经济参数
│   ├── data.ts        内容数据：作物表、NPC 表、工具升级表
│   ├── world.ts       世界状态与日/季换算
│   ├── actions.ts     玩家动作：锄地、播种、浇水、收获、清理
│   ├── economy.ts     买卖、算价
│   ├── daycycle.ts    每日结算（作物生长、体力恢复、昏倒惩罚）
│   ├── npc.ts         好感度、送礼、对话
│   ├── save.ts        ★ 存档序列化 / 反序列化 / 字段归一化 / 版本迁移
│   ├── storage.ts     IndexedDB 封装（失败降级 localStorage）
│   ├── audio.ts       WebAudio 合成音效（无音频文件）
│   └── types.ts       World 等类型定义
├── scenes/
│   ├── BootScene.ts   资源加载
│   ├── GameScene.ts   地图渲染、玩家移动、相机（671 行）
│   └── UIScene.ts     ★ HUD、摇杆、按钮、所有面板（941 行，最重）
├── ui/
│   ├── widgets.ts     ★ 文字按钮、面板骨架、居中计算（单位约定在这里）
│   └── joystick.ts    虚拟摇杆
└── dev/
    └── envDiag.ts     游戏内环境诊断（☰ → 系统 → 环境诊断）
```

### 常见需求 → 该改哪个文件

| 需求 | 改这里 |
|---|---|
| 调数值（价格、体力消耗、生长天数） | `core/config.ts`、`core/data.ts` |
| 加一种作物 | `core/data.ts` 的 `CROPS`（含 `uiFrame` 图标名）+ `core/generated/ui.frames.ts` 加图标帧 + `public/assets/crops.png` 加 32×32 精灵图 + `tools/gen_assets.py` |
| 加一个 NPC | `core/data.ts` 的 `NPCS` + `npc.ts` |
| 改 UI 布局 / 加面板 | `scenes/UIScene.ts`，尺寸常量走 `ui/widgets.ts` |
| 改存档结构 | `core/types.ts` → `core/save.ts` 的 `normalizeWorld` 与 `migrateFrom`（**必须加迁移档**） |
| 改屏幕适配置 | `src/layout.ts` |
| 改美术 | `tools/gen_assets.py`（程序化生成）或直接替换 `public/assets/*.png` |

---

## 4. ★ 必须遵守的四条约定

这几条是踩了大坑之后定下来的，**违反任何一条都会出现"看不懂的 bug"**。

### 4.1 单位约定：UI 一律写 CSS 像素

`ui/widgets.ts` 里所有函数**收 CSS 像素，内部乘 `S`（= dpr）换成画布像素**。

```ts
// ✅ 正确
textButton(this, x_css, y_css, 120, 44, '确定', cb)
// ❌ 错误：又乘了一次 dpr，dpr=3 的手机上按钮大 3 倍、位置偏移
textButton(this, x_css * S, y_css * S, 120 * S, 44 * S, '确定', cb)
```

**历史事故**：0.4.0 上线后，dpr=2/3 的手机上面板只有设计值的 1/dpr，✕ 按钮点不中。

### 4.2 UI 相机三约束

`UIScene` 的相机必须满足：**尺寸 = 整块画布、`zoom = 1`、`origin = (0,0)`、`scroll = 0`**。

原因（Phaser 内部机制）：
- 渲染器按 `cam.width/height` 裁剪，尺寸不对只画出左上角一块
- 平移项是 `w * originX * (1 - zoom)`，zoom ≠ 1 会把画面推走
- 输入坐标反算依赖这套矩阵，用负 scroll 硬拗偏移会让点击整体错位

所以 UI 排版全部在"画布像素"坐标系里做，尺寸常量仍按 CSS 像素书写、落点时乘 dpr。

### 4.3 ★ 安全区：UI 让出，相机铺满

这是本项目最绕的一处，**改之前务必读完**。

真机数据（iPhone 393×852，PWA）：`screen.height = 852`、`env(top/bottom) = 59/34`、`innerHeight = 793`（= 852 − 59）。
iPhone 15 Pro 横屏（852×393）则是：`env(top/bottom) = 0/21`、`env(left/right) = 59/59`。

`env(top) = 59` 有两个含义：

| 谁 | 怎么处理 | 为什么 |
|---|---|---|
| **相机取景**（`GameScene`） | **整块画布，不内缩** | 世界可以落到灵动岛/圆角下面，由硬件自然遮挡；按安全区裁 viewport 会在横屏左右/底部露黑边 |
| **UI 覆盖层**（`UIScene`） | `uiInsets()`；top **永远不让出**，left/right/bottom 都让 | HUD 是"盖"上去的。`black-translucent` 让状态栏白字浮在网页上，HUD 底色必须铺到 y=0 盖住它，文字排到 59 之下；横屏左右是灵动岛/圆角，按钮和 HUD 必须收进去 |

**用错的后果**：build 17 让 UI 也走 `contentInsets`，`safe.top` 归零 → HUD 底色只到 45px，
状态栏那排白字落在里面被糊掉 → 用户反馈"顶部状态栏看都看不到了"。
`contentInsets()` 现在只作 `uiInsets()` 的辅助/历史判据，不再给相机用。

同理，`--app-h` 必须写 `innerHeight`，不能写 `visualViewport.height`：
后者是 793 而屏幕是 852，页面只画到 793，下方 59px 直接露 `html` 背景色（"底部黑条空白"）。

### 4.4 存档字段必须登记

`core/save.ts` 的 `normalizeWorld()` 是**白名单式**复原：没在函数里登记的字段，读档后直接丢失。

```ts
// 加字段时三处都要动：
// 1) core/types.ts 的 World 接口
// 2) core/save.ts 的 normalizeWorld 里显式读取 + 兜底值
// 3) core/config.ts 的 SAVE_FMT +1，并在 migrateFrom 里加一档迁移
```

e2e 里有一条用例专门守这个：写入 → reload → 逐字段（含嵌套）比对。

---

## 5. 踩坑清单（真机才暴露的问题）

普通浏览器看不出来，只有真机 / PWA 里才复现。按"现象 → 根因 → 修法"记录。

| # | 现象 | 根因 | 修法 |
|---|---|---|---|
| 1 | 顶部 HUD 被灵动岛吃掉 | 画布 `viewport-fit=cover` 铺满全屏，HUD 从 y=0 画 | HUD 从 `safe.top` 起画，且底色向上铺满把安全区一起盖住 |
| 2 | "能点但看不清" | `env()` 比真实遮挡少几像素，文字贴着 HUD 上沿 | HUD 高度按内容实算 + `padY = 9` 内边距，文字 `origin(0,0)` 从 `ty` 起排 |
| 3 | 顶部一条深色带 | 视口已让开 59px，代码又按 `env(top)` 让了第二次 | 见 §4.3 的 `viewportTopAlreadyInset()` |
| 4 | 状态栏文字看不见 | UI 也用了 `contentInsets`，`safe.top` 归零 | UI 改用 `uiInsets()`，top 永不归零 |
| 5 | 底部黑条 + 空白 | `--app-h` 写成 `visualViewport.height`（793），屏幕 852 | 改用 `innerHeight`，页面铺满整屏；`#game` 加兜底色 |
| 6 | PWA 里 `env()` 全为 0 | iOS 独立窗口常不应用 `viewport-fit=cover` | `currentSafeInsets()`：iOS + 独立模式 + env 全 0 时用 `IOS_PWA_FALLBACK = {top:59, bottom:34}` |
| 7 | 冷启动页面高度定格在错值 | `visualViewport` 晚 1~3 帧才稳定，只写一次 `--app-h` | 前 72 帧逐帧补测（`settleAppHeight`），之后交给 resize |
| 8 | 面板按钮点不中 | 尺寸常量忘了乘 dpr | 见 §4.1 |
| 9 | 面板右下一半失灵 | `Container.setSize()` 改了 displayOrigin，但 Container 按 0 原点渲染 | 用自定义命中区 `setInteractive(new Geom.Rectangle(...))` |
| 10 | "按下动作键 → 面板弹出 → 松手"面板瞬间关闭 | 抬手事件落到了遮罩上 | 记录面板创建时已按下的指针，这些指针的 `pointerup` 不算点遮罩 |
| 11 | 更新提示条压在状态栏、点不到 | `top:8px` 没算安全区，且触控目标只有 34px | 改为屏幕 38% 居中，`padding:14px 24px`（≥44px 触控下限） |
| 12 | 竖屏面板内容超出边界 | 面板按 640 宽设计，竖屏只有 350 | `body.setScale(min(1, PANEL_W / 640))` 整体等比缩放 |
| 13 | 子目录部署 404 | 用了绝对路径 | `base: './'` 全相对路径，e2e 有深层子路径用例守着 |
| 14 | 同一版本内多次构建，手机还是旧页面 | SW 缓存名只含 BUILD | 缓存名叠加`构建产物内容哈希`（`CACHE_TAG`），产物变则缓存名必变 |

> 更详细的推理过程见 [`TECH_NOTES.md`](./TECH_NOTES.md) 的「屏幕适配」与「PWA / 离线」两节。

---

## 6. 测试策略

### 单元测试（73 条，`tests/unit/`）

全是 `core/` 的纯函数，不碰浏览器。改了经济、存档、作物、NPC 逻辑必须保持绿。

| 文件 | 守什么 |
|---|---|
| `save.test.ts` | 存档字段登记、坏数据兜底、迁移 |
| `layout.test.ts` | 相机 zoom 换算、任意比例下地块不变形 |
| `safe-insets.test.ts` | 安全区读取、上限夹取、iOS 判定（含 iPadOS 伪装 Mac 的坑） |
| `viewport-inset.test.ts` | ★ 视口是否已让开、`uiInsets` 与 `contentInsets` 的分工 |
| `crops.test.ts` / `economy.test.ts` / `npc.test.ts` | 作物阶段、买卖算价、好感度边界 |

### E2E（38 条，`tests/e2e/`）

| 文件 | 守什么 |
|---|---|
| `smoke.spec.ts` | 加载无报错、核心循环（锄→种→浇→睡→收→卖→买）、存档持久化、断网可用、6 种视口自适应、dpr=2/3、运行中转屏、**深层子路径 0 条 404** |
| `safe-area.spec.ts` | 三种机型的 HUD/按钮位置、**iOS PWA 真机场景（screen 852 / inner 793）**、env 失效兜底、更新提示条尺寸 |
| `modal.spec.ts` | 面板 ✕ 可点、按钮可点、摇杆被锁、竖屏内容不越界、诊断面板 |
| `orientation.spec.ts` | 竖屏建议卡片、全屏请求、iOS 降级体验 |

**headless 怎么测安全区**：Chromium 没有刘海，`env()` 恒为 0。e2e 用
`window.__valeSafeInsets = { top: 59, bottom: 34 }` 注入真机数值，
`currentSafeInsets()` 优先取注入值。**这是产线代码里保留的测试钩子，别删。**

### 线上冒烟

```bash
node tools/live-check.mjs https://example.com/
```

对已部署地址跑 6 个视口 + 1 次转屏，每个视口都用 CDP 真触摸走一遍"关晨报 → 点互动键"。
URL 由使用者显式传入，仓库不记录部署地址。

---

## 7. 发版流程

顺序不能乱：

```bash
# 1. 改代码，跑测试
npm test && npm run test:e2e

# 2. 递增构建号（写清这次改了什么）
node tools/stamp.js --build --note "这次改了什么"
# 或 node tools/stamp.js --bump patch --note "..."（升版本号）

# 3. 重新构建
npm run build

# 4. 再跑一次 e2e（此时测的是新产物）
npm run test:e2e

# 5. 打包
npm run package      # → ../微光农庄-v{ver}-build{build}.zip

# 6. 提交
git add -A && git commit -m "..." && git push
```

`public/version.json` 是版本信息的**唯一数据源**，`tools/stamp.js` 会把构建号注入
`sw.js` 的 `BUILD` 并回读校验，不要手改任何一处的版本号。
发版前先更新 [`CHANGELOG.md`](../CHANGELOG.md)，再执行 `stamp`。

### 用户怎么收到更新

不发自动刷新。新 SW 装好后弹一条"已更新到新版本，点此刷新"，用户点了才 reload ——
因为玩家可能正在玩，自动刷新会丢操作。见 `src/pwa.ts`。

---

## 8. 目录分工（构建产物 vs 文档）

```
docs/        构建产物，GitHub Pages 发布源。每次 build 会整个清空重建。
dev-docs/    人写的文档。build 不会碰，随便加文件。
```

**为什么产物必须在 `docs/`**：GitHub Pages 的 "Deploy from a branch" 只允许 `/` 或 `/docs`，
不能指定别的目录名。所以 `docs/` 这个名字是 Pages 的硬约束，改不了。

---

## 9. 已知技术债 / 接手后可以做的

### 明确的技术债

| 项 | 说明 | 建议 |
|---|---|---|
| `UIScene.ts` 941 行 | 所有面板都挤在一个文件里，改一个面板要翻很久 | 按面板拆成 `ui/panels/*.ts`，先抽 `makePanel` 的调用样板 |
| 打包体积 1.5 MB | Phaser 本身占大头，gzip 后 362 KB | 如可接受功能裁剪，考虑 Phaser 自定义构建只保留 Arcade + WebGL |
| 无美术管线 | 资源由 `tools/gen_assets.py` 程序化生成 PNG 精灵图 | 想换成手绘美术，直接替换 `public/assets/*.png` 即可；帧尺寸见 `scenes/BootScene.ts` 的 `frameWidth/frameHeight`，UI 图标帧名见 `core/generated/ui.frames.ts` |
| 无音效文件 | WebAudio 实时合成（`core/audio.ts`） | 想换真实音效，改 `audio.ts` 的合成函数为播放采样 |
| iOS 无法锁横屏 | Safari 限制，只能引导用户加到主屏 | 已做降级：竖屏照常可玩，只是给建议卡片 |

### 可扩展方向

`GAME_DESIGN.md` 第 10 节「待定 / 可扩展方向」列了内容层面的规划（矿洞、钓鱼、动物等）。
技术上都没有硬阻塞，注意两点：

1. 新内容如果要进存档 → 走 §4.4 的三处登记 + 版本迁移
2. 新 UI 面板 → 复用 `makePanel`，别自己写一套容器和遮罩

---

## 10. 排查手册

| 症状 | 先查什么 |
|---|---|
| 页面白屏 / 报错 | 浏览器 console；`npm run build` 有没有真的跑完（`tsc` 报错会中断） |
| 改了代码但效果没变 | ① 有没有重新 build ② SW 缓存（DevTools → Application → 清缓存 + 硬刷新） |
| 手机上布局错位 | ☰ → 系统 → **环境诊断**，面板里有视口 / 安全区 / HUD 各项实测值，可一键复制 |
| 点击位置偏移 | 通常是 dpr 混用（§4.1）或改了 UI 相机的三约束（§4.2） |
| 存档丢失 | 检查 `normalizeWorld` 有没有登记该字段（§4.4）；IndexedDB 被隐私模式禁用时走 localStorage 兜底 |
| 断网打不开 | `docs/sw.js` 里的 `ASSETS` 清单是否包含产物 hash 文件 —— 必须是 `tools/postbuild.js` 注入过的 |

**环境诊断是排查真机问题的第一入口**，PWA 里没有地址栏打不开 `diag.html`，所以做进了游戏内。

---

## 11. 交接清单（给接手人）

- [ ] `npm install && npm run build && npm test && npm run test:e2e` 全绿
- [ ] `npm run dev`，用手机同局域网打开，能正常玩
- [ ] 读一遍 §4 的四条约定（尤其 §4.3 安全区两套口径）
- [ ] 读一遍 `GAME_DESIGN.md`，了解数值都在哪
- [ ] 确认真机验证环境（iPhone + Android 各一台，能装 PWA）
- [ ] 部署链路：GitHub 仓库 → Pages 源设为 `/docs`（见 `GITHUB_PAGES.md`）
- [ ] 确认存档导出 / 导入能用：☰ → 系统 → 导出存档

---

_最后更新：v0.4.2 build 19_
