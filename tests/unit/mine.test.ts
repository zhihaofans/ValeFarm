// 矿脉（挖矿）回归 —— 木镐必须真的有用，矿石必须能出手：
// 1) 固定点位生成、初始满血、存档前挖空状态可复原
// 2) 没有木镐 = 挖不动，且不白扣体力
// 3) 三下挖空：每下 1 铜矿，挖空那一下额外 1 铁矿
// 4) 挖空当天不能再挖，次日清晨回满
// 5) 矿石能按定价卖出，卖完背包不残留 0 值键

import { describe, expect, it } from 'vitest';
import { ENERGY, ORE_HP } from '../../src/core/config';
import { ORE_SPOTS } from '../../src/core/data';
import { mineOre, oreAt, refreshOres } from '../../src/core/mine';
import { oreEntries, sellAllOres, sellOre } from '../../src/core/economy';
import { createWorld } from '../../src/core/world';
import { endDay } from '../../src/core/daycycle';
import { deserialize, serialize } from '../../src/core/save';

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

  it('有木镐：三下挖空，每下 1 铜矿，挖空额外 1 铁矿', () => {
    const w = createWorld();
    w.inventory['tool:pickaxe'] = 1;
    const [x, y] = ORE_SPOTS[0];

    const r1 = mineOre(w, x, y);
    expect(r1.ok).toBe(true);
    expect(r1.depleted).toBeUndefined();
    expect(w.inventory['ore:copper']).toBe(1);
    expect(oreAt(w, x, y)!.hp).toBe(ORE_HP - 1);

    mineOre(w, x, y);
    const r3 = mineOre(w, x, y);
    expect(r3.ok).toBe(true);
    expect(r3.depleted).toBe(true);
    expect(w.inventory['ore:copper']).toBe(3);
    expect(w.inventory['ore:iron']).toBe(1);
    expect(w.energy).toBe(100 - ENERGY.mine * 3);
    // 挖空后不再是可挖的矿脉
    expect(oreAt(w, x, y)).toBeNull();
  });

  it('挖空当天不能再挖，次日清晨回满', () => {
    const w = createWorld();
    w.inventory['tool:pickaxe'] = 1;
    const [x, y] = ORE_SPOTS[0];
    for (let i = 0; i < ORE_HP; i++) mineOre(w, x, y);
    const again = mineOre(w, x, y);
    expect(again.ok).toBe(false);
    expect(w.inventory['ore:copper']).toBe(ORE_HP);

    endDay(w, false);
    expect(oreAt(w, x, y)!.hp).toBe(ORE_HP);
    expect(mineOre(w, x, y).ok).toBe(true);
  });

  it('体力不够时挖不动，也不出矿石', () => {
    const w = createWorld();
    w.inventory['tool:pickaxe'] = 1;
    w.energy = ENERGY.mine - 1;
    const [x, y] = ORE_SPOTS[0];
    const r = mineOre(w, x, y);
    expect(r.ok).toBe(false);
    expect(r.text).toContain('体力');
    expect(oreAt(w, x, y)!.hp).toBe(ORE_HP);
    expect(w.inventory['ore:copper']).toBeUndefined();
  });

  it('refreshOres 把挖空的矿脉全部恢复', () => {
    const w = createWorld();
    for (const o of w.ores) o.hp = 0;
    refreshOres(w);
    expect(w.ores.every((o) => o.hp === ORE_HP)).toBe(true);
  });

  it('挖空状态能存档往返，不会被当成满血', () => {
    const w = createWorld();
    w.inventory['tool:pickaxe'] = 1;
    const [x, y] = ORE_SPOTS[0];
    for (let i = 0; i < ORE_HP; i++) mineOre(w, x, y);
    const back = deserialize(serialize(w))!;
    expect(back.ores.find((o) => o.x === x && o.y === y)!.hp).toBe(0);
    expect(back.inventory['ore:copper']).toBe(ORE_HP);
    expect(back.inventory['ore:iron']).toBe(1);
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
