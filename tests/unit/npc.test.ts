import { describe, expect, it } from 'vitest';
import { giveGift, talk, tierOf } from '../../src/core/npc';
import { createWorld } from '../../src/core/world';

describe('NPC 好感度', () => {
  it('每日首次对话 +2 好感，同一天重复对话不再加', () => {
    const w = createWorld();
    talk(w, 'mira');
    expect(w.npcs.mira.friendship).toBe(2);
    expect(w.npcs.mira.talkedToday).toBe(true);
    talk(w, 'mira');
    expect(w.npcs.mira.friendship).toBe(2);
  });

  it('对话按天轮换：同一天同一句，次日换下一句', () => {
    const w = createWorld();
    w.day = 1;
    const a = talk(w, 'mira').lines[0];
    expect(talk(w, 'mira').lines[0]).toBe(a);
    w.day = 2;
    w.npcs.mira.talkedToday = false;
    const b = talk(w, 'mira').lines[0];
    expect(b).not.toBe(a);
  });

  it('送喜爱作物 +80，普通作物 +30，每天一次', () => {
    const w = createWorld();
    w.inventory['crop:pea:gold'] = 2;
    const r = giveGift(w, 'mira', 'crop:pea:gold'); // 米拉最爱豌豆
    expect(r.ok).toBe(true);
    expect(w.npcs.mira.friendship).toBe(80);
    expect(w.inventory['crop:pea:gold']).toBe(1);
    const r2 = giveGift(w, 'mira', 'crop:pea:gold');
    expect(r2.ok).toBe(false);
  });

  it('好感 100 里程碑：一次性送 10 包种子，不重复领', () => {
    const w = createWorld();
    w.npcs.mira.friendship = 99;
    w.inventory['crop:radish:gold'] = 1;
    giveGift(w, 'mira', 'crop:radish:gold'); // +30 → 129
    expect(w.npcs.mira.reward100).toBe(true);
    expect(w.inventory['seed:radish']).toBe(16); // 初始 6 + 10
    // 再触发一次不该重复发
    const before = w.inventory['seed:radish'];
    talk(w, 'mira');
    expect(w.inventory['seed:radish']).toBe(before);
  });

  it('好感 300 里程碑：一次性 500 金币', () => {
    const w = createWorld();
    w.npcs.mira.friendship = 290;
    w.gold = 100;
    w.inventory['crop:pea:sil'] = 1;
    giveGift(w, 'mira', 'crop:pea:sil');
    expect(w.gold).toBe(600);
    expect(w.npcs.mira.reward300).toBe(true);
  });

  it('等级划分：0-99 初识 / 100-299 朋友 / 300+ 挚友', () => {
    expect(tierOf(0)).toBe(0);
    expect(tierOf(99)).toBe(0);
    expect(tierOf(100)).toBe(1);
    expect(tierOf(300)).toBe(2);
  });
});
