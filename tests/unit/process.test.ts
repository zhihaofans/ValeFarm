// 加工链（D1）：原料 → 半成品
//
// 这类改动最危险的不是算错数，而是**读档时静默丢物品**：
// normalizeInventory 是白名单正则，忘了放行 mat:* 的话，加工品在存档里看着有、
// reload 之后没了，而且不报任何错。所以这里有一条专门守白名单的用例。

import { describe, expect, it } from 'vitest';
import { itemName, PROCESSES, researchPointsOf } from '../../src/core/data';
import {
  countItem, matEntries, processItem, sellAllMats, sellMat,
} from '../../src/core/economy';
import { deserialize, normalizeWorld, serialize } from '../../src/core/save';
import { createWorld } from '../../src/core/world';

describe('加工链', () => {
  it('木板：木头 ×2 → 木板 ×1，扣料正确', () => {
    const w = createWorld();
    w.inventory = { wood: 3 };
    const r = processItem(w, 'proc:plank');
    expect(r.ok).toBe(true);
    expect(countItem(w.inventory, 'wood')).toBe(1);
    expect(countItem(w.inventory, 'mat:plank')).toBe(1);
  });

  it('金属锭：铜矿石 ×2 + 木头 ×1 → 金属锭 ×1', () => {
    const w = createWorld();
    w.inventory = { 'ore:copper': 4, wood: 2 };
    const r = processItem(w, 'proc:ingot');
    expect(r.ok).toBe(true);
    expect(countItem(w.inventory, 'ore:copper')).toBe(2);
    expect(countItem(w.inventory, 'wood')).toBe(1);
    expect(countItem(w.inventory, 'mat:ingot')).toBe(1);
  });

  it('材料不足时失败，且一点材料都不扣', () => {
    const w = createWorld();
    w.inventory = { 'ore:copper': 1, wood: 0 };
    const r = processItem(w, 'proc:ingot');
    expect(r.ok).toBe(false);
    expect(countItem(w.inventory, 'ore:copper')).toBe(1);
    expect(countItem(w.inventory, 'mat:ingot')).toBe(0);
  });

  it('产物可堆叠：连续加工两次得 2 个木板', () => {
    const w = createWorld();
    w.inventory = { wood: 4 };
    expect(processItem(w, 'proc:plank').ok).toBe(true);
    expect(processItem(w, 'proc:plank').ok).toBe(true);
    expect(countItem(w.inventory, 'mat:plank')).toBe(2);
    expect(countItem(w.inventory, 'wood')).toBe(0);
  });

  it('不存在的配方返回失败，不改背包', () => {
    const w = createWorld();
    w.inventory = { wood: 2 };
    const r = processItem(w, 'proc:nope');
    expect(r.ok).toBe(false);
    expect(countItem(w.inventory, 'wood')).toBe(2);
  });

  it('存档往返：加工品必须活着回来（白名单回归）', () => {
    const w = createWorld();
    w.inventory = { wood: 1, 'mat:plank': 3, 'mat:ingot': 2 };
    const back = deserialize(serialize(w))!;
    expect(countItem(back.inventory, 'mat:plank')).toBe(3);
    expect(countItem(back.inventory, 'mat:ingot')).toBe(2);
    expect(back.fmt).toBe(normalizeWorld({}).fmt);
  });

  it('白名单只放行 mat:(plank|ingot)：脏键被丢弃，合法键保留', () => {
    const w = normalizeWorld({ inventory: { 'mat:plank': 1, 'mat:hack': 9, wood: 2 } });
    expect(countItem(w.inventory, 'mat:plank')).toBe(1);
    expect(w.inventory['mat:hack']).toBeUndefined();
    expect(countItem(w.inventory, 'wood')).toBe(2);
  });

  it('加工品的卖价与展示名', () => {
    expect(itemName('mat:plank')).toBe('木板');
    expect(itemName('mat:ingot')).toBe('金属锭');

    const w = createWorld();
    w.day = 1; // 非集市日，倍率恒为 1
    const gold0 = w.gold; // createWorld 自带初始金币，断言只比增量
    w.inventory = { 'mat:plank': 2, 'mat:ingot': 1 };
    expect(matEntries(w.inventory).map((e) => e.id)).toEqual(['mat:plank', 'mat:ingot']);

    const r = sellMat(w, 'mat:plank', 2);
    expect(r.ok).toBe(true);
    expect(r.gold).toBe(24); // 12 × 2
    expect(countItem(w.inventory, 'mat:plank')).toBe(0);

    const all = sellAllMats(w);
    expect(all.count).toBe(1);
    expect(all.gold).toBe(55);
    expect(w.gold).toBe(gold0 + 24 + 55);
  });

  it('研究分值：加工品必须高于原料合计，否则没人会加工', () => {
    const wood = researchPointsOf('wood');
    const copper = researchPointsOf('ore:copper');
    for (const proc of PROCESSES) {
      const inputPoints = Object.entries(proc.cost)
        .reduce((sum, [id, n]) => sum + researchPointsOf(id) * n, 0);
      expect(researchPointsOf(proc.result)).toBeGreaterThan(inputPoints);
      // 顺便把具体数字钉住，改价/改分配置时会红
      expect(inputPoints).toBeGreaterThan(0);
    }
    expect(researchPointsOf('mat:plank')).toBe(3);
    expect(researchPointsOf('mat:ingot')).toBe(8);
    expect(wood).toBe(1);
    expect(copper).toBe(3);
  });
});
