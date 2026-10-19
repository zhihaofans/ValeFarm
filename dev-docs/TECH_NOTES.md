# 技术细节

> 从 README 抽出的实现推理，面向维护者，不面向项目访客。
> 项目介绍见 [../README.md](../README.md)；开发约定、发版流程、踩坑清单见 [DEV_HANDOVER.md](./DEV_HANDOVER.md)；数值见 [GAME_DESIGN.md](./GAME_DESIGN.md)。

## 1. 屏幕适配

目标：任何比例的屏幕都铺满、都能玩；横屏、竖屏、iPad、折叠屏外屏都不留黑边，地块永远是正方形。

做法是「画布铺满 + 相机 zoom 反补」：

| 环节 | 做法 |
|---|---|
| 画布 | `Phaser.Scale.NONE` + CSS `width/height: 100%`；内部分辨率 = **CSS × 真实 dpr（不封顶）** |
| 相机 zoom | 横屏 `max(屏高/450, 屏宽/800)`，竖屏 `屏高/844` |
| 结果 | zoom 只改变「看得多/看得少」，1 world px 恒等于 `zoom` 个 CSS px → **地块不变形** |
| 边界 | 相机 bounds 向四周外扩半屏 + 地图外圈多铺 8 格草地，杜绝露出底色 |
| 转屏 | `visualViewport`/`resize` → rAF 合并 → `setGameSize` → UI 场景 60ms 防抖后整棵重建 |

实现见 [layout.ts](../src/layout.ts) 与 [GameScene.ts](../src/scenes/GameScene.ts)。

### 1.1 UIScene 相机的三条约束

少一条画面就废：

```ts
cam.setOrigin(0, 0);                                   // ① 否则 zoom≠1 时平移项 = w*0.5*(1-zoom)，UI 被推走
cam.setZoom(1);                                        // ② 同上
cam.setViewport(0, 0, scale.width, scale.height);      // ③ WebGL 用 cam.width/height 做 scissor 裁剪
```

原因在 Phaser 源码里：

- `WebGLRenderer.preRenderCamera` → `pushScissor(cam.x, cam.y, cam.width, cam.height)`，**`cam.width` 必须是整块画布**，改小就只画出左上角 1/dpr 一块；
- `Camera.preRender` → `matrix.applyITRS(w*originX, ..., zoom) · translate(-w*originX, ...)`；平移项恒为 `e = w*originX*(1-zoom)`，`originX` 默认 0.5，zoom=3 时 `e = -w`，整块 UI 被推到屏幕外；
- 用负 `scroll` 硬拗偏移能骗过渲染，但 `getWorldPoint` 会算反，输入全废。

所以 UI 坐标统一用**画布像素**；尺寸常量仍按 CSS 像素书写，落点时乘 `uiDpr`（`UIScene.DP`）。

### 1.2 单位约定：谁乘 dpr，只能有一处说了算

0.4.0 上线后真机暴露过：坐标系换成「UI 单位 = 画布像素」时，`widgets.ts` 里的面板尺寸常量忘了乘 dpr，dpr=3 的手机上面板只有 `640/3 ≈ 213` CSS px、✕ 按钮宽 16px，**看着是“面板没撑开”，实际是手指根本点不中**（0.4.1 修复）。

统一规则：

> **调用方一律写 CSS 像素，[widgets.ts](../src/ui/widgets.ts) 内部统一乘 `uiScale(scene)`。**

- `textButton(x, y, w, h, ...)`、`label(x, y, ...)`、`makePanel()` 收的都是 CSS 值；
- `Panel.w / Panel.h` 对外也是 CSS 值；
- `uiScale(scene) = scene.scale.width / window.innerWidth`，与 `UIScene.uiDpr` 同源。

`UIScene` 的 `buildHud / buildButtons` 自己乘 `S`，传给 `textButton` 前要除回去。

### 1.3 面板内容自适应缩放

面板内部排版按 **640 宽的横屏面板**设计；竖屏面板只有 ~320–370 宽，硬塞会伸出左右边。修法在 `makePanel` 内一处搞定：

```ts
const bodyScale = Math.min(1, PANEL_W / (640 * S));
body.setScale(bodyScale);
```

坐标、字号、命中区一起缩，触摸检测随 transform 自动正确；横屏 `bodyScale = 1`。

## 2. 安全区（刘海 / 灵动岛 / Home 指示条）

画布 `viewport-fit=cover` 铺满全屏，所以必须自己躲开安全区，否则 iOS 上顶部整条 HUD 会被灵动岛吃掉。

四条铁律：

1. **不能用 padding 挤 `#game`**。画布被顶小，但 Phaser 的内部分辨率仍按视口算 → CSS 拉伸、画面糊、触摸坐标整体偏移。`env()` 只在 `viewport-fit=cover` 时有意义。
2. **不能让 zoom 去扣安全区，也不要按安全区裁相机 viewport**。相机保持整块画布：横屏时左右/底部一裁就会露出黑边，和「铺满」冲突；世界落到灵动岛/圆角下面由硬件自然遮挡即可。
3. **UI 落点一律从 `safe` 起算**。HUD 从 `safe.top + padY` 起，左侧内容从 `safe.left + pad` 起，右侧内容/☰ 收进 `safe.right`，底部按钮基线取 `max(pad, safeBottom, safe.bottom*S + pad/2)`。
4. **内容自己要有内边距**。`env()` 在 iOS 上常比真实遮挡少几像素；HUD 高度按内容实算（`lines * lineH + padY * 2`，`padY = 9`），文字统一 `origin(0,0)` 从 `ty` 起排。

读取在 [layout.ts](../src/layout.ts)：`readSafeInsets()` 挂探针元素读四条边的 computed padding；`effectiveSafeInsets()` 再夹一道上限 `min(80px, 视口高 × 16%)`，避免分屏时把 UI 挤没。

**不缓存**：转屏时 `resize` 与 `env()` 的生效顺序各浏览器没保证；`UIScene.update()` 每帧读一次、值变了才重建 HUD/按钮。

e2e（headless Chromium 没有刘海，`env()` 恒为 0）通过 `window.__valeSafeInsets = { top: 59, right: 0, bottom: 34, left: 0 }` 注入真机数值，`currentSafeInsets()` 优先取注入值。**这是产线里保留的测试钩子，不要删。**

### 2.1 UI 与相机：谁让、谁不让

真机实测（iPhone 393×852）：`screen.height = 852`、`env(t/b) = 59/34`、`innerHeight = 793`。`852 - 59 = 793`，说明只有顶部被系统让开，底部没有。

| 谁 | 怎么处理 | 为什么 |
|---|---|---|
| 相机取景（`GameScene`） | **整块画布，不内缩** | 世界可以落到灵动岛/圆角下面，由硬件自然遮挡；按安全区裁 viewport 会在横屏左右/底部露黑边 |
| UI 覆盖层（`UIScene`） | `uiInsets()`：top 不让出，left/right/bottom 都让 | HUD 是**盖**上去的；`black-translucent` 让状态栏白字浮在网页上，HUD 底色必须铺到 y=0 盖住它，文字排到 59 之下 |

build 17 曾让 UI 也走 `contentInsets`，`safe.top` 归零 → HUD 底色只到 45px，状态栏白字被糊掉。
`contentInsets()` 现在只作为 `uiInsets()` 的辅助/历史判据，不再给相机用。

### 2.2 底部黑带与 `--app-h`

早期 `html/body { height: 100% }` 在 iOS 取 layout viewport，地址栏/状态栏一收放就差一截。现在：

- `height: 100dvh`；
- `main.ts` 的 `measureAppHeight()` **只读 `innerHeight`** 写 `--app-h`（不要改回 `visualViewport.height`）；
- 冷启动时 `settleAppHeight()` 逐帧补测约 1.2 秒（72 帧），避免第一次读到旧值后页面定格；
- `#game` 加 `background: #1a2218` 兜住 `setGameSize` 慢一帧的空档。

真机上如果 `innerHeight` / `visualViewport.height` 与文档不符，以游戏内环境诊断的实测值为准。

### 2.3 iOS PWA 独立模式

| 现象 | 根因 | 修法 |
|---|---|---|
| 顶部露出深色带，HUD 被压到状态栏下 | iOS 独立窗口里 `viewport-fit=cover` 常不生效 → `env()` 全为 0；`black-translucent` 又让内容铺到状态栏下 | `currentSafeInsets()`：`env()` 四边全 0 且「iOS + 独立模式」时兜底。竖屏用 `59/0/34/0`，横屏用 `0/59/21/59`；读到任意一条边就认为 env 正常，不叠经验值 |
| 上下各一条黑带（高度偏小） | 冷启动瞬间可视高度（`innerHeight` / `visualViewport`）还是旧值/0；早先只写一次 `--app-h`，页面定格在偏小高度 | `measureAppHeight()` 返回 `null` 表示“没量准，继续等”，`settleAppHeight()` 补测 |

环境判断的边界：

- `isIosDevice()` 对 iPadOS 13+（UA 伪装成 `Macintosh`）靠 `maxTouchPoints > 1` 区分；真 Mac 恒为 0。
- `isStandaloneApp()` 两个条件都要问：`navigator.standalone` 只有 iOS 有值，`(display-mode: standalone)` 在 iOS 上不可靠。
- `manifest.json` 的 `display` 必须是 `standalone`（iOS 不认 `fullscreen`），`display_override` 只对 Chromium 系生效。

### 2.4 诊断入口

- **游戏内**：☰ → 系统 → 环境诊断。PWA 独立窗口没有地址栏，这是唯一可行的入口；显示浏览器环境 + 游戏实际排版结果，右上角 ⧉ 一键复制。
- **浏览器标签页**：打开 `/diag.html`。该页在 `sw.js` 里走 `networkFirst`，保证永远是服务端最新的一份；其它资源是 cacheFirst。

### 2.5 iPhone 15 Pro

| 方向 | 视口 / 注入安全区 | UI 处理 |
|---|---|---|
| 竖屏 | 393×852，`59/0/34/0` | HUD 从 top 59 起；左右无让出 |
| 横屏 | 852×393，`0/59/21/59` | HUD 日期从 left 59 + pad 起；☰ / 体力 / 金币收进 right 59；摇杆和互动键左右也让 59 |

横屏的左右 59px 与底部 21px 只影响 UI；相机仍铺满整块画布。e2e 有 iPhone 15 Pro 横竖屏用例，断言 HUD / ☰ / 摇杆 / 互动键都在安全区内，且相机取景比例等于屏幕比例。

## 3. 竖屏提示条

竖屏**本来就能玩**，`#rotate-tip` 是一张浮在屏幕中央的建议卡片，不是遮罩：

- `#rotate-tip { pointer-events: none }` —— 卡片外照常点得到游戏；
- `#rotate-card { pointer-events: auto }` —— 卡片自己的按钮要能按。

按能力探测决定卡片上出现什么（`syncActions()`），原则是**不摆永远点不动的按钮**：

| 环境 | 卡片上给什么 |
|---|---|
| 普通浏览器 | 「横屏全屏」（手势内同步请求全屏 + 锁横屏）+ 「就这么玩」 |
| iOS Safari 标签页 | 同上 + 添加到主屏幕的三步图文（iOS 无全屏 API） |
| Chromium 系（有 `beforeinstallprompt`） | 「横屏全屏」+ 添加到主屏后固定横屏 + 「就这么玩」 |
| 已装成 PWA | 只留提示，不摆「横屏全屏」 |

两个易错点：

- **必须同步发起**：`await` 任何东西都会丢掉用户手势上下文，全屏/锁屏会被拒。`requestLandscape()` 是同步函数，成败靠 `.then/.catch`。
- **不要用 `scale.orientation: 'landscape'`**：它只决定画布取宽高基准，不能旋转设备；也不要 `transform: rotate(90deg)` —— 视觉转了、触摸坐标不跟。

## 4. 触控层的三个坑

都是「视觉对、点击不对」的问题，排查时优先怀疑层级与事件时序：

1. **Container 误用 `setSize`**：`setSize` 把 `displayOrigin` 设成尺寸的一半，而 Container 按 0 原点渲染，命中区整体偏移 `(-w/2, -h/2)`。修法：容器只 `setInteractive(自定义矩形)`，不 `setSize`。
2. **图标层级压住别的按钮**：动作键图标曾用 `buttons+1`，与 ☰ 的命中区在右上角重叠，图标赢了点击。修法：图标与底图同层，靠 displayList 顺序压上去；需要盖住别人的按钮显式提到 `buttons+2`。
3. **用 `pointer.id` 判断“手指是否是新按下的”**：Phaser 的触屏与合成鼠标复用同一组 Pointer 实例，id 会互相顶替。修法：用 `pointerdown` 的**事件对象**做 key（每个事件都是新对象），见 `makePanel` 的 `preDown`。

## 5. PWA / 离线

- 导航与静态资源一律 **cacheFirst**；更新靠后台静默拉新 + 切前台比对 `version.json`。
- 发现新版本只弹提示条，**绝不自动 reload**（用户可能正在玩）。
- 预缓存逐个 `cache.add` + catch，单个资源 404 不会连坐整个 install。
- 清缓存只清 `vale-farm-` 前缀，不误删同域其他应用。
- `sw.js` 注册带 `{ updateViaCache: 'none' }`，绕开静态托管的 `max-age`。
- 缓存名由 `BUILD` + `CACHE_TAG`（构建产物内容哈希）组成；同一版本内多次构建也能换新缓存。

实现见 [public/sw.js](../public/sw.js)、[pwa.ts](../src/pwa.ts)、[tools/postbuild.js](../tools/postbuild.js)。

## 6. 测试覆盖速查

- **单测** [tests/unit/](../tests/unit/)：作物状态机、经济、NPC 好感、存档 normalize/迁移、layout 不变量、安全区、viewport 让出、env 诊断。
- **e2e** [tests/e2e/](../tests/e2e/)：核心循环、存档写入 → reload 逐字段、断网、深层子路径 0 404、6 种视口自适应、dpr 2/3 面板与 ✕、运行中旋转、触控面板、面板遮罩全屏/点外关闭、体力条缩短、竖屏提示、安全区注入、iPhone 15 Pro 横竖屏左右安全区、环境诊断。
- **live-check**：6 个视口 + 1 次旋转；检查 `panelCss` / `closedByX` / `actOpens` / `noScroll` / `joyLeftBottom` / `actRightBottom` / `noErrors`。URL 必须显式传入，不写入仓库。
