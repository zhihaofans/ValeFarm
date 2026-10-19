// 回归：竖屏提示条。真机上"转屏锁定"没法自动化，这里只压最容易坏的四件事：
//   ① 竖屏时提示条只是**建议卡片**，不能挡住触摸（"竖屏也能玩"是硬要求）
//   ② 点「横屏全屏」要在手势里真的去请求全屏 + 锁横屏（API 是否存在无所谓，调用要发生）
//   ③ 任何一步失败都不能让游戏挂掉、也不能把画布压变形
//   ④ 按能力探测给按钮降级：iOS 浏览器 / 已装 PWA 都不能摆点不动的按钮
import { expect, test } from '@playwright/test';

/** 卡片之外的空白处：从卡片真实底边往下 20px 取一个点，卡片改高也不用改测试 */
async function pointBelowCard(page: import('@playwright/test').Page): Promise<{ x: number; y: number }> {
  const card = (await page.locator('#rotate-card').boundingBox())!;
  return { x: Math.round(card.x + card.width / 2), y: Math.round(card.y + card.height + 20) };
}

test.describe('竖屏（手机竖着拿）', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 });

  test('竖屏照样能玩：提示条只是卡片，卡片外触摸直达画布', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => !!(window as any).__vale, null, { timeout: 30000 });
    await page.waitForTimeout(800);

    await expect(page.locator('#rotate-tip')).toBeVisible();
    await expect(page.locator('#rotate-card')).toBeVisible();
    await expect(page.locator('#rotate-start')).toBeVisible();

    // 提示层本身必须 pointer-events:none —— 这是"竖屏也能玩"的唯一保证
    const pe = await page.evaluate(() => getComputedStyle(document.getElementById('rotate-tip')!).pointerEvents);
    expect(pe, '提示层不能吞掉触摸').toBe('none');

    // 卡片内可点（按钮要能按）
    const cardPe = await page.evaluate(() => getComputedStyle(document.getElementById('rotate-card')!).pointerEvents);
    expect(cardPe).toBe('auto');

    // 卡片外的空白处：命中的必须是画布，不能是提示层
    const gap = await pointBelowCard(page);
    const hit = await page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      if (!el) return 'none';
      if (el.tagName === 'CANVAS') return 'CANVAS';
      return el.closest('#rotate-tip') ? 'tip-blocked' : `out:${el.tagName}`;
    }, gap);
    expect(hit, '卡片外应点得到游戏').toBe('CANVAS');

    // 卡片里点按钮仍要能点（pointer-events:auto 生效）
    const cardHit = await page.evaluate(() => {
      const el = document.elementFromPoint(
        document.getElementById('rotate-card')!.getBoundingClientRect().left + 20,
        document.getElementById('rotate-card')!.getBoundingClientRect().top + 20,
      );
      return !!el?.closest('#rotate-card');
    });
    expect(cardHit, '卡片自身必须能接收点击').toBe(true);

    // 画布必须铺满视口（不留黑边、不溢出滚动）
    const box = (await page.locator('#game canvas').boundingBox())!;
    expect(Math.round(box.width)).toBe(390);
    expect(Math.round(box.height)).toBe(844);
    const overflow = await page.evaluate(() => ({
      sw: document.documentElement.scrollWidth,
      sh: document.documentElement.scrollHeight,
    }));
    expect(overflow.sw).toBeLessThanOrEqual(390);
    expect(overflow.sh).toBeLessThanOrEqual(844);

    // 竖屏下地块仍要方形：可见世界宽高比 == 屏幕宽高比
    const view = await page.evaluate(() => (window as any).__valeView as { w: number; h: number });
    expect(view.w / view.h).toBeCloseTo(390 / 844, 2);
  });

  test('点「横屏全屏」会请求全屏与锁屏，且失败也不影响游戏', async ({ page }) => {
    // 记录调用：真实 API 在 headless 里不一定存在，这里打桩
    await page.addInitScript(() => {
      const w = window as any;
      w.__fsCalls = 0;
      w.__lockCalls = [];
      w.__fsResult = 'reject'; // 先测最差情况
      (HTMLElement.prototype as any).requestFullscreen = function () {
        w.__fsCalls++;
        return w.__fsResult === 'reject' ? Promise.reject(new Error('denied')) : Promise.resolve();
      };
      Object.defineProperty(Screen.prototype, 'orientation', {
        configurable: true,
        get: () => ({
          lock: (o: string) => { w.__lockCalls.push(o); return Promise.resolve(); },
          unlock: () => { w.__lockCalls.push('unlock'); },
        }),
      });
    });

    await page.goto('/');
    await page.waitForFunction(() => !!(window as any).__vale, null, { timeout: 30000 });
    await page.waitForTimeout(800);

    // 直接派发 DOM click，不用 Playwright 的鼠标点击：
    // 那个会先做命中测试并落到真实坐标上，而提示卡正压在晨报面板的「横屏全屏」按钮上
    // （两者中心都接近屏幕中央），一次点击会被画布与 DOM 各收一次 → 计数变 2。
    // 这里要测的是「按钮事件触发几次全屏」，不是坐标命中，所以直接派发最干净。
    await page.locator('#rotate-start').dispatchEvent('click');
    await page.waitForTimeout(400);

    const r = await page.evaluate(() => {
      const w = window as any;
      return { fs: w.__fsCalls, locks: w.__lockCalls, alive: !!w.__vale };
    });
    expect(r.fs, '点按钮应请求一次全屏').toBe(1);
    expect(r.locks, '应请求锁 landscape').toContain('landscape');
    // 全屏被拒、锁屏被拒都不影响游戏：只是提示条继续留着
    expect(r.alive).toBe(true);
    await expect(page.locator('#rotate-tip')).toBeVisible();
  });

  test('点「就这么玩」收起建议条，本会话不再弹', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => !!(window as any).__vale, null, { timeout: 30000 });
    await page.waitForTimeout(600);
    await expect(page.locator('#rotate-tip')).toBeVisible();

    await page.locator('#rotate-continue').tap();
    await page.waitForTimeout(300);
    await expect(page.locator('#rotate-tip')).toBeHidden();

    // 转一圈（竖 → 横 → 竖）也不该再弹
    await page.setViewportSize({ width: 844, height: 390 });
    await page.waitForTimeout(400);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(500);
    await expect(page.locator('#rotate-tip')).toBeHidden();
  });
});

test.describe('横屏（正常游玩）', () => {
  test.use({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 });

  test('不弹提示条；点晨报里的「横屏全屏」后关闭面板并进入游戏', async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as any;
      w.__fsCalls = 0;
      w.__locks = [];
      (HTMLElement.prototype as any).requestFullscreen = function () {
        w.__fsCalls++;
        return Promise.resolve();
      };
      Object.defineProperty(Screen.prototype, 'orientation', {
        configurable: true,
        get: () => ({ lock: (o: string) => { w.__locks.push(o); return Promise.resolve(); }, unlock: () => {} }),
      });
    });

    await page.goto('/');
    await page.waitForFunction(() => !!(window as any).__vale, null, { timeout: 30000 });
    await page.waitForTimeout(800);

    await expect(page.locator('#rotate-tip')).toBeHidden();

    // 晨报面板的主按钮：坐标从运行时布局读，别写死 800×450
    const box = (await page.locator('#game canvas').boundingBox())!;
    const pos = await page.evaluate(() => {
      const ui = (window as any).__vale.scene.scene.get('ui');
      const p = ui.activePanel;
      // 主按钮 = 晨报正文里最宽的那个可点按钮。
      // 不用 hitArea.width === 220 这种魔法值：按钮尺寸按 CSS 写、内部乘过 dpr，
      // 写死数字会在别的 dpr 下失效（0.4.0 踩过）。
      const btns = (p?.body?.list ?? []).filter((o: any) => o.input?.hitArea?.width > 0);
      const btn = btns.sort((a: any, b: any) => b.input.hitArea.width - a.input.hitArea.width)[0];
      if (!btn) return null;
      const m = btn.getWorldTransformMatrix();
      // UI 坐标是画布像素（= CSS × dpr），喂给 page 前要除回来
      return { x: m.tx / ui.uiDpr, y: m.ty / ui.uiDpr };
    });
    expect(pos, '晨报里应有主按钮').not.toBeNull();
    await page.touchscreen.tap(box.x + pos!.x, box.y + pos!.y);
    await page.waitForTimeout(400);

    const st = await page.evaluate(() => {
      const w = window as any;
      const ui = w.__vale.scene.scene.get('ui');
      return { fs: w.__fsCalls, locks: w.__locks, panelOpen: !!ui.panelOpen, paused: w.__vale.scene.timePaused };
    });
    expect(st.panelOpen, '面板应关闭').toBe(false);
    expect(st.paused, '游戏应恢复运行').toBe(false);
    expect(st.fs, '应请求全屏').toBe(1);
    expect(st.locks).toContain('landscape');
  });
});

// iPhone 上「全屏 + 锁横屏」几乎不可能，所以提示条不能摆一个点不动的按钮，
// 而要给出真正能走通的路：装到主屏 / 先竖着玩。
test.describe('iOS（无全屏 API）的降级体验', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 });

  // 模拟 iPhone Safari：没有 requestFullscreen，UA 带 iPhone
  const asIphone = () => {
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      get: () => 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    });
    delete (HTMLElement.prototype as any).requestFullscreen;
  };

  test('不摆点不动的按钮，改给安装步骤；同时给出「就这么玩」', async ({ page }) => {
    await page.addInitScript(asIphone);
    await page.goto('/');
    await page.waitForFunction(() => !!(window as any).__vale, null, { timeout: 30000 });
    await page.waitForTimeout(600);

    const r = await page.evaluate(() => {
      const vis = (id: string) => {
        const el = document.getElementById(id);
        return !!el && getComputedStyle(el).display !== 'none';
      };
      return {
        iosBtn: vis('rotate-ios-fullscreen'),
        howto: vis('rotate-howto'),
        howtoText: document.getElementById('rotate-howto')?.textContent ?? '',
        help: vis('rotate-install-help'),
        start: vis('rotate-start'),
        cont: vis('rotate-continue'),
      };
    });
    expect(r.iosBtn, 'iOS 上没有全屏 API，这个按钮只会让人白点').toBe(false);
    expect(r.howto).toBe(true);
    expect(r.howtoText).toContain('添加到主屏幕');
    expect(r.help, '给一条能查的具体步骤').toBe(true);
    expect(r.start, '「横屏全屏」仍要保留（无全屏 API 时点了也不至于报错）').toBe(true);
    expect(r.cont, '必须给一条不装也能玩的路').toBe(true);
  });

  test('「就这么玩」关掉提示条，画布接管且游戏仍在跑', async ({ page }) => {
    await page.addInitScript(asIphone);
    await page.goto('/');
    await page.waitForFunction(() => !!(window as any).__vale, null, { timeout: 30000 });
    await page.waitForTimeout(600);
    await expect(page.locator('#rotate-tip')).toBeVisible();

    await page.locator('#rotate-continue').tap();
    await page.waitForTimeout(500);

    await expect(page.locator('#rotate-tip')).toBeHidden();
    const hit = await page.evaluate(() => {
      const c = document.querySelector('#game canvas')!;
      const r = c.getBoundingClientRect();
      const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return el ? el.tagName : 'none';
    });
    expect(hit, '提示条让开后画布应能收到触摸').toBe('CANVAS');
    expect(await page.evaluate(() => !!(window as any).__vale)).toBe(true);
  });

  test('已装成 PWA（独立模式）：不摆「横屏全屏」，只留提示', async ({ page }) => {
    await page.addInitScript(() => {
      // 独立模式靠 display-mode 媒体查询判断，直接打桩 matchMedia
      const orig = window.matchMedia.bind(window);
      window.matchMedia = ((q: string) => {
        if (q.includes('display-mode: fullscreen')) {
          return { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false } as unknown as MediaQueryList;
        }
        return orig(q);
      }) as typeof window.matchMedia;
    });
    await page.goto('/');
    await page.waitForFunction(() => !!(window as any).__vale, null, { timeout: 30000 });
    await page.waitForTimeout(600);

    const r = await page.evaluate(() => {
      const vis = (id: string) => {
        const el = document.getElementById(id);
        return !!el && getComputedStyle(el).display !== 'none';
      };
      const tip = document.getElementById('rotate-tip');
      return {
        start: vis('rotate-start'),
        help: vis('rotate-install-help'),
        howto: vis('rotate-howto'),
        cont: vis('rotate-continue'),
        cls: tip?.className ?? '',
      };
    });
    expect(r.cls).toContain('standalone');
    expect(r.start, '独立模式下横竖由系统决定，按钮是假的').toBe(false);
    expect(r.help, '已经装好了，再讲安装步骤没意义').toBe(false);
    expect(r.howto).toBe(false);
    expect(r.cont, '仍要能一键收起').toBe(true);
  });
});
