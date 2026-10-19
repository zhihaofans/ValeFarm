// 「视口顶部是否已经让开」的判定（viewportTopAlreadyInset / contentInsets）。
//
// 这组用例对应 build 15 的真机实测数据，之前判断错了两次，值得逐条钉住：
//
//   iPhone 393×852，PWA 独立窗口
//   screen.height = 852，env(top/bottom) = 59/34，innerHeight = 793
//   852 - 59      = 793 ✅  → 顶部让开了
//   852 - 59 - 34 = 759 ❌  → 底部**没有**让
//
// 这套判据现在不再用于相机（相机铺满整块画布）；保留 contentInsets 作 uiInsets 的辅助/历史判据。
//   - UI 覆盖层（uiInsets）：那 59px 仍要被 HUD 底色盖住，top 永远不让出
//   - 底部始终要按 34 让（Home 条那块还在可视区内）
//
// 反面（必须照旧让 top）：画布铺满全屏、状态栏压在内容上的机型。
import { describe, expect, it } from 'vitest';
import { contentInsets, hudBandTop, uiInsets, viewportTopAlreadyInset } from '../../src/layout';

/** iPhone 15/16 竖屏实测值 */
const IPHONE = { screenH: 852, env: { top: 59, right: 0, bottom: 34, left: 0 } };

describe('viewportTopAlreadyInset', () => {
  it('iOS PWA 实测：innerHeight 793 + env.top 59 = 852 → 顶部已让开', () => {
    expect(viewportTopAlreadyInset(793, IPHONE.env, IPHONE.screenH)).toBe(true);
  });

  it('可视区铺满全屏（画布高 = 屏幕高）→ 顶部没让开，必须继续让', () => {
    // 这种机型上 innerHeight 就是 852，那 59 是盖在画布上的，HUD 得躲
    expect(viewportTopAlreadyInset(852, IPHONE.env, 852)).toBe(false);
  });

  it('底部没让不影响判断：只看 top，793 依然算已让开', () => {
    // 这是上一版的坑：把 bottom 也加进去（793+59+34 ≠ 852）就判成"没让"，
    // 于是顶部被让两遍 → 深色带。
    expect(viewportTopAlreadyInset(793, { top: 59, right: 0, bottom: 34, left: 0 }, 852)).toBe(true);
  });

  it('横屏：env.top = 0（刘海在侧边）→ 谈不上让没让，按没让处理', () => {
    expect(viewportTopAlreadyInset(393, { top: 0, right: 44, bottom: 21, left: 44 }, 393)).toBe(false);
  });

  it('无刘海设备（env 全 0）→ 一律按没让', () => {
    expect(viewportTopAlreadyInset(800, { top: 0, right: 0, bottom: 0, left: 0 }, 800)).toBe(false);
  });

  it('桌面把窗口缩到半屏：env 为 0，画布 400 < 屏幕 1080 → 没让开', () => {
    expect(viewportTopAlreadyInset(400, { top: 0, right: 0, bottom: 0, left: 0 }, 1080)).toBe(false);
  });

  it('尺寸缺失时不抛错，返回 false（宁可按原逻辑让）', () => {
    expect(viewportTopAlreadyInset(0, IPHONE.env, IPHONE.screenH)).toBe(false);
    expect(viewportTopAlreadyInset(793, IPHONE.env, 0)).toBe(false);
  });

  it('8px 容差：iOS 的 screen 与 innerHeight 常有几像素偏差', () => {
    // 852 - 59 = 793
    expect(viewportTopAlreadyInset(789, IPHONE.env, 852)).toBe(true);   // -4
    expect(viewportTopAlreadyInset(798, IPHONE.env, 852)).toBe(true);   // +5
    expect(viewportTopAlreadyInset(775, IPHONE.env, 852)).toBe(false);  // -18，差得太多
  });
});

describe('contentInsets', () => {
  it('顶部已让开 → top 归 0，bottom 仍按 env 让（Home 条还在可视区里）', () => {
    expect(contentInsets(IPHONE.env, 793, IPHONE.screenH)).toEqual({ top: 0, right: 0, bottom: 34, left: 0 });
  });

  it('顶部没让开 → 原样返回 env（旧行为不变）', () => {
    expect(contentInsets(IPHONE.env, 852, IPHONE.screenH)).toEqual(IPHONE.env);
  });

  it('返回的是新对象，别改到调用方传进来的那份', () => {
    const raw = { ...IPHONE.env };
    const out = contentInsets(raw, 793, IPHONE.screenH);
    out.bottom = 999;
    expect(raw.bottom).toBe(34);
  });
});

// build 17 真机："顶部状态栏看都看不到了"。
// 根因：UI 也用了 contentInsets，把 top 归零 → HUD 底色只盖住屏幕 0~45px，
// 状态栏那排白字正好落在里面被糊掉。UI 与相机必须分开算：
//   相机 = 铺满整块画布，不裁 viewport
//   UI   = 盖在屏幕上的东西       → 那 59px 仍要盖住，top 永远不让出（uiInsets）
describe('uiInsets / hudBandTop（UI 专用口径）', () => {
  it('iOS PWA 实测：即使用户觉得视口已让开，UI 的 top 仍是 59 —— 状态栏要盖住', () => {
    const ui = uiInsets(IPHONE.env, 793, IPHONE.screenH);
    expect(ui.top).toBe(59);
  });

  it('底部仍按 env 让：视口已让开也不归零', () => {
    // 这里保持 34 是因为 contentInsets 只按 top 判定，bottom 原样
    expect(uiInsets(IPHONE.env, 793, IPHONE.screenH).bottom).toBe(34);
  });

  it('画布铺满全屏的机型：top/bottom 都按 env 让', () => {
    expect(uiInsets(IPHONE.env, 852, IPHONE.screenH)).toEqual(IPHONE.env);
  });

  it('无刘海设备：全 0，HUD 贴顶（不吃掉任何空间）', () => {
    expect(uiInsets({ top: 0, right: 0, bottom: 0, left: 0 }, 800, 800)).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });

  it('hudBandTop 只认 env.top，与视口高度无关', () => {
    expect(hudBandTop(IPHONE.env)).toBe(59);
    expect(hudBandTop({ top: 0, right: 0, bottom: 34, left: 0 })).toBe(0);
    // 负值（个别 WebView 会抖出 -1）当 0 处理，别让 HUD 反着往上跑
    expect(hudBandTop({ top: -3, right: 0, bottom: 0, left: 0 })).toBe(0);
  });
});
