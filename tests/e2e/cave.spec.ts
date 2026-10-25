import { expect, test } from '@playwright/test';

// B1 矿洞闭环：林区洞口进洞 → 存档重载仍在洞里 → 底部出口回林区。
// 矿脉的数值/耐久由 unit/cave+unit/mine 覆盖；这里只钉场景切换与存档。

test('进洞 → 重载仍在矿洞 → 出洞回林区', async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as any).__valeSafeInsets = { top: 59, right: 0, bottom: 34, left: 0 };
  });
  await page.goto('/');
  await page.waitForFunction(() => !!(window as unknown as any).__vale, null, { timeout: 30000 });
  await page.waitForTimeout(700);

  await page.evaluate(() => {
    const { scene, world } = (window as unknown as any).__vale;
    const ui = scene.scene.get('ui');
    ui.closeTopPanel();
    document.querySelector('#rotate-tip')?.remove();
    scene.player.setPosition(27 * 32 + 16, 2 * 32 + 16);
    world.playerX = 27;
    world.playerY = 2;
    world.facing = 'up';
  });
  await page.waitForTimeout(120);
  await page.evaluate(() => (window as unknown as any).__vale.scene.doAction());
  await page.waitForFunction(() => (window as unknown as any).__vale.world.area === 'cave', null, { timeout: 5000 });
  await page.waitForFunction(() => {
    const u = (window as unknown as any).__vale.scene.scene.get('ui');
    return String(u.timeText.text).includes('矿洞 B1');
  }, null, { timeout: 5000 });

  const cave = await page.evaluate(() => {
    const { world } = (window as unknown as any).__vale;
    const ui = (window as unknown as any).__vale.scene.scene.get('ui');
    return { area: world.area, hud: ui.timeText.text, ores: world.cave.ores.length };
  });
  expect(cave.area).toBe('cave');
  expect(cave.ores).toBe(4);
  expect(cave.hud).toContain('矿洞 B1');

  // 存档 → reload：矿洞状态必须保留
  await page.evaluate(async () => { await (window as unknown as any).__vale.scene.save(); });
  await page.reload();
  await page.waitForFunction(() => !!(window as unknown as any).__vale, null, { timeout: 30000 });
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    const { scene } = (window as unknown as any).__vale;
    scene.scene.get('ui').closeTopPanel();
    document.querySelector('#rotate-tip')?.remove();
  });
  const reloaded = await page.evaluate(() => {
    const { world } = (window as unknown as any).__vale;
    return { area: world.area, player: [world.playerX, world.playerY] };
  });
  expect(reloaded.area).toBe('cave');
  expect(reloaded.player).toEqual([7, 8]);

  // 底部出口 → 回林区洞口前
  await page.evaluate(() => {
    const { scene, world } = (window as unknown as any).__vale;
    scene.player.setPosition(7 * 32 + 16, 8 * 32 + 16);
    world.playerX = 7;
    world.playerY = 8;
    world.facing = 'down';
  });
  await page.waitForTimeout(120);
  await page.evaluate(() => (window as unknown as any).__vale.scene.doAction());
  await page.waitForFunction(() => (window as unknown as any).__vale.world.area === 'farm', null, { timeout: 5000 });
  await page.waitForFunction(() => {
    const u = (window as unknown as any).__vale.scene.scene.get('ui');
    return String(u.timeText.text).includes('林区');
  }, null, { timeout: 5000 });

  const back = await page.evaluate(() => {
    const { world } = (window as unknown as any).__vale;
    const ui = (window as unknown as any).__vale.scene.scene.get('ui');
    return { area: world.area, player: [world.playerX, world.playerY], hud: ui.timeText.text };
  });
  expect(back.area).toBe('farm');
  expect(back.player).toEqual([27, 2]);
  expect(back.hud).toContain('林区');
});
