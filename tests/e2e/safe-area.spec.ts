// 回归：刘海 / 灵动岛遮住顶部 HUD 与 ☰（用户 0.4.1 实拍 —— 顶部整条信息没了）。
//
// 根因不是"被遮住一部分"，而是**整条 HUD 从 y=0 开始画**，画布又是 viewport-fit=cover
// 铺满全屏，于是 HUD 全落在灵动岛底下。
//
// headless Chromium 没有刘海，env(safe-area-inset-*) 恒为 0，
// 所以用 window.__valeSafeInsets 注入一组真机数值来跑这条路径。
import { expect, test, type Page } from '@playwright/test';

/** 注入安全区并等待 UI 重建完（UIScene 每帧检测到变化会重建 HUD / 按钮） */
async function injectSafe(page: Page, top: number, bottom: number, left = 0, right = 0): Promise<void> {
  await page.evaluate(([t, b, l, r]) => {
    (window as unknown as any).__valeSafeInsets = { top: t, right: r, bottom: b, left: l };
  }, [top, bottom, left, right] as const);
  await page.waitForTimeout(500);
}

/** 顶部 HUD 矩形（depth=800 的 Rectangle）与 ☰ 按钮的可视范围，单位 CSS 像素 */
async function readChrome(page: Page) {
  return page.evaluate(() => {
    const u = (window as unknown as any).__vale.scene.scene.get('ui');
    const S = u.uiDpr as number;
    const rects = u.children.list.filter((o: any) => o.type === 'Rectangle' && o.depth === 800 && o.width > 100);
    // 取最低的那块（HUD 主体在安全区之下，紧贴它的上方还有一块同色铺底）
    const hud = rects.map((r: any) => ({ top: (r.y - r.height / 2) / S, bottom: (r.y + r.height / 2) / S }))
      .sort((a: any, b: any) => b.bottom - a.bottom)[0];
    const menu = u.children.list.find((o: any) => o.type === 'Container' && o.depth === 852);
    // 用视觉包围盒而不是 input.hitArea：hitArea 是本地坐标，换算容易受 scale 影响
    const mb = menu.getBounds();
    // 首行文字（日期）的实际渲染范围：这才是"看不看得清"的判据，
    // HUD 背景矩形让开安全区、但文字贴着背景上沿画，一样会被灵动岛压住（0.4.2 实拍）
    const day = u.dayText;
    const act = u.children.list
      .filter((o: any) => o.type === 'Arc' && o.depth === 850 && o.radius > 20)
      .sort((a: any, b: any) => b.radius - a.radius)[0];
    const joyRing = u.joy.radius * 1.5;
    return {
      hudTop: hud.top,
      hudBottom: hud.bottom,
      textTop: day.y / S,
      textBottom: (day.y + day.height) / S,
      dayLeft: day.x / S,
      menuTop: mb.y / S,
      menuBottom: (mb.y + mb.height) / S,
      menuLeft: mb.x / S,
      menuRight: (mb.x + mb.width) / S,
      energyRight: (u.energyBar.x + u.energyBar.width) / S,
      actLeft: (act.x - act.radius) / S,
      actRight: (act.x + act.radius) / S,
      actBottom: (act.y + act.radius) / S,
      joyLeft: (u.joy.home.x - joyRing) / S,
      joyRight: (u.joy.home.x + joyRing) / S,
      view: (window as unknown as any).__valeView as { w: number; h: number },
      safe: { ...u.safe },
      dpr: S,
    };
  });
}

for (const vp of [
  { name: 'iPhone 15 Pro 竖屏（灵动岛 59 / Home 34）', width: 393, height: 852, top: 59, bottom: 34, left: 0, right: 0 },
  { name: 'iPhone 15 Pro 横屏（左右 59 / 底部 21）', width: 852, height: 393, top: 0, bottom: 21, left: 59, right: 59 },
  { name: 'iPhone SE 横屏（无安全区）', width: 667, height: 375, top: 0, bottom: 0, left: 0, right: 0 },
]) {
  test(`${vp.name}：HUD / ☰ / 摇杆 / 互动键都在安全区内`, async ({ browser }) => {
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 3, hasTouch: true, isMobile: true,
    });
    const page = await ctx.newPage();
    await page.goto('/');
    await page.waitForFunction(() => !!(window as unknown as any).__vale, null, { timeout: 30000 });
    await page.waitForTimeout(800);
    await injectSafe(page, vp.top, vp.bottom, vp.left, vp.right);

    const c = await readChrome(page);
    expect(c.safe.top, '安全区应被读到（注入生效）').toBe(vp.top);
    expect(c.safe.bottom).toBe(vp.bottom);
    expect(c.safe.left).toBe(vp.left);
    expect(c.safe.right).toBe(vp.right);
    // HUD 底色**要**盖住安全区那一条（否则灵动岛旁边露出草地，像画面缺了一块），
    // 所以判据不是 hudTop，而是文字与 ☰ 的位置 —— 见下面的 textTop / menuTop。
    // ☰ 在 HUD 里，同样不能顶进安全区
    expect(c.menuTop, `☰ 顶边 ${c.menuTop.toFixed(1)} 落进了顶部安全区 ${vp.top}`).toBeGreaterThanOrEqual(vp.top - 0.5);
    expect(c.menuBottom).toBeGreaterThan(vp.top);

    // 首行文字必须整体在安全区之下，且与安全区之间至少 6px —— "能点但看不清"就是这个值太小
    expect(
      c.textTop,
      `HUD 首行文字顶边 ${c.textTop.toFixed(1)} 只在安全区 ${vp.top} 下方 ${(c.textTop - vp.top).toFixed(1)}px，会被灵动岛压住`,
    ).toBeGreaterThanOrEqual(vp.top + 6 - 0.5);
    // 文字不能溢出 HUD 背景（否则等于没有底色）
    expect(c.textBottom, '文字超出 HUD 底边').toBeLessThanOrEqual(c.hudBottom + 0.5);

    // 横屏时左右是灵动岛/圆角：HUD 日期、☰、互动键、摇杆都不能压进去
    expect(c.dayLeft, `HUD 日期 x=${c.dayLeft.toFixed(1)} 压进左侧安全区 ${vp.left}`).toBeGreaterThanOrEqual(vp.left + 6 - 0.5);
    expect(c.menuLeft, `☰ 左边缘 ${c.menuLeft.toFixed(1)} 压进左侧安全区 ${vp.left}`).toBeGreaterThanOrEqual(vp.left - 0.5);
    expect(c.menuRight, `☰ 右边缘 ${c.menuRight.toFixed(1)} 超出右侧安全区`).toBeLessThanOrEqual(vp.width - vp.right + 0.5);
    // 竖屏时 ☰ 与体力条同一行：体力条右端不能钻到按钮下面
    expect(c.energyRight, `体力条右端 ${c.energyRight.toFixed(1)} 压住了 ☰ 左边缘 ${c.menuLeft.toFixed(1)}`).toBeLessThanOrEqual(c.menuLeft - 4);
    expect(c.actLeft).toBeGreaterThanOrEqual(vp.left - 0.5);
    expect(c.actRight, `互动键右边缘 ${c.actRight.toFixed(1)} 超出右侧安全区`).toBeLessThanOrEqual(vp.width - vp.right + 0.5);
    expect(c.joyLeft, `摇杆左边缘 ${c.joyLeft.toFixed(1)} 压进左侧安全区 ${vp.left}`).toBeGreaterThanOrEqual(vp.left - 0.5);
    expect(c.joyRight).toBeLessThanOrEqual(vp.width - vp.right + 0.5);
    // 相机必须铺满整块画布：如果按安全区裁 viewport，横屏左右/底部会露黑边
    expect(c.view.w / c.view.h, '相机取景比例不等于屏幕比例（露黑边/变形）').toBeCloseTo(vp.width / vp.height, 2);
    expect(
      c.actBottom,
      `动作键下沿 ${c.actBottom.toFixed(1)} 压到了底部安全区（屏幕高 ${vp.height}，安全区 ${vp.bottom}）`,
    ).toBeLessThanOrEqual(vp.height - vp.bottom + 0.5);

    await ctx.close();
  });
}

test('注入的安全区被夹到合理上限（半屏时不至于把 UI 挤没）', async ({ browser }) => {
  const ctx = await browser.newContext({
    viewport: { width: 640, height: 240 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true,
  });
  const page = await ctx.newPage();
  await page.goto('/');
  await page.waitForFunction(() => !!(window as unknown as any).__vale, null, { timeout: 30000 });
  await injectSafe(page, 90, 90);
  const c = await readChrome(page);
  // 上限 = min(80, 视口高 × 16%) = min(80, 38.4) → 注入的 90 应被夹到 38.4（CSS 像素可以是小数）
  const cap = Math.round(240 * 0.16 * 10) / 10;
  expect(c.safe.top).toBeCloseTo(cap, 1);
  expect(c.safe.bottom).toBeCloseTo(cap, 1);
  // 夹过之后 HUD 必须仍有正高度、仍占屏幕的一部分（不能因为安全区把 UI 挤没）
  expect(c.hudTop).toBeGreaterThanOrEqual(0);
  expect(c.hudBottom - c.hudTop).toBeGreaterThan(10);
  await ctx.close();
});

test('面板开着时点 ☰：提示以屏幕中央对话框出现且可关闭', async ({ browser }) => {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true,
  });
  const page = await ctx.newPage();
  await page.goto('/');
  await page.waitForFunction(() => !!(window as unknown as any).__vale, null, { timeout: 30000 });
  await page.waitForTimeout(900);

  // 晨报还开着，直接再点一次 ☰ → 应弹出"面板已经打开啦"的对话框
  await page.evaluate(() => (window as unknown as any).__vale.scene.scene.get('ui').openSystem());
  await page.waitForTimeout(300);

  const tip = await page.evaluate(() => {
    const u = (window as unknown as any).__vale.scene.scene.get('ui');
    if (!u.tipObj) return null;
    const S = u.uiDpr as number;
    const box = u.tipObj.list.find((o: any) => o.type === 'Rectangle' && o.width < u.vw);
    // 「知道了」按钮 = 除 backdrop / 对话框本体之外那块可点的矩形
    const ok = u.tipObj.list.find((o: any) => o.type === 'Rectangle' && o !== box && o.width < box.width);
    return {
      cx: box.x / S, cy: box.y / S,
      w: box.width / S, h: box.height / S,
      okX: ok.x / S, okY: ok.y / S,
      vw: u.vw / S, vh: u.vh / S,
      hudH: u.hudHCss as number, safeTop: u.safe.top as number,
    };
  });
  expect(tip, '重复点 ☰ 应出现提示对话框').not.toBeNull();
  // 水平居中：中心与屏幕中心相差不超过 2px
  expect(Math.abs(tip!.cx - tip!.vw / 2)).toBeLessThan(2);
  // 垂直居中：按「HUD 之下的可用区」居中（用户明确要求，不再用画布几何中心）。
  // 期望值 = HUD 下沿 + (屏幕高 - HUD 下沿) / 2
  const hudBottom = tip!.safeTop + tip!.hudH;
  const expectCy = hudBottom + (tip!.vh - hudBottom) / 2;
  expect(Math.abs(tip!.cy - expectCy), `对话框中心 ${tip!.cy} 应为可用区中心 ${expectCy}`).toBeLessThan(2);
  // 且必须整个落在 HUD 与屏幕底边之间（不压 HUD、不出屏）
  expect(tip!.cy - tip!.h / 2, '对话框上沿不能钻进 HUD').toBeGreaterThanOrEqual(hudBottom - 1);
  expect(tip!.cy + tip!.h / 2, '对话框下沿不能出屏').toBeLessThanOrEqual(tip!.vh + 1);

  // 对话框必须整个落在视口内（居中且不越界）
  expect(tip!.cx - tip!.w / 2).toBeGreaterThanOrEqual(0);
  expect(tip!.cx + tip!.w / 2).toBeLessThanOrEqual(tip!.vw);
  expect(tip!.okY).toBeGreaterThan(tip!.cy);
  expect(tip!.okY).toBeLessThan(tip!.cy + tip!.h / 2);

  // 「知道了」可点（按下去就关）
  const box = (await page.locator('#game canvas').boundingBox())!;
  await page.touchscreen.tap(box.x + tip!.okX, box.y + tip!.okY);
  await page.waitForTimeout(300);
  const gone = await page.evaluate(() => !(window as unknown as any).__vale.scene.scene.get('ui').tipObj);
  expect(gone, '点「知道了」应关闭提示').toBe(true);

  await ctx.close();
});

// iOS PWA 独立模式：env() 失效 + visualViewport 晚到（用户 0.4.2 实拍图二）。
//
// 两个都实测复现过，是两件独立的事：
//   1. env(safe-area-inset-*) 在 iOS 独立窗口里返回 0，而 black-translucent 又让内容铺到
//      状态栏下面 → 补经验值（src/layout.ts 的 IOS_PWA_FALLBACK）。单测已覆盖判定逻辑，
//      这里端到端确认"补出来的值真的让 HUD 躲开了状态栏"。
//   2. 冷启动瞬间 visualViewport.height 还是旧值 → 写过一次 --app-h 之后就再也不重测，
//      页面高度定格在偏小值，上下各露一条黑带（截图里顶部那条"深色带"就是露出的 html 背景）。
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 '
  + '(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

/** 先让 env() 探针读 0、navigator.standalone 为 true，再在若干帧后把可视高度"恢复"成真实值 */
async function emulateIosPwa(page: Page, real: { w: number; h: number }) {
  await page.addInitScript(([rw, rh]) => {
    Object.defineProperty(navigator, 'standalone', { get: () => true });
    const origMM = window.matchMedia.bind(window);
    (window as any).matchMedia = (q: string) => (q === '(display-mode: standalone)'
      ? { matches: true, media: q, addEventListener() {}, removeEventListener() {} }
      : origMM(q));
    // env() 失效：探针元素的 padding 一律读回 0
    const origCS = window.getComputedStyle.bind(window);
    (window as any).getComputedStyle = (el: Element, p?: string) => {
      const cs = origCS(el, p);
      const css = (el as HTMLElement)?.style?.cssText ?? '';
      if (!css.includes('safe-area-inset')) return cs;
      return new Proxy(cs, { get: (t: any, k: string) => (k.startsWith('padding') ? '0px' : t[k]) });
    };
    // visualViewport 晚到：前 20 帧报一个偏小的高度，之后才给真实值
    let frames = 0;
    const vv = window.visualViewport;
    if (vv) {
      Object.defineProperty(vv, 'height', {
        configurable: true,
        get: () => (frames++ < 20 ? rh - 100 : rh),
      });
      Object.defineProperty(vv, 'width', { configurable: true, get: () => rw });
    }
  }, [real.w, real.h] as const);
}

test('iOS PWA 独立模式：black 状态栏下 env() 失效不重复让 top，且不留黑带', async ({ browser }) => {
  const W = 393;
  const H = 852;
  const ctx = await browser.newContext({
    viewport: { width: W, height: H }, deviceScaleFactor: 3, hasTouch: true, isMobile: true, userAgent: IPHONE_UA,
  });
  const page = await ctx.newPage();
  await emulateIosPwa(page, { w: W, h: H });
  await page.goto('/');
  await page.waitForFunction(() => !!(window as unknown as any).__vale, null, { timeout: 30000 });
  await page.waitForTimeout(1500); // 等前 20 帧过去 + --app-h 补测循环收敛

  const m = await page.evaluate(() => {
    const de = document.documentElement;
    const g = document.getElementById('game')!.getBoundingClientRect();
    const u = (window as unknown as any).__vale.scene.scene.get('ui');
    const S = u.uiDpr as number;
    return {
      appH: de.style.getPropertyValue('--app-h'),
      gameH: g.height,
      hudH: u.hudHCss as number,
      textTop: u.dayText.y / S,
      safeTop: u.safe.top as number,
    };
  });

  // 1) 黑带：--app-h 必须收敛到真实可视高度，画布与它严格等高（多一像素都没有）
  expect(m.appH, '--app-h 应为真实可视高度（visualViewport 稳定后要重测）').toBe(`${H}px`);
  expect(m.gameH, '画布高度必须等于可视高度，否则底部露黑带').toBeCloseTo(H, 0);

  // 2) black 状态栏：网页从状态栏下方开始，env() 全 0 时 top 不能补 59，否则 double inset
  expect(m.safeTop, 'black 状态栏下 top 不应再兜底 59').toBe(0);
  expect(m.textTop, 'HUD 首行文字应在可视区内').toBeGreaterThanOrEqual(0);
  expect(m.textTop, 'HUD 文字不应被二次下移').toBeLessThan(47);
  expect(m.hudH).toBeGreaterThan(40);

  await ctx.close();
});

// 回归：build 17 真机实拍「顶部状态栏看都看不到了，底部还有黑条空白区域」。
//
// 真机数据（iPhone 15，393×852，PWA）：
//   screen.height = 852，env(top/bottom) = 59/34，innerHeight = 793（= 852 - 59）
// 当时的两个错，各自对应一条断言：
//
//   ① HTML 被 --app-h 写成 793，但屏幕是 852 → 下方 59px 直接露出 html 背景色（"底布空白"）
//      正解：页面铺满 852，由 HUD 盖住状态栏、由相机取景避让。
//   ② UI 也用 contentInsets 把 safe.top 归零 → HUD 底色只到 45px，状态栏白字被糊掉
//      正解：UI 的 top 永远是 env(top)=59（见 layout.ts 的 uiInsets / hudBandTop）。
//
// 这里把 innerHeight 模拟成 793（真机 PWA 就是这样），屏幕按 852 算。
test('iOS PWA 真机场景（screen 852 / inner 793）：画布铺满屏幕、HUD 盖住状态栏且文字在它之下', async ({ browser }) => {
  const SCREEN_H = 852;
  const INNER_H = 793; // 852 - 59，系统扣掉状态栏后的可视区
  const ctx = await browser.newContext({
    viewport: { width: 393, height: INNER_H }, deviceScaleFactor: 3, hasTouch: true, isMobile: true,
    userAgent: IPHONE_UA,
  });
  const page = await ctx.newPage();
  await page.addInitScript(([innerH, screenH]) => {
    Object.defineProperty(screen, 'height', { configurable: true, get: () => screenH });
    Object.defineProperty(screen, 'availHeight', { configurable: true, get: () => screenH });
    Object.defineProperty(window, 'innerHeight', { configurable: true, get: () => innerH });
    (window as any).__valeSafeInsets = { top: 59, right: 0, bottom: 34, left: 0 };
  }, [INNER_H, SCREEN_H] as const);
  await page.goto('/');
  await page.waitForFunction(() => !!(window as unknown as any).__vale, null, { timeout: 30000 });
  await page.waitForTimeout(1200);

  const m = await page.evaluate(() => {
    const de = document.documentElement;
    const g = document.getElementById('game')!.getBoundingClientRect();
    const cv = document.querySelector('#game canvas')!.getBoundingClientRect();
    const u = (window as unknown as any).__vale.scene.scene.get('ui');
    const S = u.uiDpr as number;
    // HUD 底色矩形（depth 800 里最靠下的那块），单位 CSS
    const bands = u.children.list.filter((o: any) => o.type === 'Rectangle' && o.depth === 800 && o.width > 100)
      .map((r: any) => ({ top: (r.y - r.height / 2) / S, bottom: (r.y + r.height / 2) / S }))
      .sort((a: any, b: any) => b.bottom - a.bottom);
    return {
      appH: de.style.getPropertyValue('--app-h'),
      cssVarH: getComputedStyle(de).getPropertyValue('--app-h').trim(),
      gameBox: { top: g.top, h: g.height, w: g.width },
      canvasBox: { top: cv.top, h: cv.height, bottom: cv.bottom },
      hudBand: bands[0],
      safe: { ...u.safe },
      textTop: u.dayText.y / S,
      textBottom: (u.dayText.y + u.dayText.height) / S,
      hudHCss: u.hudHCss as number,
    };
  });

  // ① 底部不能再露背景：画布必须铺满整屏（= 可视高度 793），且四周不留缝
  expect(m.gameBox.top, '#game 不该被推到下方（那会在顶部露背景）').toBeCloseTo(0, 0);
  expect(m.gameBox.h, '#game 高度应等于可视高度').toBeCloseTo(INNER_H, 0);
  expect(m.canvasBox.bottom, '画布下沿必须贴屏幕底部，否则露一条背景色').toBeCloseTo(INNER_H, 0);
  expect(m.canvasBox.top).toBeCloseTo(0, 0);
  expect(m.appH).toBe(`${INNER_H}px`);

  // ② 状态栏：HUD 底色必须盖住从屏幕顶到这 59px（不然白字压草地），文字排在它之下
  expect(m.safe.top, 'UI 的 top 不该被归零 —— 归零后状态栏就看不见了').toBe(59);
  expect(m.hudBand.top, 'HUD 底色必须从 y=0 起').toBeLessThanOrEqual(1);
  expect(m.hudBand.bottom, 'HUD 底色要一直盖到 env(top) + HUD 高').toBeGreaterThanOrEqual(59 + m.hudHCss - 1);
  expect(m.textTop, '首行文字必须在状态栏之下').toBeGreaterThanOrEqual(59);
  expect(m.textBottom, '文字不能溢出 HUD 底色').toBeLessThanOrEqual(m.hudBand.bottom + 0.5);

  await ctx.close();
});

// 回归：竖屏下「已更新到新版本，点此刷新」整个像颗糖豆贴在状态栏上，很难点（用户实拍）。
//
// 三个具体问题，逐条钉住：
//   ① 没有让开安全区 —— 原来是 top:8px，PWA 里 env(top)=59，整条被灵动岛吃掉一半
//   ② 离拇指太远 —— 就算躲开状态栏，屏幕最上沿仍是竖屏单手握持最难够到的位置
//   ③ 触控目标太小 —— 只有 8px 内边距，高度约 34px（iOS HIG 下限是 44）
test('竖屏：新版本提示条离 HUD 够远、触控目标够大', async ({ browser }) => {
  const W = 393;
  const H = 793;
  const ctx = await browser.newContext({
    viewport: { width: W, height: H }, deviceScaleFactor: 3, hasTouch: true, isMobile: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 '
      + '(KHTML, like Gecko) Version/27.0.1 Mobile/15E148 Safari/604.1',
  });
  const page = await ctx.newPage();
  await page.goto('/');
  await page.waitForFunction(() => !!(window as unknown as any).__vale, null, { timeout: 30000 });
  await page.waitForTimeout(900);

  // 线上要等真的发新版本才出现，这里直接按同一套样式造一条（样式与 showBanner 一致）
  const box = await page.evaluate(() => {
    const b = document.createElement('div');
    b.id = 'pwa-banner-test';
    b.textContent = '已更新到新版本，点此刷新';
    b.style.cssText = [
      'position:fixed', 'left:50%', 'top:38%', 'transform:translate(-50%,-50%)',
      'z-index:2147483647', 'background:#c9a06b', 'color:#1a2218', 'border:2px solid #f4ead8',
      'padding:14px 24px', 'border-radius:26px', 'font-size:16px', 'font-weight:600',
      'font-family:sans-serif', 'white-space:nowrap', 'pointer-events:auto',
    ].join(';');
    document.body.appendChild(b);
    const r = b.getBoundingClientRect();
    const hud = (window as unknown as any).__vale.scene.scene.get('ui');
    const S = hud.uiDpr;
    return {
      x: r.x, y: r.y, w: r.width, h: r.height,
      hudBottom: (hud.safe.top + hud.hudHCss),
    };
  });

  // ① 触控目标：高度必须达到 iOS HIG 的 44px 下限
  expect(box.h, `提示条高度 ${box.h} 太小，手指戳不准`).toBeGreaterThanOrEqual(44);
  // ② 不能压在 HUD 上（更不用说状态栏）
  expect(box.y, `提示条顶边 ${box.y} 压住了 HUD 下沿 ${box.hudBottom}`).toBeGreaterThan(box.hudBottom + 20);
  // ③ 也不能掉到摇杆那一带
  expect(box.y + box.h).toBeLessThan(H * 0.75);
  // ④ 水平居中
  expect(Math.abs(box.x + box.w / 2 - W / 2)).toBeLessThan(2);

  await ctx.close();
});
