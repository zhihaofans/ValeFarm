// 屏幕适配：让画布永远铺满真实屏幕，同时保证世界不变形。
//
// 核心思路（不能用「固定 16:9 + FIT」，那样竖屏只能缩成一条黑边带）：
//   1. 画布内部分辨率 = 视口尺寸 × dpr，CSS 撑满 → 永远无黑边
//   2. 相机 zoom 做反向补偿：
//        横屏 zoom = max(屏高/450, 屏宽/800)   竖屏 zoom = 屏高/844
//   3. 结果：**地块永远是正方形**，只有「看得多/看得少」的变化，没有拉伸
//
// 为什么不用别的办法：
//   - CSS rotate(90deg) 视觉转了但触摸坐标不跟 → 点击整体错位
//   - Stretch 模式人物会变胖 → 一眼假
//
// 关于刘海 / 灵动岛（safe-area）：
//   画布是铺到全屏的，安全区不在这一层扣 —— zoom 一旦按「扣掉安全区的高度」算，
//   地图在物理上就是等比缩小（地块变方变小的同时还能看见更多格子），
//   而屏幕下方仍是同一块世界，等于把安全区里那些格子白送掉。
//   正确做法是「地图照铺满、可见区域照满屏，只让 UI 元素躲开安全区」，
//   具体在 UIScene（HUD 下移、底部按钮上抬）与 GameScene（相机视口内缩）里做。

/** 横屏设计基准高（world units）。24×16 地图 = 768×512 world px */
export const BASE_H = 450;
/** 横屏设计基准宽。超宽屏至少保留这么宽，避免像素被放大到糊成一团 */
export const BASE_W = 800;
/** 竖屏基准高：竖屏沿用同样的像素密度会让横向只剩 ~208 world px，抬到 844 才有 ~424 */
const PORTRAIT_H = 844;

export interface Layout {
  /** 视口 CSS 像素 */
  screenW: number;
  screenH: number;
  /** 画布内部分辨率（= CSS × dpr，必须严格等于，否则 CSS 拉伸会露黑边） */
  renderW: number;
  renderH: number;
  /** 相机 zoom */
  zoom: number;
  /** 可见的 world 宽高（= 屏幕 / zoom），HUD 与面板都按它排版 */
  viewW: number;
  viewH: number;
  portrait: boolean;
  dpr: number;
}

/** 纯函数版本，供单测直接喂尺寸 */
export function computeFor(screenW: number, screenH: number, dpr = 2): Layout {
  const w = Math.max(1, Math.round(screenW));
  const h = Math.max(1, Math.round(screenH));
  const portrait = h > w;
  // 不能封顶到 2：画布内部像素必须和 CSS×真实 dpr 严格一致，
  // 否则 CSS 100% 拉伸会造成模糊或底部露黑（踩过：dpr=3 的手机竖屏底部一条黑带）
  const d = Math.max(1, dpr);
  // 两种朝向用不同基准（都保证 world px : 屏幕 px 是等比的，所以地块永远方）：
  //   横屏：以 450 高打底；超宽屏再按宽补齐，避免像素被放大到看不清全图
  //   竖屏：以 844 高打底，横向才留得下 ~424 world px 给 HUD / 面板
  const zoom = portrait ? h / PORTRAIT_H : Math.max(h / BASE_H, w / BASE_W);
  return {
    screenW: w,
    screenH: h,
    renderW: Math.round(w * d),
    renderH: Math.round(h * d),
    zoom,
    viewW: w / zoom,
    viewH: h / zoom,
    portrait,
    dpr: d,
  };
}

export function computeLayout(): Layout {
  // 用 #game 的实际 CSS 尺寸，而不是 window.innerWidth/innerHeight：
  // iOS 上 body 高度被 --app-h 收窄之后，innerHeight 仍可能大于画布，
  // 两者不一致会让内部分辨率与显示尺寸对不上（画面拉伸 + 触摸偏移）。
  const el = typeof document !== 'undefined' ? document.getElementById('game') : null;
  const r = el?.getBoundingClientRect();
  const w = r && r.width > 0 ? r.width : window.innerWidth;
  const h = r && r.height > 0 ? r.height : window.innerHeight;
  return computeFor(w, h, window.devicePixelRatio || 1);
}

// ---------------------------------------------------------------- 安全区域
//
// 刘海 / 灵动岛 / 底部 Home 指示条占掉的边距，iOS 通过 env(safe-area-inset-*) 暴露，
// 且**只在 viewport-fit=cover 时才有值**（否则页面被自动挤进安全区）。
//
// 读法：临时挂一个探针元素，给四条边各自读 computed padding。
// 不缓存 —— 转屏后数值会变（横屏时 top 归零、左右各 44px，灵动岛跑到侧边）。

export interface SafeInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const NO_INSETS: SafeInsets = Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 });

const ZERO = NO_INSETS;

/** 量一次 env(safe-area-inset-*)，单位 CSS 像素 */
export function readSafeInsets(): SafeInsets {
  if (typeof document === 'undefined') return { ...ZERO };
  const el = document.createElement('div');
  el.style.cssText = [
    'position:fixed', 'top:0', 'left:0', 'width:0', 'height:0',
    'visibility:hidden', 'pointer-events:none', 'z-index:-1',
    'padding-top:env(safe-area-inset-top,0px)',
    'padding-right:env(safe-area-inset-right,0px)',
    'padding-bottom:env(safe-area-inset-bottom,0px)',
    'padding-left:env(safe-area-inset-left,0px)',
  ].join(';');
  document.body.appendChild(el);
  const cs = getComputedStyle(el);
  const num = (v: string) => Math.max(0, Math.round(parseFloat(v) || 0));
  const out = {
    top: num(cs.paddingTop),
    right: num(cs.paddingRight),
    bottom: num(cs.paddingBottom),
    left: num(cs.paddingLeft),
  };
  el.remove();
  return out;
}

/**
 * 把安全区裁到合理上限，返回「CSS 像素」。
 *
 * e2e 与调试可写 window.__valeSafeInsets = { top: 59, bottom: 34 } 覆盖实测值 ——
 * headless Chromium 没有刘海，env() 恒为 0，不注入就测不到这条路径。
 *
 * 上限的必要性：横屏半屏 / 分屏时视口高度可能只有 200px，
 * 若某条边读出 60 就只剩 140 可用，HUD 会盖住半个屏幕。
 */
export function effectiveSafeInsets(raw: SafeInsets = readSafeInsets(), viewH = window.innerHeight): SafeInsets {
  const cap = Math.max(0, Math.min(80, viewH * 0.16));
  const clamp = (v: number) => Math.max(0, Math.min(cap, v));
  return {
    top: clamp(raw.top),
    right: clamp(raw.right),
    bottom: clamp(raw.bottom),
    left: clamp(raw.left),
  };
}

/**
 * 是否跑在「添加到主屏」后的独立窗口里。
 *
 * iOS 上 `navigator.standalone` 才有值；其它平台看 display-mode。
 * 注意 `(display-mode: standalone)` 在 iOS 上不可靠，两个都要问。
 */
export function isStandaloneApp(): boolean {
  if (typeof window === 'undefined') return false;
  if ((navigator as unknown as { standalone?: boolean }).standalone === true) return true;
  return typeof window.matchMedia === 'function'
    && window.matchMedia('(display-mode: standalone)').matches;
}

/**
 * 是否在 iOS / iPadOS。
 *
 * 分两种情况：
 *   - iPhone / iPad（老 UA）：UA 里直接带 iPhone|iPad|iPod，最可靠
 *   - iPadOS 13+ 默认发桌面版 UA，写着「Macintosh; Intel Mac OS X」，只能靠触点数区分：
 *     真 Mac 的 maxTouchPoints === 0，iPad 是 5。**必须严格 > 1** ——
 *     真 Mac 上没触摸屏这条永远是 0，所以不会把桌面浏览器误认成 iPad。
 */
export function isIosDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  const touch = navigator.maxTouchPoints ?? 0;
  return ua.includes('Macintosh') && touch > 1;
}

/**
 * iOS PWA 独立模式的安全区兜底值（CSS 像素）。
 *
 * 为什么需要兜底：`env(safe-area-inset-*)` 在 iOS 的独立窗口里**经常返回 0** ——
 * 很多版本不把 `viewport-fit=cover` 应用到 standalone 窗口，
 * 而 `apple-mobile-web-app-status-bar-style=black-translucent` 又让内容铺到状态栏下面。
 * 两者叠加的结果就是：HUD 跑进状态栏、底部按钮压在 Home 条上（0.4.2 用户实拍图二）。
 *
 * 取值依据：iPhone 全面屏状态栏 47~62px（灵动岛机型更高）、Home 指示条 34px。
 * 只在「独立模式 + iOS + env() 读出来是 0」时启用，所以不会和真实值打架。
 */
const IOS_PWA_FALLBACK: SafeInsets = { top: 59, right: 0, bottom: 34, left: 0 };

/** 当前生效的安全区（CSS 像素）：测试注入 > env() > iOS 独立模式兜底 */
export function currentSafeInsets(viewH: number = window.innerHeight): SafeInsets {
  if (typeof window === 'undefined') return { ...ZERO };
  const injected = (window as unknown as { __valeSafeInsets?: SafeInsets }).__valeSafeInsets;
  if (injected) return effectiveSafeInsets(injected, viewH);

  const raw = readSafeInsets();
  // env() 完全读不到（四边全 0）且处于 iOS 独立窗口 → 用经验值顶上。
  // 只要读到任意一条边就认为 env() 是工作的，不再叠经验值。
  const envWorks = raw.top > 0 || raw.bottom > 0 || raw.left > 0 || raw.right > 0;
  if (!envWorks && isIosDevice() && isStandaloneApp()) {
    return effectiveSafeInsets(IOS_PWA_FALLBACK, viewH);
  }
  return effectiveSafeInsets(raw, viewH);
}

/**
 * 视口（innerHeight / 可视区）是否**已经把安全区让出去了**。
 *
 * 这是 iOS PWA 最容易看错的一处，实测数据（iPhone 393×852，build 15 的真机反馈）：
 *
 *   screen.height = 852，env(top/bottom) = 59 / 34，innerHeight = 793
 *   852 - 59 = 793 ✅   852 - 59 - 34 = 759 ❌
 *
 * 结论很明确：**只有顶部让开了**（网页从状态栏之下开始画），底部**没有**让 ——
 * Home 条那块仍在可视区内，内容照旧需要为它让出 34px。
 *
 * 之前按两条边一起加，正是"顶部深色带"的成因：顶部被系统让了一次、
 * 代码又按 env(top) 让了第二次，HUD 白白下移 59px，顶上留出一条深色带。
 *
 * 判据只看 top：
 *   画布高 + env.top ≈ 屏幕高  → 顶部已让开，top 不要再叠加
 *   画布高            ≈ 屏幕高  → 没让开（画布铺满全屏），top 照旧叠加
 * bottom 不参与判断，始终按 env(bottom) 让 —— 顶部让开不代表底部也让。
 *
 * 容差 8px：iOS 的 screen 与 innerHeight 常有几像素偏差（缩放 / 圆角）。
 */
export function viewportTopAlreadyInset(viewH: number, insets: SafeInsets, screenH: number): boolean {
  if (!(viewH > 0) || !(screenH > 0)) return false;
  // env 没报遮挡时谈不上让开
  if (insets.top <= 0) return false;
  const withTop = viewH + insets.top;
  const fitsScreen = Math.abs(withTop - screenH) <= 8;
  const fillsScreen = Math.abs(viewH - screenH) <= 8;
  return fitsScreen && !fillsScreen;
}

/**
 * 算出「元素还需要额外让多少」：
 *   - 顶部已让开 → top 归 0（别再让第二遍），其余边原样
 *   - 顶部没让开 → 原样返回 env 值（旧行为）
 *
 * ⚠️ 只用于 **相机取景**（GameScene.safePx）：
 * 相机是在「可视区」里再切一块出来取景，视口已让开时再切一刀，等于把地图白裁掉一条，
 * 反正那 59px 本来就不在可视区里、也没被挡住。
 *
 * **UI 绝对不能用它** —— HUD 是"盖"上去的，不用它盖住状态栏那一条，
 * 状态栏文字（时钟 / 信号）就直接被 HUD 底色糊掉了（0.4.2 build 17 真机实拍）。
 * UI 用 uiInsets()。
 */
export function contentInsets(raw: SafeInsets, viewH: number, screenH: number): SafeInsets {
  if (!viewportTopAlreadyInset(viewH, raw, screenH)) return { ...raw };
  return { top: 0, right: raw.right, bottom: raw.bottom, left: raw.left };
}

/**
 * HUD 底色的**顶部高度**（CSS 像素）。
 *
 * 背景：iOS PWA 里 `black-translucent` 让网页从屏幕物理顶端开始画，状态栏文字浮在网页上方。
 * 此时 env(top)=59 有两个含义，必须分开对待：
 *
 *   - 可视区上沿到屏幕顶端的这段（59px）**要被 HUD 底色盖住**（否则状态栏白字压草地看不清）
 *   - 内容（日期 / 金币）**要排在状态栏之下**（否则被状态栏吃掉）
 *
 * 所以顶部让出量永远是 env(top) 原值，绝不因为「视口已让开」而归零。
 * 归零后 HUD 从 y=9 起画，底色只盖住屏幕 0~45px，状态栏文字正好落在这条里 → 看不见了。
 * 底部不同：底部没有"要盖住"的东西，视口已让开就别再让（见 uiInsets）。
 */
export function hudBandTop(raw: SafeInsets): number {
  return Math.max(0, raw.top);
}

/**
 * UI（画布内的 HUD / 按钮 / 摇杆）该让出的边距，CSS 像素。
 *
 * 与 contentInsets 的区别就在 top：UI 不用"视口已让开"把 top 归零。
 * 原因见 hudBandTop 注释：那 59px 仍需要 HUD 底色去盖（状态栏文字是白色的）。
 *
 * 底部沿用 contentInsets 的判断：iOS 实测 793 = 852 - 59 —— 只让开了顶部，
 * 底部仍要按 env(bottom)=34 让开，否则按钮压在 Home 指示条上（上滑手势被系统抢走）。
 */
export function uiInsets(raw: SafeInsets, viewH: number, screenH: number): SafeInsets {
  const bottomAdjusted = contentInsets(raw, viewH, screenH);
  return { top: hudBandTop(raw), right: bottomAdjusted.right, bottom: bottomAdjusted.bottom, left: bottomAdjusted.left };
}

/** 视口变化回调（含地址栏收起/软键盘引发的 visualViewport 变化），rAF 合并抖动 *//** 视口变化回调（含地址栏收起/软键盘引发的 visualViewport 变化），rAF 合并抖动 */
export function watchViewport(cb: () => void): () => void {
  let raf = 0;
  const fire = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(cb);
  };
  window.addEventListener('resize', fire);
  window.addEventListener('orientationchange', fire);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', fire);
    window.visualViewport.addEventListener('scroll', fire);
  }
  return fire;
}
/**
 * 相机 zoom 换算：Phaser 的 Camera 先应用 zoom，再乘画布「内部分辨率 → CSS」的比例。
 * 我们想要的是「1 world px = k 个物理像素」，其中 k = 屏幕高度 / 设计高度。
 * 所以 camera.zoom = k / (displayScale × dpr)。
 */
export function gameZoom(canvasPxW: number, canvasPxH: number, cssW: number, cssH: number): number {
  // cssW/cssH 是 CSS 像素（= Phaser 的 displaySize），canvasPx 是画布内部分辨率
  // 极端情况（画布尺寸被浏览器强制改动）下不能假设 canvasPx/cssPx == dpr，逐个算更稳
  const l = computeFor(cssW, cssH, 1);
  const cssPerWorld = l.zoom; // CSS px per world px
  const canvasPerCss = canvasPxW / Math.max(1, cssW);
  return cssPerWorld * canvasPerCss;
}
