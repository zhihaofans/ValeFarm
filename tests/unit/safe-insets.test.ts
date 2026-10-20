// iOS PWA 独立模式的安全区兜底。
//
// 背景（0.4.2 用户实拍图二）：iOS 的独立窗口里 env(safe-area-inset-*) 常返回 0，
// 而 black-translucent 又让内容铺到状态栏下面 → HUD 钻进状态栏、底部按钮压在 Home 条上。
// 这段兜底完全是「环境判断 + 补值」，一旦判断错就静默失效，所以逐条钉住。
import { afterEach, describe, expect, it, vi } from 'vitest';

/** 造一套最小的 window / navigator 桩，只覆盖 currentSafeInsets 关心的部分 */
function stubEnv(opts: {
  env: { top: number; right: number; bottom: number; left: number };
  ua: string;
  standalone?: boolean;
  displayModeStandalone?: boolean;
  maxTouchPoints?: number;
  viewH?: number;
  viewW?: number;
  statusBarStyle?: 'black' | 'default' | 'black-translucent';
}) {
  const win = {
    innerHeight: opts.viewH ?? 852,
    innerWidth: opts.viewW ?? 393,
    matchMedia: (q: string) => ({
      matches: q === '(display-mode: standalone)' ? !!opts.displayModeStandalone : false,
    }),
  };
  const nav = { userAgent: opts.ua, standalone: opts.standalone, maxTouchPoints: opts.maxTouchPoints ?? 5 };
  const styleStub = {
    cssText: '',
  };
  const cs = {
    paddingTop: `${opts.env.top}px`,
    paddingRight: `${opts.env.right}px`,
    paddingBottom: `${opts.env.bottom}px`,
    paddingLeft: `${opts.env.left}px`,
  };
  const fakeEl = {
    style: styleStub,
    remove() {},
  };
  vi.stubGlobal('window', win);
  vi.stubGlobal('navigator', nav);
  vi.stubGlobal('document', {
    createElement: () => fakeEl,
    body: { appendChild() {} },
    querySelector: (sel: string) => opts.statusBarStyle && sel.includes('status-bar')
      ? { getAttribute: () => opts.statusBarStyle }
      : null,
  });
  vi.stubGlobal('getComputedStyle', () => cs);
}

const UA_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 '
  + '(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const UA_IPAD_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 '
  + '(KHTML, like Gecko) Version/17.0 Safari/605.1.15';
const UA_ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
const UA_DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('currentSafeInsets：iOS PWA 兜底', () => {
  it('iOS 独立窗口 + env() 全 0 → 补上状态栏与 Home 条', async () => {
    stubEnv({ env: { top: 0, right: 0, bottom: 0, left: 0 }, ua: UA_IPHONE, standalone: true });
    const { currentSafeInsets } = await import('../../src/layout');
    const s = currentSafeInsets(852);
    expect(s.top).toBe(59);
    expect(s.bottom).toBe(34);
  });

  it('iOS 独立窗口横屏 + env() 全 0 → 左右让出灵动岛/圆角，底部只让 21', async () => {
    stubEnv({
      env: { top: 0, right: 0, bottom: 0, left: 0 }, ua: UA_IPHONE,
      standalone: true, viewW: 852, viewH: 393,
    });
    const { currentSafeInsets } = await import('../../src/layout');
    expect(currentSafeInsets(393)).toEqual({ top: 0, right: 59, bottom: 21, left: 59 });
  });

  it('navigator.standalone 缺失但 display-mode:standalone 命中时同样兜底', async () => {
    stubEnv({
      env: { top: 0, right: 0, bottom: 0, left: 0 }, ua: UA_IPHONE,
      standalone: false, displayModeStandalone: true,
    });
    const { currentSafeInsets } = await import('../../src/layout');
    expect(currentSafeInsets(852).top).toBe(59);
  });

  it('iPadOS 伪装成 Mac（maxTouchPoints > 1）也算 iOS', async () => {
    stubEnv({
      env: { top: 0, right: 0, bottom: 0, left: 0 }, ua: UA_IPAD_MAC,
      standalone: true, maxTouchPoints: 5,
    });
    const { currentSafeInsets } = await import('../../src/layout');
    expect(currentSafeInsets(1024).top).toBe(59);
  });

  it('env() 有值就以 env() 为准，不再叠经验值（否则会多让一截）', async () => {
    stubEnv({
      env: { top: 47, right: 0, bottom: 34, left: 0 }, ua: UA_IPHONE, standalone: true,
    });
    const { currentSafeInsets } = await import('../../src/layout');
    const s = currentSafeInsets(852);
    expect(s.top).toBe(47);
    expect(s.bottom).toBe(34);
  });

  it('black 不透明状态栏：env 有 top 时保留，不强行归零（避免状态栏样式尚未生效时反而钻到状态栏下）', async () => {
    stubEnv({
      env: { top: 59, right: 0, bottom: 34, left: 0 }, ua: UA_IPHONE, standalone: true,
      statusBarStyle: 'black',
    });
    const { currentSafeInsets } = await import('../../src/layout');
    const s = currentSafeInsets(793);
    expect(s.top).toBe(59);
    expect(s.bottom).toBe(34);
  });

  it('black 且 env() 全 0：兜底也不补 top', async () => {
    stubEnv({
      env: { top: 0, right: 0, bottom: 0, left: 0 }, ua: UA_IPHONE, standalone: true,
      statusBarStyle: 'black',
    });
    const { currentSafeInsets } = await import('../../src/layout');
    const s = currentSafeInsets(793);
    expect(s.top).toBe(0);
    expect(s.bottom).toBe(34);
  });

  it('浏览器标签页（非独立窗口）env() 为 0 时不补 —— 有地址栏时不需要', async () => {
    stubEnv({ env: { top: 0, right: 0, bottom: 0, left: 0 }, ua: UA_IPHONE, standalone: false });
    const { currentSafeInsets } = await import('../../src/layout');
    const s = currentSafeInsets(852);
    expect(s.top).toBe(0);
    expect(s.bottom).toBe(0);
  });

  // 桌面 Mac 没有触摸屏 → maxTouchPoints 恒为 0，正是它与 iPadOS 伪装 Mac 的分界点。
  // 测试桩默认给 5（模拟手机），这里必须显式传 0，否则会被当成 iPad。
  it('Android / 桌面即使独立窗口也不吃 iOS 的经验值', async () => {
    for (const ua of [UA_ANDROID, UA_DESKTOP]) {
      stubEnv({ env: { top: 0, right: 0, bottom: 0, left: 0 }, ua, standalone: true, maxTouchPoints: 0 });
      const { currentSafeInsets } = await import('../../src/layout');
      const s = currentSafeInsets(852);
      expect(s.top, ua).toBe(0);
    }
  });

  it('测试注入优先于一切（e2e 靠它模拟真机）', async () => {
    stubEnv({ env: { top: 0, right: 0, bottom: 0, left: 0 }, ua: UA_IPHONE, standalone: true });
    (globalThis as unknown as { window: { __valeSafeInsets?: unknown } }).window.__valeSafeInsets
      = { top: 12, right: 0, bottom: 8, left: 0 };
    const { currentSafeInsets } = await import('../../src/layout');
    const s = currentSafeInsets(852);
    expect(s.top).toBe(12);
    expect(s.bottom).toBe(8);
  });

  it('兜底值同样受上限约束（半屏时不会把 UI 挤没）', async () => {
    stubEnv({
      env: { top: 0, right: 0, bottom: 0, left: 0 }, ua: UA_IPHONE, standalone: true, viewH: 300,
    });
    const { currentSafeInsets } = await import('../../src/layout');
    const s = currentSafeInsets(300);
    // cap = min(80, 300*0.16) = 48
    expect(s.top).toBeLessThanOrEqual(48);
    expect(s.bottom).toBeLessThanOrEqual(48);
  });
});
