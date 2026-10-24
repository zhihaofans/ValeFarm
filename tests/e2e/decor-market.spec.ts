// e2e 回归：装饰摆放/收回/存档往返 + 集市日提示与卖价倍率（第二批）。
//
// 这两块都是"看着对、实际可能没落盘/没生效"的类型：
//   · 装饰：摆上去 → reload → 还在？收回 → 回到背包？存档字段登记漏了就会静默丢。
//   · 集市日：由 day 推导，晨报要有提示、出售页顶部要显示倍率。

import { expect, test, type Page } from '@playwright/test';

async function waitGame(page: Page, timeout = 30000): Promise<void> {
  await page.waitForFunction(() => !!(window as unknown as { __vale?: unknown }).__vale, null, { timeout });
}

async function closeReport(page: Page): Promise<void> {
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const ui = (window as unknown as any).__vale?.scene?.scene?.get('ui');
    ui?.closeTopPanel?.();
  });
  await page.waitForTimeout(100);
}

const act = (page: Page) => page.evaluate(() => (window as unknown as any).__vale.scene.doAction());

/** 读当前面板（activePanel）里的所有文本行 */
const panelTexts = (page: Page) => page.evaluate(() => {
  const ui = (window as unknown as any).__vale.scene.scene.get('ui');
  const panel = ui.activePanel;
  return ((panel?.body?.list ?? []) as any[])
    .map((o) => o?.text)
    .filter((t) => typeof t === 'string') as string[];
});

/** 把玩家放到 (12,2) 面朝上，目标格 (12,1)（农田上方的空地） */
async function standForDecor(page: Page): Promise<void> {
  await page.evaluate(() => {
    const { scene, world } = (window as unknown as any).__vale;
    scene.player.setPosition(12 * 32 + 16, 2 * 32 + 16);
    world.facing = 'up';
    scene.world.facing = 'up';
  });
}

const decorState = (page: Page) => page.evaluate(() => {
  const { world } = (window as unknown as any).__vale;
  return {
    count: world.decor.length as number,
    at: (world.decor.find((d: any) => d.x === 12 && d.y === 1) ?? null) as { id: string } | null,
    inBag: (world.inventory['decor:flowerpot'] ?? 0) as number,
  };
});

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await waitGame(page);
  await closeReport(page);
});

test.describe('装饰：摆放 → 存档 → 收回', () => {
  test('摆到面朝格、存档往返仍在、再按一次收回背包', async ({ page }) => {
    await standForDecor(page);
    await page.evaluate(() => {
      const { world, scene } = (window as unknown as any).__vale;
      world.inventory['decor:flowerpot'] = 1;
      scene.scene.get('ui').currentQuickItem = 'decor:flowerpot';
    });

    // 1) 摆放
    await act(page);
    const placed = await decorState(page);
    expect(placed.count, '应摆出 1 件装饰').toBe(1);
    expect(placed.at?.id, '摆放的应是陶土花盆').toBe('decor:flowerpot');
    expect(placed.inBag, '摆放应从背包扣 1').toBe(0);

    // 2) 存档 → reload → 还在（这条守的是 normalizeWorld 有没有登记 decor）
    await page.evaluate(() => (window as unknown as any).__vale.scene.save());
    await page.waitForTimeout(300);
    await page.reload();
    await waitGame(page);
    await closeReport(page);

    const afterReload = await decorState(page);
    expect(afterReload.count, 'reload 后装饰应还在').toBe(1);
    expect(afterReload.at?.id).toBe('decor:flowerpot');

    // 3) 对着已摆的装饰按互动 → 收回背包
    await standForDecor(page);
    await act(page);
    const removed = await decorState(page);
    expect(removed.count, '收回后地面应清空').toBe(0);
    expect(removed.inBag, '收回应回到背包').toBe(1);
  });

  test('农田格不能摆装饰（避免把耕地堵死）', async ({ page }) => {
    // 站到农田里，面朝另一块农田
    await page.evaluate(() => {
      const { scene, world } = (window as unknown as any).__vale;
      scene.player.setPosition((3 + 5) * 32 + 16, (5 + 3) * 32 + 16); // 农田内 (5,3)
      world.facing = 'up';
      scene.world.facing = 'up';
      world.inventory['decor:flowerpot'] = 1;
      scene.scene.get('ui').currentQuickItem = 'decor:flowerpot';
    });
    await act(page);
    const st = await page.evaluate(() => (window as unknown as any).__vale.world.decor.length as number);
    expect(st, '农田上不应摆出装饰').toBe(0);
    const bag = await page.evaluate(() => (window as unknown as any).__vale.world.inventory['decor:flowerpot'] as number);
    expect(bag, '被拒绝时不该扣背包').toBe(1);
  });
});

test.describe('集市日', () => {
  test('睡到第 7 天：晨报出现集市日提示', async ({ page }) => {
    await page.evaluate(() => {
      const { world } = (window as unknown as any).__vale;
      world.day = 6;               // 下一晚会进入第 7 天（7 的倍数 = 集市日）
    });
    await page.evaluate(() => new Promise<void>((res) => {
      (window as unknown as any).__vale.scene.sleep(false);
      setTimeout(res, 1500);       // 等 fadeOut / 结算 / fadeIn / 晨报
    }));

    const day = await page.evaluate(() => (window as unknown as any).__vale.world.day as number);
    expect(day).toBe(7);

    const texts = (await panelTexts(page)).join('\n');
    expect(texts, `晨报应提示集市日，实际：${texts}`).toContain('集市日');
  });

  test('集市日的出售页顶部显示倍率；非集市日不显示', async ({ page }) => {
    // 集市日
    await page.evaluate(() => {
      const { world, scene } = (window as unknown as any).__vale;
      world.day = 7;
      world.inventory['crop:radish:norm'] = 1;
      scene.scene.get('ui').openShop('sell');
    });
    await page.waitForTimeout(300);
    const marketTexts = (await panelTexts(page)).join('\n');
    expect(marketTexts, `集市日出售页应有倍率，实际：${marketTexts}`).toContain('集市日');
    expect(marketTexts).toMatch(/×1\.\d+/);

    // 关掉，换到非集市日再看
    await page.evaluate(() => {
      const ui = (window as unknown as any).__vale.scene.scene.get('ui');
      ui.closeTopPanel?.();
      const { world } = (window as unknown as any).__vale;
      world.day = 5;
      ui.openShop('sell');
    });
    await page.waitForTimeout(300);
    const normalTexts = (await panelTexts(page)).join('\n');
    expect(normalTexts, `非集市日不该出现倍率，实际：${normalTexts}`).not.toContain('集市日');
  });
});
