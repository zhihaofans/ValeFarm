// 回归：面板触控（用户实测反馈过：✕ 偶尔点不动、面板开着时背景摇杆还能滑）
import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 });

test('面板外透明点击区：不压暗 HUD，左上角点外也能关闭', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as unknown as any).__vale, null, { timeout: 30000 });
  await page.waitForTimeout(1200);

  const m = await page.evaluate(() => {
    const u = (window as unknown as any).__vale.scene.scene.get('ui');
    const p = u.activePanel;
    const shade = p.root.list[0];
    const b = shade.getBounds();
    return {
      open: !!u.panelOpen,
      x: b.x / u.uiDpr,
      y: b.y / u.uiDpr,
      w: b.width / u.uiDpr,
      h: b.height / u.uiDpr,
      vw: u.vw / u.uiDpr,
      vh: u.vh / u.uiDpr,
      hudBottom: u.safe.top + u.hudHCss,
      fillAlpha: shade.fillAlpha ?? 1,
    };
  });

  expect(m.open, '首屏应有晨报面板').toBe(true);
  // 点击区必须完全透明：不能再有任何"玻璃"压暗 HUD / 游戏
  expect(m.fillAlpha, '面板外点击区不能有可见填充').toBeLessThanOrEqual(0.01);
  // 点击区覆盖左右/底部，但顶部从 HUD 下沿开始
  expect(m.x, '点击区左边缘未到屏幕左边').toBeLessThanOrEqual(0.5);
  expect(m.x + m.w, '点击区右边缘未到屏幕右边').toBeGreaterThanOrEqual(m.vw - 0.5);
  expect(m.y, `点击区顶边 ${m.y.toFixed(1)} 应等于 HUD 下沿 ${m.hudBottom.toFixed(1)}`).toBeGreaterThanOrEqual(m.hudBottom - 0.5);
  expect(m.y).toBeLessThanOrEqual(m.hudBottom + 0.5);
  expect(m.y + m.h, '点击区下边缘未到屏幕底部').toBeGreaterThanOrEqual(m.vh - 0.5);

  // 面板在屏幕中间；左上角外侧必须被透明点击区接住并关闭
  const box = (await page.locator('#game canvas').boundingBox())!;
  await page.touchscreen.tap(box.x + 20, box.y + 200);
  await page.waitForTimeout(300);
  const open = await page.evaluate(() => !!(window as unknown as any).__vale.scene.scene.get('ui').panelOpen);
  expect(open, '点面板左上角外侧应关闭').toBe(false);
});

test('面板：✕ 可点、按钮可点、背景摇杆被锁', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as unknown as any).__vale, null, { timeout: 30000 });
  await page.waitForTimeout(1200);

  // 坐标一律用「CSS 像素」直接给：画布现在铺满视口，1 CSS px = 1 UI 单位
  const box = (await page.locator('#game canvas').boundingBox())!;
  const P = (x: number, y: number) => ({ x: box.x + x, y: box.y + y });
  // UI 场景的坐标是**画布像素**（= CSS × dpr），所以换算成 CSS 要除 uiDpr 才能喂给 page。
  const ui = () => page.evaluate(() => {
    const u = (window as unknown as any).__vale.scene.scene.get('ui');
    return { vw: u.vw, vh: u.vh, panelW: u.activePanel?.w ?? 0, panelH: u.activePanel?.h ?? 0 };
  });
  const paused = () => page.evaluate(() => (window as unknown as any).__vale.scene.timePaused);
  const px = () => page.evaluate(() => (window as unknown as any).__vale.scene.player.x);

  // 晨报面板已弹出（暂停中）
  expect(await paused()).toBe(true);

  // 1) 背景拖动不能移动玩家（起点必须落在摇杆热区里，否则本来就不会动，测了个空）
  const x0 = await px();
  const cdp = await page.context().newCDPSession(page);
  const a = P(150, 300), b = P(280, 300);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: a.x, y: a.y }] });
  for (let i = 1; i <= 8; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: a.x + (b.x - a.x) * i / 8, y: a.y }] });
    await page.waitForTimeout(30);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(250);
  expect(Math.abs((await px()) - x0)).toBeLessThan(1);

  // 2) ✕ 一次点击就关闭（位置按面板实际尺寸算，不再写死 800×450）
  //    panel.w/h 现在是 CSS 像素，vw/vh 是画布像素 → 只把后者折算回 CSS
  const m = await ui();
  const toCss = await page.evaluate(() => (window as unknown as any).__vale.scene.scene.get('ui').uiDpr as number);
  const cx = m.vw / 2 / toCss, cy = m.vh / 2 / toCss;
  const closePt = P(cx + m.panelW / 2 - 30, cy - m.panelH / 2 + 22);
  await page.touchscreen.tap(closePt.x, closePt.y);
  await page.waitForTimeout(300);
  expect(await paused()).toBe(false);

  // 3) 重新打开面板，点主按钮（"横屏全屏"）也能关
  await page.evaluate(() => (window as unknown as any).__vale.scene.scene.get('ui').showDayReport(['回归测试']));
  await page.waitForTimeout(300);
  expect(await paused()).toBe(true);
  const main = await page.evaluate(() => {
    const u = (window as unknown as any).__vale.scene.scene.get('ui');
    // 主按钮 = 正文里最宽的按钮（不写死像素宽：尺寸内部乘过 dpr）
    const btns = (u.activePanel?.body?.list ?? []).filter((o: any) => o.input?.hitArea?.width > 0);
    const btn = btns.sort((a: any, b: any) => b.input.hitArea.width - a.input.hitArea.width)[0];
    if (!btn) return null;
    const mm = btn.getWorldTransformMatrix();
    return { x: mm.tx / u.uiDpr, y: mm.ty / u.uiDpr };
  });
  expect(main, '晨报应有主按钮').not.toBeNull();
  await page.touchscreen.tap(P(main!.x, main!.y).x, P(main!.x, main!.y).y);
  await page.waitForTimeout(300);
  expect(await paused()).toBe(false);

  // 4) 关闭后摇杆恢复可用
  const x2 = await px();
  // 摇杆圆心：左下角（与 buildButtons 的 setHome 对齐）
  const joy = await page.evaluate(() => {
    const u = (window as unknown as any).__vale.scene.scene.get('ui');
    return { x: u.joy.home.x / u.uiDpr, y: u.joy.home.y / u.uiDpr, r: u.joy.radius / u.uiDpr };
  });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: P(joy.x, joy.y).x, y: P(joy.x, joy.y).y }] });
  for (let i = 1; i <= 6; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: P(joy.x + i * 8, joy.y).x, y: P(joy.x, joy.y).y }] });
    await page.waitForTimeout(40);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(250);
  expect(Math.abs((await px()) - x2)).toBeGreaterThan(1);
});

// 回归：用户实测反馈的两个问题
// ① 长按动作键才出对话框、一松手就关 → 现在点一下就开，抬手不会关
// ② 右上角 ☰ 点不了 → 根因是动作键图标的层级（buttons+1）压住了 ☰ 的命中区
test('动作键点一下就开面板且抬手不关；☰ 能点开系统面板', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as unknown as any).__vale, null, { timeout: 30000 });
  await page.waitForTimeout(1200);

  const box = (await page.locator('#game canvas').boundingBox())!;
  const P = (x: number, y: number) => ({ x: box.x + x, y: box.y + y });
  const ui = () => page.evaluate(() => {
    const u = (window as unknown as any).__vale.scene.scene.get('ui');
    return { panelOpen: !!u.panelOpen, paused: (window as unknown as any).__vale.scene.timePaused };
  });

  // 站到 NPC 面前，动作键才会触发言行
  await page.evaluate(() => {
    const g = (window as unknown as any).__vale;
    g.scene.scene.get('ui').closeTopPanel();
    g.scene.player.setPosition(18 * 32 + 16, 5 * 32 + 16);
    g.world.facing = 'up';
  });
  await page.waitForTimeout(300);

  // ① 按下动作键 → 面板出现；松手 → 面板还在
  const cdp = await page.context().newCDPSession(page);
  const act = await page.evaluate(() => {
    const u = (window as unknown as any).__vale.scene.scene.get('ui');
    const c = u.children.list.filter((o: any) => o.type === 'Arc' && o.depth === 850)[0];
    return { x: c.x / u.uiDpr, y: c.y / u.uiDpr };
  });
  const actP = P(act.x, act.y);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: actP.x, y: actP.y }] });
  await page.waitForTimeout(400);
  expect((await ui()).panelOpen, '按下动作键应立刻弹出对话').toBe(true);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(350);
  expect((await ui()).panelOpen, '抬手不应把对话关掉').toBe(true);

  // ② 关掉对话后点 ☰，系统面板要打开
  await page.evaluate(() => (window as unknown as any).__vale.scene.scene.get('ui').closeTopPanel());
  await page.waitForTimeout(300);
  const menu = await page.evaluate(() => {
    const u = (window as unknown as any).__vale.scene.scene.get('ui');
    const b = u.children.list.find((o: any) => o.type === 'Container' && o.depth === 852);
    return { x: b.x / u.uiDpr, y: b.y / u.uiDpr };
  }).then((p) => P(p.x, p.y));
  await page.touchscreen.tap(menu.x, menu.y);
  await page.waitForTimeout(400);
  const st = await ui();
  expect(st.panelOpen, '☰ 应打开系统面板').toBe(true);
  expect(st.paused).toBe(true);
});

// 回归：0.4.1 竖屏「系统」面板内容伸出左右边 —— 面板排版按 640 宽设计，
// 竖屏面板只有 ~366 宽。现在 body 整体等比缩放（makePanel 内），
// 这条断言「面板内所有可点内容的世界包围盒都在面板矩形内」钉死它。
for (const vp of [{ name: '竖屏 390×844', width: 390, height: 844 }, { name: '折叠屏 344×882', width: 344, height: 882 }]) {
  test(`${vp.name}：系统面板内容不超出面板边界`, async ({ browser }) => {
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 3, hasTouch: true, isMobile: true,
    });
    const p = await ctx.newPage();
    await p.goto('/');
    await p.waitForFunction(() => !!(window as unknown as any).__vale, null, { timeout: 30000 });
    await p.waitForTimeout(900);

    // 关掉晨报 → 打开系统面板
    await p.evaluate(() => {
      const u = (window as unknown as any).__vale.scene.scene.get('ui');
      u.closeTopPanel();
      u.openSystem();
    });
    await p.waitForTimeout(400);

    const m = await p.evaluate(() => {
      const u = (window as unknown as any).__vale.scene.scene.get('ui');
      const panel = u.activePanel;
      const S = u.uiDpr;
      // 收集 body 里所有可点对象的世界包围盒（含 scale）
      const boxes: Array<{ x0: number; x1: number; label: string }> = [];
      panel.body.list.forEach((o: any) => {
        if (!o.input?.hitArea) return;
        // hitArea 是本地值，要乘上 body 的整体缩放（竖屏时 makePanel 会等比缩小内容）
        const hw = o.input.hitArea.width / 2 * panel.body.scaleX * (o.scaleX ?? 1);
        const mm = o.getWorldTransformMatrix();
        // mm.tx 是画布绝对坐标，减去面板中心（root.x）才是相对面板中心的偏移
        const center = panel.root.x;
        boxes.push({ x0: (mm.tx - center - hw) / S, x1: (mm.tx - center + hw) / S, label: String(o.list?.find?.((c) => c.text)?.text ?? '?') });
      });
      const halfW = panel.w / 2;
      return { boxes, halfW, panelW: panel.w };
    });

    expect(m.boxes.length, '系统面板应有可点按钮').toBeGreaterThan(3);
    for (const b of m.boxes) {
      expect(b.x0, `「${b.label}」左边缘 ${b.x0.toFixed(0)} 超出面板左界 ${-m.halfW}`).toBeGreaterThanOrEqual(-m.halfW - 1);
      expect(b.x1, `「${b.label}」右边缘 ${b.x1.toFixed(0)} 超出面板右界 ${m.halfW}`).toBeLessThanOrEqual(m.halfW + 1);
    }
    await ctx.close();
  });
}

// 回归：iOS PWA 独立窗口**没有地址栏**，用户打不开 public/diag.html 那种「给个 URL」
// 的诊断页 —— 所以诊断必须能从游戏里走到（☰ → 系统 → 环境诊断）。
// 这条钉死两件事：① 那个按钮真的存在且点得开 ② 文本与复制按钮都不越出面板（竖屏尤其容易溢出）。
for (const vp of [{ name: '竖屏 390×844', width: 390, height: 844 }, { name: '横屏 844×390', width: 844, height: 390 }]) {
  test(`${vp.name}：游戏内环境诊断面板能打开且不越界`, async ({ browser }) => {
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 3, hasTouch: true, isMobile: true,
    });
    const page = await ctx.newPage();
    await page.goto('/');
    await page.waitForFunction(() => !!(window as unknown as any).__vale, null, { timeout: 30000 });
    await page.waitForTimeout(900);

    const box = (await page.locator('#game canvas').boundingBox())!;
    await page.evaluate(() => {
      const u = (window as unknown as any).__vale.scene.scene.get('ui');
      // 竖屏建议卡片是 DOM 覆盖层，会吃掉系统面板按钮的触摸；这里按真实用户路径先关掉它
      document.querySelector('#rotate-tip')?.remove();
      u.closeTopPanel();
      u.openSystem();
    });
    await page.waitForTimeout(400);

    const btn = await page.evaluate(() => {
      const u = (window as unknown as any).__vale.scene.scene.get('ui');
      const panel = u.activePanel;
      const S = u.uiDpr;
      const b = panel.body.list.find((o: any) => o.list?.some((c: any) => String(c.text ?? '').includes('环境诊断')));
      if (!b) return null;
      const mm = b.getWorldTransformMatrix();
      return { x: mm.tx / S, y: mm.ty / S };
    });
    expect(btn, '系统面板里必须有「环境诊断」入口').not.toBeNull();
    await page.touchscreen.tap(box.x + btn!.x, box.y + btn!.y);
    await page.waitForTimeout(450);

    const r = await page.evaluate(() => {
      const u = (window as unknown as any).__vale.scene.scene.get('ui');
      const panel = u.activePanel;
      const S = u.uiDpr;
      const t = panel.body.list.find((o: any) => o.type === 'Text');
      const text = String(t?.text ?? '');
      const clickable = panel.body.list.filter((o: any) => o.input?.hitArea);
      // 所有可点对象（复制按钮）与文本的世界包围盒都不能越过面板本体
      const worst = Math.max(
        t ? (t.getBounds().bottom - panel.root.y) / S : -1e9,
        ...clickable.map((o: any) => (o.getBounds ? o.getBounds().bottom : o.getWorldTransformMatrix().ty) - panel.root.y).map((v: number) => v / S),
      );
      return {
        open: u.panelOpen,
        hasSource: text.includes('安全区来源'),
        hasFinalSafe: text.includes('最终 safe'),
        hasHud: text.includes('HUD 高度'),
        bottom: worst,
        panelBottom: panel.h / 2,
        clicks: clickable.length,
      };
    });

    expect(r.open, '点按钮后环境诊断面板应处于打开状态').toBe(true);
    expect(r.hasSource, '必须给出安全区来源，否则开发者无法判断 env() 是否失效').toBe(true);
    expect(r.hasFinalSafe).toBe(true);
    expect(r.hasHud).toBe(true);
    expect(r.clicks, '复制按钮应存在').toBeGreaterThanOrEqual(1);
    expect(r.bottom, `内容底边 ${r.bottom.toFixed(0)} 越过面板下界 ${r.panelBottom.toFixed(0)}`).toBeLessThanOrEqual(r.panelBottom);
    await ctx.close();
  });
}
