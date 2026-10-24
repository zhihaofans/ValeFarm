// 矿脉挖矿回归 —— 两道门槛（手持 + 耐久）+ 三道产出：
// 1) 固定点位生成、初始满血、存档前挖空状态可复原
// 2) 没有镐 / 没拿在手上 / 耐久用尽 → 都挖不动，且不白扣体力
// 3) 三下挖空：每下 1 铜矿，挖空那一下额外 1 铁矿
// 4) 每挖一下扣 1 点耐久；归零当次损坏（物品从背包移除），重做一把回满
// 5) 挖空当天不能再挖，次日清晨回满

import { describe, expect, it } from 'vitest';
import { ENERGY, ORE_HP } from '../../src/core/config';
import { ORE_SPOTS, toolMaxDur } from '../../src/core/data';
import { canMine, mineOre, oreAt, refreshOres } from '../../src/core/mine';
import { toolDur, toolUsable } from '../../src/core/tools';
import { craft, oreEntries, sellAllOres, sellOre } from '../../src/core/economy';
import { createWorld } from '../../src/core/world';
import { endDay } from '../../src/core/daycycle';
import { deserialize, serialize } from '../../src/core/save';

const PICK = 'tool:pickaxe';
const PICK_MAX = toolMaxDur(PICK);

/** 给一把满耐久的镐 */
function withPickaxe(w: ReturnType<typeof createWorld>): ReturnType<typeof createWorld> {
  w.inventory[PICK] = 1;
  w.toolDur[PICK] = PICK_MAX;
  return w;
}

describe('矿脉挖矿', () => {
  it('矿脉按固定点位生成，初始满血', () => {
    const w = createWorld();
    expect(w.ores.length).toBe(ORE_SPOTS.length);
    expect(w.ores.every((o) => o.hp === ORE_HP)).toBe(true);
    const [x, y] = ORE_SPOTS[0];
    expect(oreAt(w, x, y)!.hp).toBe(ORE_HP);
  });

  it('没有木镐挖不动，也不扣体力、不出矿石', () => {
    const w = createWorld();
    const [x, y] = ORE_SPOTS[0];
    const r = mineOre(w, x, y);
    expect(r.ok).toBe(false);
    expect(r.text).toContain('木镐');
    expect(w.energy).toBe(100);
    expect(oreAt(w, x, y)!.hp).toBe(ORE_HP);
    expect(w.inventory['ore:copper']).toBeUndefined();
  });

  it('有镐但没拿在手上：canMine 拒绝，且不给"背包里没有"的错文案', () => {
    const w = withPickaxe(createWorld());
    const notHeld = canMine(w, null);
    expect(notHeld.ok).toBe(false);
    expect(notHeld.text).toContain('拿在手上');

    expect(canMine(w, 'seed:radish').ok).toBe(false);
    expect(canMine(w, PICK).ok).toBe(true);
  });

  it('有木镐：三下挖空，每下 1 铜矿，挖空额外 1 铁矿；每下扣 1 耐久', () => {
    const w = withPickaxe(createWorld());
    const [x, y] = ORE_SPOTS[0];

    const r1 = mineOre(w, x, y);
    expect(r1.ok).toBe(true);
    expect(r1.depleted).toBeUndefined();
    expect(w.inventory['ore:copper']).toBe(1);
    expect(toolDur(w, PICK)).toBe(PICK_MAX - 1);
    expect(oreAt(w, x, y)!.hp).toBe(ORE_HP - 1);

    mineOre(w, x, y);
    const r3 = mineOre(w, x, y);
    expect(r3.ok).toBe(true);
    expect(r3.depleted).toBe(true);
    expect(w.inventory['ore:copper']).toBe(3);
    expect(w.inventory['ore:iron']).toBe(1);
    expect(w.energy).toBe(100 - ENERGY.mine * 3);
    expect(toolDur(w, PICK)).toBe(PICK_MAX - 3);
    expect(oreAt(w, x, y)).toBeNull();
  });

  it('耐久归零：当次损坏，镐子从背包移除，之后挖不动', () => {
    const w = withPickaxe(createWorld());
    w.toolDur[PICK] = 1;                       // 只够最后一下
    const [x, y] = ORE_SPOTS[0];
    const r = mineOre(w, x, y);
    expect(r.ok).toBe(true);
    expect(r.pickaxeBroken).toBe(true);
    expect(w.inventory[PICK]).toBeUndefined();
    expect(w.toolDur[PICK]).toBeUndefined();
    expect(toolUsable(w, PICK)).toBe(false);

    // 镐子已经没了，此时给的是"需要木镐"（比"用坏了"更可操作：直接告诉玩家去做一把）
    const again = mineOre(w, x, y);
    expect(again.ok).toBe(false);
    expect(again.text).toContain('木镐');
    expect(canMine(w, PICK).ok).toBe(false);
  });

  it('制作台重做一把：耐久回满', () => {
    const w = createWorld();
    w.inventory.wood = 3;
    const r = craft(w, 'recipe:pickaxe');
    expect(r.ok).toBe(true);
    expect(w.inventory[PICK]).toBe(1);
    expect(toolDur(w, PICK)).toBe(PICK_MAX);
    expect(canMine(w, PICK).ok).toBe(true);
  });

  it('挖空当天不能再挖，次日清晨回满', () => {
    const w = withPickaxe(createWorld());
    const [x, y] = ORE_SPOTS[0];
    for (let i = 0; i < ORE_HP; i++) mineOre(w, x, y);
    const again = mineOre(w, x, y);
    expect(again.ok).toBe(false);
    expect(w.inventory['ore:copper']).toBe(ORE_HP);

    endDay(w, false);
    expect(oreAt(w, x, y)!.hp).toBe(ORE_HP);
    expect(mineOre(w, x, y).ok).toBe(true);
  });

  it('体力不够时挖不动，也不出矿石、不掉耐久', () => {
    const w = withPickaxe(createWorld());
    w.energy = ENERGY.mine - 1;
    const [x, y] = ORE_SPOTS[0];
    const r = mineOre(w, x, y);
    expect(r.ok).toBe(false);
    expect(r.text).toContain('体力');
    expect(oreAt(w, x, y)!.hp).toBe(ORE_HP);
    expect(w.inventory['ore:copper']).toBeUndefined();
    expect(toolDur(w, PICK)).toBe(PICK_MAX);   // 没使劲就不磨损
  });

  it('refreshOres 把挖空的矿脉全部恢复', () => {
    const w = createWorld();
    for (const o of w.ores) o.hp = 0;
    refreshOres(w);
    expect(w.ores.every((o) => o.hp === ORE_HP)).toBe(true);
  });

  it('挖空状态与耐久都能存档往返', () => {
    const w = withPickaxe(createWorld());
    const [x, y] = ORE_SPOTS[0];
    for (let i = 0; i < ORE_HP; i++) mineOre(w, x, y);
    const back = deserialize(serialize(w))!;
    expect(back.ores.find((o) => o.x === x && o.y === y)!.hp).toBe(0);
    expect(back.inventory['ore:copper']).toBe(ORE_HP);
    expect(back.inventory['ore:iron']).toBe(1);
    expect(back.toolDur[PICK]).toBe(PICK_MAX - ORE_HP);
  });
});

describe('矿石卖出', () => {
  it('铜/铁矿按定价结算，卖完背包键不残留', () => {
    const w = createWorld();
    w.inventory['ore:copper'] = 2;
    w.inventory['ore:iron'] = 1;
    const gold0 = w.gold;

    const r = sellOre(w, 'ore:copper', 1);
    expect(r.ok).toBe(true);
    expect(r.gold).toBe(22);
    expect(w.gold).toBe(gold0 + 22);
    expect(w.inventory['ore:copper']).toBe(1);

    const rest = sellAllOres(w);
    expect(rest.count).toBe(2);
    expect(rest.gold).toBe(22 + 58);
    expect(w.inventory['ore:copper']).toBeUndefined();
    expect(w.inventory['ore:iron']).toBeUndefined();
    expect(oreEntries(w.inventory).length).toBe(0);
  });

  it('没有矿石时卖出失败，金币不变', () => {
    const w = createWorld();
    const gold0 = w.gold;
    const r = sellOre(w, 'ore:iron', 1);
    expect(r.ok).toBe(false);
    expect(w.gold).toBe(gold0);
  });
});
