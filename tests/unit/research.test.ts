// 研究/知识点（D2）回归：
//   1) 能研究的物品与分值；不支持研究的物品拒绝且不扣东西
//   2) 研究消耗 1 个、知识点累加；背包没有时拒绝
//   3) 兑换：金币无关，只认知识点；已兑换不能重复；工具已有的不能再换
//   4) 体力上限兑换会给现有体力也补上这 10 点
//   5) 存档往返：knowledge / unlocked；旧档缺失回落 0 与 []
//   6) 脏档：未知解锁 id 被过滤、知识点负数归零

import { describe, expect, it } from 'vitest';
import { createWorld } from '../../src/core/world';
import {
  canResearch, isUnlocked, redeemKnowledge, researchItem, researchableEntries,
} from '../../src/core/research';
import { KNOWLEDGE_SHOP, researchPointsOf } from '../../src/core/data';
import { deserialize, normalizeWorld, serialize } from '../../src/core/save';
import { SAVE_FMT } from '../../src/core/config';

describe('研究物品', () => {
  it('分值与白名单对得上', () => {
    expect(canResearch('wood').points).toBe(1);
    expect(canResearch('ore:iron').points).toBe(6);
    expect(canResearch('crop:radish:gold').points).toBe(4);
    expect(canResearch('crop:radish:norm').points).toBe(2);
    // 工具/种子/装饰不可研究：避免"把刚买的镐子研究没了"
    expect(canResearch('tool:pickaxe').ok).toBe(false);
    expect(canResearch('seed:radish').ok).toBe(false);
    expect(canResearch('decor:flowerpot').ok).toBe(false);
  });

  it('研究消耗 1 个并累加知识点；没有时拒绝且不扣', () => {
    const w = createWorld();
    w.inventory['ore:iron'] = 2;

    const r1 = researchItem(w, 'ore:iron');
    expect(r1.ok).toBe(true);
    expect(r1.gained).toBe(6);
    expect(w.knowledge).toBe(6);
    expect(w.inventory['ore:iron']).toBe(1);

    const r2 = researchItem(w, 'ore:iron');
    expect(r2.ok).toBe(true);
    expect(w.knowledge).toBe(12);
    expect(w.inventory['ore:iron']).toBeUndefined();

    const r3 = researchItem(w, 'ore:iron');
    expect(r3.ok).toBe(false);
    expect(w.knowledge).toBe(12);
  });

  it('researchableEntries 只列可研究的，按分值降序', () => {
    const w = createWorld();
    w.inventory['wood'] = 3;
    w.inventory['ore:iron'] = 1;
    w.inventory['tool:pickaxe'] = 1;
    const list = researchableEntries(w.inventory);
    expect(list.map((e) => e.id)).toEqual(['ore:iron', 'wood']);
  });
});

describe('知识点兑换', () => {
  it('知识点不够时拒绝，且不扣点', () => {
    const w = createWorld();
    w.knowledge = 10;
    const item = KNOWLEDGE_SHOP.find((k) => k.id === 'kn:hoe2')!;
    const r = redeemKnowledge(w, 'kn:hoe2');
    expect(r.ok).toBe(false);
    expect(r.text).toContain('知识点不够');
    expect(w.knowledge).toBe(10);
    expect(w.toolHoe).toBe(1);
    expect(item.cost).toBeGreaterThan(0);
  });

  it('兑换铜锄头：扣知识点、工具升级、记录已解锁、不能重复', () => {
    const w = createWorld();
    w.knowledge = 40;
    const r = redeemKnowledge(w, 'kn:hoe2');
    expect(r.ok).toBe(true);
    expect(w.toolHoe).toBe(2);
    expect(w.knowledge).toBe(0);
    expect(isUnlocked(w, 'kn:hoe2')).toBe(true);

    const again = redeemKnowledge(w, 'kn:hoe2');
    expect(again.ok).toBe(false);
    expect(again.text).toContain('已经兑换过');
  });

  it('体力上限 +10：连现有体力一起补上', () => {
    const w = createWorld();
    w.knowledge = 50;
    w.maxEnergy = 100;
    w.energy = 30;
    const r = redeemKnowledge(w, 'kn:stamina');
    expect(r.ok).toBe(true);
    expect(w.maxEnergy).toBe(110);
    expect(w.energy).toBe(40);
  });

  it('已经有铜锄头时不能再用知识点换（避免白花）', () => {
    const w = createWorld();
    w.knowledge = 100;
    w.toolHoe = 2;
    const r = redeemKnowledge(w, 'kn:hoe2');
    expect(r.ok).toBe(false);
    expect(w.knowledge).toBe(100);
  });
});

describe('研究点存档', () => {
  it('knowledge / unlocked 往返一致', () => {
    const w = createWorld();
    w.knowledge = 37;
    w.unlocked = ['kn:hoe2'];
    const back = deserialize(serialize(w))!;
    expect(back.fmt).toBe(SAVE_FMT);
    expect(back.knowledge).toBe(37);
    expect(back.unlocked).toEqual(['kn:hoe2']);
  });

  it('v5 旧档：knowledge 回落 0、unlocked 空数组', () => {
    const w = normalizeWorld({ fmt: 5, day: 3 });
    expect(w.fmt).toBe(SAVE_FMT);
    expect(w.knowledge).toBe(0);
    expect(w.unlocked).toEqual([]);
  });

  it('脏档：负数归零、未知 id 过滤、重复去重', () => {
    const w = normalizeWorld({
      knowledge: -50,
      unlocked: ['kn:hoe2', 'kn:hoe2', 'kn:dragon', 42, 'kn:stamina'],
    });
    expect(w.knowledge).toBe(0);
    expect(w.unlocked).toEqual(['kn:hoe2', 'kn:stamina']);
  });

  it('研究点分值与 KNOWLEDGE_SHOP 成本可读（防手滑写成 0）', () => {
    for (const k of KNOWLEDGE_SHOP) expect(k.cost).toBeGreaterThan(0);
    expect(researchPointsOf('wood')).toBeGreaterThan(0);
  });
});
