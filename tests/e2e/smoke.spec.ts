// e2e：只信"用户路径"——页面能开、能玩、断网能玩、存档不丢、部署不 404。
// 交互通过页面暴露的 __vale（动作入口 doAction / world 状态）驱动，
// 相当于"替玩家按了按钮"，而不是去翻内部实现。

import { spawn, type ChildProcess } from 'node:child_process';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

async function waitGame(page: Page, timeout = 30000): Promise<void> {
  await page.waitForFunction(() => !!(window as unknown as { __vale?: unknown }).__vale, null, { timeout });
}

/** 关掉晨报/结果面板，并把玩家放回目标格下方、面朝上 */
async function dismissReportAndStand(page: Page, tile: { x: number; y: number }): Promise<void> {
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const ui = (window as unknown as any).__vale?.scene?.scene?.get('ui');
    ui?.closeTopPanel?.();
  });
  await page.evaluate(({ x, y }: { x: number; y: number }) => {
    const { scene, world } = (window as unknown as any).__vale;
    scene.player.setPosition((3 + x) * 32 + 16, (5 + y + 1) * 32 + 16);
    world.facing = 'up';
  }, tile);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await waitGame(page);
  // 等晨报面板弹出后关掉它，避免挡住后续动作
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const ui = (window as unknown as any).__vale?.scene?.scene?.get('ui');
    ui?.closeTopPanel?.();
  });
  await page.waitForTimeout(100);
});

test.describe('冒烟', () => {
  test('页面加载无 JS 错误，画布与 HUD 出现', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await expect(page.locator('#game canvas')).toBeVisible();
    // 等一会让游戏跑几帧
    await page.waitForTimeout(1500);
    expect(errors, errors.join('\n')).toEqual([]);
  });
});

test.describe('核心循环（种—浇—收—卖—买）', () => {
  test('锄地→播种→浇水→睡觉→生长→收获', async ({ page }) => {
    // 找一块无障碍的 wild 地，把玩家放到它正下方一格、面朝上
    const tile = await page.evaluate(() => {
      const { scene, world } = (window as unknown as any).__vale;
      for (let x = 0; x < 12; x++) {
        for (let y = 0; y < 10; y++) {
          const p = world.plots[y * 12 + x];
          if (p.state === 'wild' && !p.obstacle) {
            // 站到农田 (x, y+1)（农田内可站立）
            scene.player.setPosition((3 + x) * 32 + 16, (5 + y + 1) * 32 + 16);
            world.facing = 'up';
            scene.world.facing = 'up';
            return { x, y };
          }
        }
      }
      return null;
    });
    expect(tile).not.toBeNull();

    const probe = () => page.evaluate(({ x, y }: { x: number; y: number }) => {
      const { world } = (window as unknown as any).__vale;
      const p = world.plots[y * 12 + x];
      return { state: p.state, stage: p.crop?.stage ?? -1, withered: !!p.crop?.withered };
    }, tile!);

    // 1. 锄地
    await page.evaluate(() => (window as unknown as any).__vale.scene.doAction());
    expect((await probe()).state).toBe('tilled');
    // 2. 播种（初始带 6 包四季萝卜种子，默认选中）
    await page.evaluate(() => (window as unknown as any).__vale.scene.doAction());
    expect((await probe()).stage).toBe(0);
    // 3. 浇水
    await page.evaluate(() => (window as unknown as any).__vale.scene.doAction());
    expect((await probe()).state).toBe('watered');

    // 4. 睡觉两次（作物每天推进一阶段，3 天成熟）
    for (let day = 0; day < 2; day++) {
      // 次日：晨报面板会弹出并把玩家移回床边，先关面板再站回田边
      await dismissReportAndStand(page, tile);
      // 重新浇水
      await page.evaluate(() => (window as unknown as any).__vale.scene.doAction());
      expect((await probe()).state).toBe('watered');
      await page.evaluate(() => new Promise<void>((res) => {
        const s = (window as unknown as any).__vale.scene;
        s.sleep(false);
        setTimeout(res, 1200); // 等 fadeOut/结算/fadeIn
      }));
    }
    // 第三天浇完水睡到成熟
    await dismissReportAndStand(page, tile);
    await page.evaluate(() => (window as unknown as any).__vale.scene.doAction());
    await page.evaluate(() => new Promise<void>((res) => {
      (window as unknown as any).__vale.scene.sleep(false);
      setTimeout(res, 1200);
    }));
    expect((await probe()).stage).toBe(3);

    // 5. 收获：先关晨报、站回田边
    await dismissReportAndStand(page, tile);
    await page.evaluate(() => (window as unknown as any).__vale.scene.doAction());
    const inv = await page.evaluate(() => {
      const w = (window as unknown as any).__vale.world;
      return Object.fromEntries(Object.entries(w.inventory).filter(([k]) => k.startsWith('crop:')));
    });
    const got = Object.values(inv as Record<string, number>).reduce((a, b) => a + b, 0);
    expect(got).toBeGreaterThanOrEqual(1);
  });

  test('商店 UI：打开面板买 1 包种子扣钱', async ({ page }) => {
    // 站到商店门前（商店在 (19,2)，门口 (19,3)），面朝上；商店 9:00 开门，把时间拨到白天
    await page.evaluate(() => {
      const { scene, world } = (window as unknown as any).__vale;
      scene.player.setPosition(19 * 32 + 16, 3 * 32 + 16);
      world.facing = 'up';
      world.minute = 10 * 60;
    });
    const goldBefore = await page.evaluate(() => (window as unknown as any).__vale.world.gold);
    await page.evaluate(() => (window as unknown as any).__vale.scene.doAction());
    await page.waitForTimeout(300);
    // 点"买 1"：不写死坐标 —— 面板现在按「HUD 之下可用区」居中（不再固定 225），
    // 写死 157 在 HUD 高度一变就点空。改成从场景里取按钮实际世界坐标再换算。
    const pos = await page.evaluate(() => {
      const u = (window as unknown as any).__vale.scene.scene.get('ui');
      const S = u.uiDpr;
      const btn = u.activePanel.body.list.find(
        (o: any) => o.list?.some((c: any) => String(c.text ?? '').includes('买 1')),
      );
      if (!btn) return null;
      const mm = btn.getWorldTransformMatrix();
      return { x: mm.tx / S, y: mm.ty / S };
    });
    expect(pos, '面板里应有「买 1」按钮').not.toBeNull();
    await page.mouse.click(pos!.x, pos!.y);
    await page.waitForTimeout(200);
    const { goldAfter, seeds } = await page.evaluate(() => {
      const w = (window as unknown as any).__vale.world;
      return { goldAfter: w.gold, seeds: w.inventory['seed:radish'] ?? 0 };
    });
    expect(goldAfter).toBe(goldBefore - 20);
    expect(seeds).toBeGreaterThanOrEqual(7);
  });
});

test.describe('存档', () => {
  test('写入 → reload → 每个登记字段（含嵌套）都还在', async ({ page }) => {
    await page.evaluate(() => {
      const w = (window as unknown as any).__vale.world;
      w.day = 42;
      w.gold = 777;
      w.inventory['crop:pea:gold'] = 13;
      w.npcs.mira.friendship = 321;
      w.npcs.mira.giftedToday = true;
      w.plots[5] = { state: 'watered', crop: { type: 'corn', stage: 2, progress: 1, dryDays: 3, wateredToday: true, withered: false }, obstacle: null };
      return (window as unknown as any).__vale.scene.save();
    });
    await page.waitForTimeout(500);
    await page.reload();
    await waitGame(page);
    const w = await page.evaluate(() => (window as unknown as any).__vale.world);
    expect(w.day).toBe(42);
    expect(w.gold).toBe(777);
    expect(w.inventory['crop:pea:gold']).toBe(13);
    expect(w.npcs.mira.friendship).toBe(321);
    expect(w.npcs.mira.giftedToday).toBe(true);
    expect(w.plots[5].crop.type).toBe('corn');
    expect(w.plots[5].crop.stage).toBe(2);
    expect(w.plots[5].crop.dryDays).toBe(3);
  });

  test('断网 reload：SW 缓存兜底，游戏照常打开且存档可读', async ({ page, context }) => {
    // 先把状态写进存档
    await page.evaluate(() => {
      const w = (window as unknown as any).__vale.world;
      w.day = 7;
      return (window as unknown as any).__vale.scene.save();
    });
    // 等 SW 就绪并完成预缓存
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForTimeout(1500);

    await context.setOffline(true);
    await page.reload();
    await waitGame(page, 20000);
    await expect(page.locator('#game canvas')).toBeVisible();
    const day = await page.evaluate(() => (window as unknown as any).__vale.world.day);
    expect(day).toBe(7);
  });
});

// 全屏自适应是这版的核心：任何比例都必须
//   ① 画布严丝合缝铺满视口（不黑边、不溢出、不出现滚动条）
//   ② 可见世界宽高比 == 屏幕宽高比（地块永远方形，不能压扁）
//   ③ 摇杆在左下、动作键在右下，且两者不重叠
// 少一条都会在某种机型上崩，所以按比例列全。
test.describe('视口自适应', () => {
  const VPS = [
    { name: 'iPhone SE 横', width: 667, height: 375 },
    { name: 'iPhone 13 横', width: 844, height: 390 },
    { name: 'iPhone 13 竖', width: 390, height: 844 },
    { name: 'iPad 竖', width: 768, height: 1024 },
    { name: 'iPad 横', width: 1024, height: 768 },
    { name: '折叠屏外屏', width: 344, height: 882 },
  ];

  for (const vp of VPS) {
    test(`${vp.name} ${vp.width}×${vp.height}：铺满 + 不漏形 + 按钮不重叠`, async ({ browser }) => {
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2 });
      const p = await ctx.newPage();
      await p.goto('/');
      await waitGame(p);
      // 等 resize 防抖 + 场景重建跑完
      await p.waitForTimeout(700);

      const m = await p.evaluate(() => {
        const ui = (window as unknown as any).__vale.scene.scene.get('ui');
        const joy = ui.joy;
        const act = ui.children.list.find((o: any) => o.type === 'Arc' && o.depth === 850) as any;
        // UI 场景里 displayList 的 x/y 已经是「CSS 像素」单位（相机 zoom=1，
        const canvas = document.querySelector('#game canvas') as HTMLCanvasElement;
        return {
          vw: window.innerWidth,
          vh: window.innerHeight,
          cssW: canvas.getBoundingClientRect().width,
          cssH: canvas.getBoundingClientRect().height,
          attrW: canvas.width,
          attrH: canvas.height,
          scrollW: document.documentElement.scrollWidth,
          scrollH: document.documentElement.scrollHeight,
          view: (window as any).__valeView as { w: number; h: number },
          dpr: window.devicePixelRatio,
          uiDpr: ui.uiDpr,
          // UI 坐标是画布像素 → 除 uiDpr 换回 CSS 像素再比较
          joy: { x: joy.home.x / ui.uiDpr, y: joy.home.y / ui.uiDpr, r: joy.radius / ui.uiDpr },
          act: act ? { x: act.x / ui.uiDpr, y: act.y / ui.uiDpr, r: act.radius / ui.uiDpr } : null,
        };
      });

      // ① 铺满
      expect(Math.abs(m.cssW - m.vw), '画布宽应等于视口宽').toBeLessThanOrEqual(1);
      expect(Math.abs(m.cssH - m.vh), '画布高应等于视口高').toBeLessThanOrEqual(1);
      // 内部分辨率 = CSS × dpr（Scale.NONE 下不封顶 dpr，否则会被拉伸）
      expect(Math.abs(m.attrW - m.cssW * m.dpr)).toBeLessThanOrEqual(2);
      expect(Math.abs(m.attrH - m.cssH * m.dpr)).toBeLessThanOrEqual(2);
      expect(m.scrollW, '不应有横向滚动').toBeLessThanOrEqual(m.vw + 1);
      expect(m.scrollH, '不应有纵向滚动').toBeLessThanOrEqual(m.vh + 1);

      // ② 地块方形：可见世界比例 == 屏幕比例
      expect(m.view.w / m.view.h, '世界可见区被拉变形了').toBeCloseTo(m.vw / m.vh, 2);

      // ③ 摇杆左下、动作键右下，不重叠
      expect(m.act, '动作键应存在').not.toBeNull();
      expect(m.joy.x, '摇杆应在左半屏').toBeLessThan(m.vw * 0.5);
      expect(m.joy.y, '摇杆应在下半屏').toBeGreaterThan(m.vh * 0.5);
      expect(m.act!.x, '动作键应在右半屏').toBeGreaterThan(m.vw * 0.5);
      expect(m.act!.y, '动作键应在下半屏').toBeGreaterThan(m.vh * 0.5);
      const gap = Math.hypot(m.act!.x - m.joy.x, m.act!.y - m.joy.y);
      expect(gap, `摇杆与动作键重叠（间距 ${gap.toFixed(0)} < ${(m.act!.r + m.joy.r).toFixed(0)}）`)
        .toBeGreaterThan(m.act!.r + m.joy.r);
      // 底盘光圈（1.5r）必须完整落在屏幕内 —— 裁掉一半会看着像糊了一块
      const ring = m.joy.r * 1.5;
      expect(m.joy.x - ring, `摇杆左侧光圈越界 ${(m.joy.x - ring).toFixed(0)}px`).toBeGreaterThan(-2);
      expect(m.joy.y + ring, `摇杆底部光圈越界 ${(m.joy.y + ring - m.vh).toFixed(0)}px`).toBeLessThanOrEqual(m.vh + 2);
      expect(m.joy.y - ring).toBeGreaterThan(0);
      expect(m.act!.x + m.act!.r).toBeLessThanOrEqual(m.vw + 2);
      expect(m.act!.y + m.act!.r).toBeLessThanOrEqual(m.vh + 2);

      await ctx.close();
    });
  }

  // 回归：0.4.0 坐标系改成「UI 单位 = 画布像素」后，面板尺寸常量忘了乘 dpr，
  // 结果 dpr=3 的手机上面板只有 640/3 ≈ 213 CSS px、✕ 按钮 16px 宽，手指点不中。
  // 这条用例把「面板按 CSS 尺寸撑开、✕ 能一次点中」钉死。
  for (const dpr of [2, 3]) {
    test(`面板尺寸按 CSS 像素撑开且 ✕ 可点（dpr=${dpr}）`, async ({ browser }) => {
      const ctx = await browser.newContext({
        viewport: { width: 844, height: 390 }, deviceScaleFactor: dpr, hasTouch: true, isMobile: true,
      });
      const p = await ctx.newPage();
      await p.goto('/');
      await waitGame(p);
      await p.waitForTimeout(900);

      const m = await p.evaluate(() => {
        const u = (window as unknown as any).__vale.scene.scene.get('ui');
        const panel = u.activePanel;
        return {
          open: !!u.panelOpen,
          // Panel.w/h 对外统一是 CSS 像素
          pw: panel?.w ?? 0,
          ph: panel?.h ?? 0,
          uiDpr: u.uiDpr,
          canvas: (() => { const r = document.querySelector('#game canvas')!.getBoundingClientRect(); return { w: r.width, h: r.height }; })(),
        };
      });

      expect(m.open, '首屏应有晨报面板').toBe(true);
      // 面板尺寸 = min(640, 屏宽-24) × min(360, 屏高-40)，与 dpr 无关
      expect(m.pw, 'dpr 不该让面板缩水').toBeCloseTo(Math.min(640, 844 - 24), 0);
      expect(m.ph, 'dpr 不该让面板缩水').toBeCloseTo(Math.min(360, 390 - 40), 0);

      // ✕ 在面板右上角内缩 30/22；按 CSS 值点击必须一次命中
      const cx = m.canvas.w / 2, cy = m.canvas.h / 2;
      const closePt = { x: cx + m.pw / 2 - 30, y: cy - m.ph / 2 + 22 };
      const cdp = await ctx.newCDPSession(p);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: closePt.x, y: closePt.y }] });
      await p.waitForTimeout(80);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await p.waitForTimeout(400);

      const after = await p.evaluate(() => {
        const u = (window as unknown as any).__vale.scene.scene.get('ui');
        return { open: !!u.panelOpen, paused: !!(window as unknown as any).__vale.scene.timePaused };
      });
      expect(after.open, `✕ 没点中（落点 ${JSON.stringify(closePt)}，dpr=${dpr}）`).toBe(false);
      expect(after.paused, '关面板后应恢复运行').toBe(false);

      await ctx.close();
    });
  }

  test('运行中旋转屏幕：画布与相机即时跟随，不需要刷新', async ({ page }) => {
    await page.setViewportSize({ width: 844, height: 390 });
    await page.goto('/');
    await waitGame(page);
    await page.waitForTimeout(600);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(800);

    const m = await page.evaluate(() => {
      const c = document.querySelector('#game canvas')!.getBoundingClientRect();
      return { cssW: c.width, cssH: c.height, view: (window as any).__valeView as { w: number; h: number } };
    });
    expect(Math.abs(m.cssW - 390)).toBeLessThanOrEqual(1);
    expect(Math.abs(m.cssH - 844)).toBeLessThanOrEqual(1);
    expect(m.view.w / m.view.h).toBeCloseTo(390 / 844, 2);
  });
});

test.describe('子目录部署', () => {
  test('深层子路径：0 条 404，游戏可开', async ({ page }) => {
    // 把构建产物（docs/）拷到 /tmp/site/sub/deep，用 python http.server 伺服。
    // 每次都整目录重建：旧构建的 assets 残留在目录里会让"0 条 404"失去意义。
    //
    // 注意拷的是 docs/ 而不是别的临时目录 —— 这是 GitHub Pages 的发布源，
    // 这条用例等于在替 Pages 做验收：产物里的相对路径必须能在深层子路径下跑通。
    rmSync('/tmp/site', { recursive: true, force: true });
    mkdirSync('/tmp/site/sub/deep', { recursive: true });
    cpSync('docs', '/tmp/site/sub/deep', { recursive: true });
    const proc: ChildProcess = spawn('python3', ['-m', 'http.server', '8322'], {
      cwd: '/tmp/site', stdio: 'ignore',
    });
    try {
      // 等静态服务就绪（最多 5s），避免连接被拒
      let up = false;
      for (let i = 0; i < 25; i++) {
        try {
          const r = await page.request.get('http://127.0.0.1:8322/sub/deep/index.html');
          if (r.ok()) { up = true; break; }
        } catch { /* not yet */ }
        await page.waitForTimeout(200);
      }
      expect(up, '静态服务未能启动').toBe(true);
      const notFound: string[] = [];
      page.on('response', (r) => { if (r.status() === 404) notFound.push(r.url()); });
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      await page.goto('http://127.0.0.1:8322/sub/deep/');
      await waitGame(page, 20000);
      await page.waitForTimeout(1500);
      expect(notFound, notFound.join('\n')).toEqual([]);
      expect(errors, errors.join('\n')).toEqual([]);
    } finally {
      proc.kill();
    }
  });
});
