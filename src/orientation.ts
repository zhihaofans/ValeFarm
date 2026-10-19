// 横屏策略（分层，逐层降级，任何一层失败都不影响游戏可玩）：
//   ① 用户手势里请求全屏 + screen.orientation.lock('landscape')
//      Android Chrome 支持好；iOS 16.4+ 的 Safari 不支持全屏 API，只用 CSS 撑满
//   ② 自己检测竖屏（不依赖 Phaser 的 scale.orientation —— 它只影响布局、不能旋转）
//   ③ 兜底：竖屏时浮一张**不挡触摸**的建议卡片（不是遮罩）+「横屏全屏」按钮
//
// 这里不碰 Phaser 的输入坐标系，也不用 CSS rotate 模拟横屏 ——
// 那样会让点击位置整体错位，比让用户转一下手机代价大得多。

const TIP_ID = 'rotate-tip';
const START_BTN_ID = 'rotate-start';

const INSTALL_BTN_ID = 'rotate-install';
const HELP_BTN_ID = 'rotate-install-help';
const CONTINUE_BTN_ID = 'rotate-continue';
const HOWTO_ID = 'rotate-howto';

/** 用户点了「就这么玩」：本会话内不再弹建议条（竖屏本来就能玩，这只是建议） */
let allowPortrait = false;
/** 已捕获的安装事件：只有 Chromium 系（含大部分国产 Android 浏览器）才有，iOS 没有 */
let installPrompt: { prompt: () => Promise<void>; userChoice?: Promise<unknown> } | null = null;

/** 窄于高即为竖屏。留 1px 容差，避免地址栏收缩造成的高频抖动 */
export function isPortrait(): boolean {
  const w = window.innerWidth;
  const h = window.innerHeight;
  return h - w > 1;
}

/** 是否以独立窗口（PWA / 主屏快捷方式）启动 —— 这是 iOS 上唯一有可能锁横屏的状态 */
export function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return (
    window.matchMedia('(display-mode: fullscreen)').matches ||
    window.matchMedia('(display-mode: standalone)').matches ||
    nav.standalone === true
  );
}

/** 触屏设备且竖屏时才需要提示；桌面浏览器随便拉伸不该被拦 */
export function shouldShowTip(): boolean {
  const touch = window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
  // 只在「触屏 + 竖屏 + 用户没关」时浮一张卡片；卡片不挡触摸，所以不做拦截式遮罩
  return touch && isPortrait() && !allowPortrait;
}

type LockableOrientation = ScreenOrientation & {
  lock?: (o: 'landscape' | 'portrait' | string) => Promise<void>;
};

/** 锁屏请求的"已成功"标记：解锁时要知道该不该 unlock() */
let lockedOnce = false;

/**
 * 必须在用户手势（click/touch/pointer 回调）里**同步**调用，不能先 await 别的东西，
 * 否则手势上下文丢失、全屏会被拒绝。两个请求都是"发起即返回"，结果由回调处理。
 * 返回值只表示"调用前已经在全屏里"，不用来判断成败。
 */
export function requestLandscape(): boolean {
  const el = document.documentElement as HTMLElement & {
    webkitRequestFullscreen?: () => Promise<void> | void;
  };
  let fullscreen = false;
  // 不 await：await 会丢失"用户手势"上下文，后面的 lock() 反倒更容易被拒
  try {
    if (document.fullscreenElement) {
      fullscreen = true;
    } else if (el.requestFullscreen) {
      void Promise.resolve(el.requestFullscreen({ navigationUI: 'hide' })).then(
        () => { fullscreen = true; }, () => { /* 用户拒绝 / iframe 未授权 */ },
      );
    } else if (el.webkitRequestFullscreen) {
      void Promise.resolve(el.webkitRequestFullscreen()).then(
        () => { fullscreen = true; }, () => { /* 忽略 */ },
      );
    }
  } catch {
    // 浏览器不支持 —— 静默降级
  }

  // 锁屏要紧随全屏请求调用（同一轮手势里），成功率最高；iOS 上没有这个方法。
  // 同样不 await —— await 会把执行权交回事件循环，手势上下文就没了。
  const so = (screen as unknown as { orientation?: LockableOrientation }).orientation;
  if (so && typeof so.lock === 'function') {
    try {
      void Promise.resolve(so.lock('landscape')).then(
        () => { lockedOnce = true; }, () => { /* 桌面/部分浏览器直接 reject */ },
      );
    } catch { /* 忽略 */ }
  }
  return fullscreen;
}

/** 解除横屏（用户主动退出全屏时调用，目前仅由全屏按钮反向切换） */
export async function releaseLandscape(): Promise<void> {
  const so = (screen as unknown as { orientation?: LockableOrientation }).orientation;
  if (lockedOnce && so && typeof so.unlock === 'function') {
    try { so.unlock(); } catch { /* 忽略 */ }
    lockedOnce = false;
  }
  if (document.fullscreenElement) {
    try { await document.exitFullscreen(); } catch { /* 忽略 */ }
  }
}

function syncTip(): void {
  const tip = document.getElementById(TIP_ID);
  if (!tip) return;
  const show = shouldShowTip();
  // display 直接切：Phaser 的画布尺寸由 scale manager 自己算，不依赖这个层
  tip.style.display = show ? 'flex' : 'none';
  tip.setAttribute('aria-hidden', show ? 'false' : 'true');
}

/** iOS：没有全屏 API，能不能锁横屏全看是否以 PWA 独立模式启动 */
function isIos(): boolean {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
}

/**
 * 按能力探测决定遮罩上出现哪些按钮。
 * 核心原则：**不摆永远点不动的按钮**。
 *  - iOS 浏览器标签页：requestFullscreen 不存在 → 藏「全屏并锁定横屏」，改成告诉用户怎么装到主屏
 *  - 已装成 PWA：不显示「横屏全屏」（此时横竖由系统的 manifest orientation 决定）
 *  - Chromium 且拿到了 beforeinstallprompt：给一个真正能用的「添加到主屏」
 */
function syncActions(): void {
  const tip = document.getElementById(TIP_ID);
  if (!tip) return;

  const start = document.getElementById(START_BTN_ID);
  const install = document.getElementById(INSTALL_BTN_ID);
  const help = document.getElementById(HELP_BTN_ID);
  const cont = document.getElementById(CONTINUE_BTN_ID);
  const howto = document.getElementById(HOWTO_ID);

  const standalone = isStandalone();

  tip.classList.toggle('standalone', standalone);

  // 独立模式里横竖由系统按 manifest 决定，再摆「横屏全屏」就是骗人
  if (start) start.style.display = standalone ? 'none' : 'inline-block';

  // 浏览器里 + 有安装事件 → 给一个真能用的安装按钮
  if (install) install.style.display = !standalone && installPrompt ? 'inline-block' : 'none';

  // 浏览器里 + iOS（无安装事件）→ 给操作步骤，这是唯一能让锁横屏生效的路
  const ios = isIos();
  if (help) help.style.display = !standalone && ios && !installPrompt ? 'inline-block' : 'none';

  // 「就这么玩」永远在：竖屏本来就能玩，这个按钮只是立即收起建议条
  if (cont) cont.style.display = 'inline-block';

  if (howto) {
    if (standalone) {
      howto.style.display = 'none';
    } else if (ios) {
      howto.style.display = 'block';
      howto.innerHTML =
        '<b>iPhone 在浏览器里无法自动锁横屏</b><br>加到主屏幕后从图标启动就能锁：' +
        '<ol><li>点 Safari 底部的「分享」</li><li>选「添加到主屏幕」</li><li>从桌面图标打开游戏</li></ol>';
    } else {
      howto.style.display = 'none';
    }
  }
}

function onUserStart(): void {
  // 这里必须在用户手势的同一个同步调用栈里发起请求，不能先 await 任何东西
  requestLandscape();
  syncTip();
  syncActions();
}

/** 「就这么玩」：收起建议条；横过来再竖回来时不会又弹（本会话记住） */
function onContinueInPortrait(): void {
  allowPortrait = true;
  syncTip();
}

function bindButtons(): void {
  document.getElementById(START_BTN_ID)?.addEventListener('click', onUserStart);
  document.getElementById(CONTINUE_BTN_ID)?.addEventListener('click', onContinueInPortrait);

  // Chromium 系：拿到安装事件才能用编程方式弹安装框
  document.getElementById(INSTALL_BTN_ID)?.addEventListener('click', () => {
    const p = installPrompt;
    if (!p) return;
    installPrompt = null;
    void p.prompt();
    syncActions();
  });

  // iOS：没有安装 API，点了就只能把步骤展开（或收起）
  document.getElementById(HELP_BTN_ID)?.addEventListener('click', () => {
    const howto = document.getElementById(HOWTO_ID);
    if (!howto) return;
    const open = howto.style.display === 'block';
    howto.style.display = open ? 'none' : 'block';
  });

  // 游戏内入口（晨报的「横屏全屏」按钮）复用同一套逻辑
  window.__valeEnterLandscape = onUserStart;
  window.__valeIsPortrait = isPortrait;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // 别让浏览器自己弹小条，我们要放在遮罩里
    installPrompt = e as unknown as { prompt: () => Promise<void> };
    syncActions();
  });
  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    syncActions();
  });
}

function watch(): void {
  let raf = 0;
  const refresh = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => { syncTip(); syncActions(); });
  };
  window.addEventListener('resize', refresh);
  window.addEventListener('orientationchange', refresh);
  // 视觉视口变化（地址栏收起、软键盘）单独监听，比 resize 更及时
  if (window.visualViewport) window.visualViewport.addEventListener('resize', refresh);
  document.addEventListener('fullscreenchange', refresh);
  syncTip();
  syncActions();
}

declare global {
  interface Window {
    /** 供 Phaser 场景在用户手势里调用（晨报「横屏全屏」按钮） */
    __valeEnterLandscape?: () => void;
    __valeIsPortrait?: () => boolean;
  }
}

/** 在 DOM 就绪后调用：绑定按钮 + 开始监听方向变化 */
export function initOrientation(): void {
  bindButtons();
  watch();
}
