// e2e 回归：挖矿的三道门槛 + 镐子耐久 + 昏倒罚金文案。
//
// 这一批是 0.9.x 之后新增功能的"用户路径"护栏：
// 挖矿（手持 + 耐久）、工具损坏、身无分文时昏倒的文案。
// 全部走"替玩家按动作键"（scene.doAction）或读运行时状态（__vale），不去翻内部实现。

import { expect, test, type Page } from '@playwright/test';

async function waitGame(page: Page, timeout = 30000): Promise<void> {
  await page.waitForFunction(() => !!(window as unknown as { __vale?: unknown }).__vale, null, { timeout });
}

/** 关掉晨报面板（首屏会弹） */
async function closeReport(page: Page): Promise<void> {
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const ui = (window as unknown as any).__vale?.scene?.scene?.get('ui');
    ui?.closeTopPanel?.();
  });
  await page.waitForTimeout(100);
}

/** 站到第一处矿脉的正下方、面朝上（矿脉点位从运行时读，不写死坐标） */
async function standUnderFirstOre(page: Page): Promise<{ x: number; y: number }> {
  const spot = await page.evaluate(() => {
    const { scene, world } = (window as unknown as any).__vale;
    const ore = world.ores[0] as { x: number; y: number };
    scene.player.setPosition(ore.x * 32 + 16, (ore.y + 1) * 32 + 16);
    world.facing = 'up';
    scene.world.facing = 'up';
    return ore;
  });
  return spot;
}

const act = (page: Page) => page.evaluate(() => (window as unknown as any).__vale.scene.doAction());

const miningState = (page: Page) => page.evaluate(() => {
  const { world } = (window as unknown as any).__vale;
  const ui = (window as unknown as any).__vale.scene.scene.get('ui');
  return {
    energy: world.energy as number,
    copper: (world.inventory['ore:copper'] ?? 0) as number,
    iron: (world.inventory['ore:iron'] ?? 0) as number,
    pickaxe: (world.inventory['tool:pickaxe'] ?? 0) as number,
    dur: (world.toolDur['tool:pickaxe'] ?? 0) as number,
    equipped: (ui.currentQuickItemId?.() ?? null) as string | null,
  };
});

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await waitGame(page);
  await closeReport(page);
});

test.describe('挖矿：手持 + 耐久', () => {
  test('没有镐 / 有镐但没拿在手上：都挖不动，且不扣体力', async ({ page }) => {
    await standUnderFirstOre(page);

    // 1) 背包里没有镐
    const before = await miningState(page);
    await act(page);
    const noPick = await miningState(page);
    expect(noPick.copper, '没有镐不该出矿').toBe(0);
    expect(noPick.energy, '没有镐不该扣体力').toBe(before.energy);

    // 2) 把镐塞进背包，但手上还是种子
    await page.evaluate(() => {
      const { world, scene } = (window as unknown as any).__vale;
      world.inventory['tool:pickaxe'] = 1;
      world.toolDur['tool:pickaxe'] = 30;
      const ui = scene.scene.get('ui');
      ui.currentQuickItem = 'seed:radish';
    });
    await act(page);
    const notHeld = await miningState(page);
    expect(notHeld.copper, '没拿在手上不该出矿').toBe(0);
    expect(notHeld.energy, '没拿在手上不该扣体力').toBe(before.energy);
    expect(notHeld.dur, '没拿在手上不该掉耐久').toBe(30);
  });

  test('手持镐：能挖出铜矿，每下扣 1 点耐久', async ({ page }) => {
    await standUnderFirstOre(page);
    await page.evaluate(() => {
      const { world, scene } = (window as unknown as any).__vale;
      world.inventory['tool:pickaxe'] = 1;
      world.toolDur['tool:pickaxe'] = 30;
      scene.scene.get('ui').currentQuickItem = 'tool:pickaxe';
    });

    const before = await miningState(page);
    expect(before.equipped).toBe('tool:pickaxe');

    await act(page);
    const after = await miningState(page);
    expect(after.copper, '挖一下应出 1 个铜矿').toBe(1);
    expect(after.dur, '每挖一下扣 1 点耐久').toBe(29);
    expect(after.energy, '挖矿应扣 6 体力').toBe(before.energy - 6);
  });

  test('耐久归零：镐子当次损坏并从背包消失，之后挖不动', async ({ page }) => {
    await standUnderFirstOre(page);
    await page.evaluate(() => {
      const { world, scene } = (window as unknown as any).__vale;
      world.inventory['tool:pickaxe'] = 1;
      world.toolDur['tool:pickaxe'] = 1;   // 只够最后一下
      scene.scene.get('ui').currentQuickItem = 'tool:pickaxe';
    });

    await act(page);
    const broken = await miningState(page);
    expect(broken.copper, '损坏那一下的产出照常给').toBe(1);
    expect(broken.pickaxe, '镐子应从背包移除').toBe(0);
    expect(broken.dur, '耐久键应被清掉').toBe(0);

    // 再按互动：没有镐了，不能再出矿
    const before = await miningState(page);
    await act(page);
    const after = await miningState(page);
    expect(after.copper).toBe(before.copper);
    expect(after.energy).toBe(before.energy);
  });
});

test.describe('昏倒罚金文案', () => {
  /** 读晨报面板里的所有文本行 */
  const reportTexts = (page: Page) => page.evaluate(() => {
    const ui = (window as unknown as any).__vale.scene.scene.get('ui');
    const panel = ui.activePanel;
    return ((panel?.body?.list ?? []) as any[])
      .map((o) => o?.text)
      .filter((t) => typeof t === 'string') as string[];
  });

  test('金币不足 50：文案说"全掉光了"，金币夹在 0', async ({ page }) => {
    await page.evaluate(() => {
      const { world } = (window as unknown as any).__vale;
      world.gold = 10;
      world.energy = 0;          // 触发昏倒
    });
    // 等 collapse → fadeOut → 结算 → fadeIn → 晨报
    await page.waitForTimeout(1800);

    const gold = await page.evaluate(() => (window as unknown as any).__vale.world.gold as number);
    expect(gold, '金币不能扣成负数').toBe(0);

    const texts = (await reportTexts(page)).join('\n');
    expect(texts, `晨报应说明金币掉光，实际：${texts}`).toContain('金币');
    expect(texts).not.toContain('还丢了 50 金币');
  });

  test('身无分文：文案说"没有金币"', async ({ page }) => {
    await page.evaluate(() => {
      const { world } = (window as unknown as any).__vale;
      world.gold = 0;
      world.energy = 0;
    });
    await page.waitForTimeout(1800);

    const gold = await page.evaluate(() => (window as unknown as any).__vale.world.gold as number);
    expect(gold).toBe(0);

    const texts = (await reportTexts(page)).join('\n');
    expect(texts, `晨报应说明没被罚，实际：${texts}`).toContain('金币');
    expect(texts).not.toContain('还丢了 50 金币');
  });
});
