// 存档迁移回归（SAVE_FMT 2 → 3 → 4 → 5，共四次结构升级）。
//
// 为什么单独一个文件：这类问题的特征是"不报错、只静默丢数据"。
// 单测里的 save.test.ts 逐字段守的是"当前格式"；这里守的是**每一代旧档**：
//   v1：只有农田/背包/NPC（没有树、没有矿脉、没有装饰、没有耐久）
//   v2：+ 林区树木
//   v3：+ 矿脉与矿石物品
//   v4：+ 可摆放装饰与 decor:<id> 物品
//   v5：+ 工具耐久 toolDur
//
// 每条都验三件事：① 旧字段原样保留 ② 缺的新字段按规则补默认 ③ fmt 升到当前值。

import { describe, expect, it } from 'vitest';
import { normalizeWorld, serialize, deserialize } from '../../src/core/save';
import { SAVE_FMT, ORE_HP, TREE_HP } from '../../src/core/config';
import { ORE_SPOTS, TREE_SPOTS, toolMaxDur } from '../../src/core/data';

type Obj = Record<string, unknown>;

/** v1 的最小旧档：只有农田、背包、NPC、玩家位置 */
function saveV1(extra: Obj = {}): Obj {
  return {
    fmt: 1,
    day: 9,
    minute: 777,
    season: 1,
    weather: 'rain',
    gold: 321,
    energy: 44,
    maxEnergy: 100,
    toolCan: 2,
    toolHoe: 1,
    plots: [{ state: 'tilled', crop: null, obstacle: null }],
    inventory: { 'seed:radish': 3, wood: 2 },
    playerX: 7,
    playerY: 8,
    facing: 'left',
    npcs: { mira: { friendship: 120, giftedToday: false, talkedToday: true, reward100: true, reward300: false } },
    collapsedLastNight: false,
    stats: { earned: 900, harvested: 12, collapsedCount: 1 },
    ...extra,
  };
}

describe('旧档迁移链', () => {
  it('v1 → 5：旧字段保留，树/矿脉/装饰/耐久按规则补齐', () => {
    const w = normalizeWorld(saveV1());

    expect(w.fmt).toBe(SAVE_FMT);
    // 旧字段原样保留
    expect(w.day).toBe(9);
    expect(w.minute).toBe(777);
    expect(w.season).toBe(1);
    expect(w.weather).toBe('rain');
    expect(w.gold).toBe(321);
    expect(w.energy).toBe(44);
    expect(w.toolCan).toBe(2);
    expect(w.facing).toBe('left');
    expect(w.npcs.mira.friendship).toBe(120);
    expect(w.stats.earned).toBe(900);
    // 新结构补默认
    expect(w.trees.length).toBe(TREE_SPOTS.length);
    expect(w.trees.every((t) => t.hp === TREE_HP)).toBe(true);
    expect(w.ores.length).toBe(ORE_SPOTS.length);
    expect(w.ores.every((o) => o.hp === ORE_HP)).toBe(true);
    expect(w.decor).toEqual([]);
    // 旧档里没有镐 → 没有耐久记录
    expect(w.toolDur['tool:pickaxe']).toBeUndefined();
  });

  it('v1 里已经有镐（当年用金币买的）：补满耐久，不让老玩家重做', () => {
    const w = normalizeWorld(saveV1({ inventory: { 'tool:pickaxe': 1, wood: 2 } }));
    expect(w.inventory['tool:pickaxe']).toBe(1);
    expect(w.toolDur['tool:pickaxe']).toBe(toolMaxDur('tool:pickaxe'));
  });

  it('v1 且背包为空（真实老档的常见形态）：不崩、种子不会被凭空塞进来', () => {
    // 真机导出的 v1 档里 inventory 常常是 {}（背包清空 / 早期版本没写背包）
    const w = normalizeWorld(saveV1({ inventory: {} }));
    expect(w.fmt).toBe(SAVE_FMT);
    expect(w.inventory).toEqual({});
    expect(w.trees.length).toBe(TREE_SPOTS.length);
    expect(w.ores.length).toBe(ORE_SPOTS.length);
    expect(w.toolDur).toEqual({});
  });

  it('v2 → 5：树木 hp 原样保留，矿脉补满', () => {
    const trees = TREE_SPOTS.map(([x, y], i) => ({ x, y, hp: i === 0 ? 0 : TREE_HP }));
    const w = normalizeWorld({ ...saveV1({ fmt: 2 }), trees });

    expect(w.fmt).toBe(SAVE_FMT);
    expect(w.trees[0].hp, '砍倒的树读档后不能复活').toBe(0);
    expect(w.trees[1].hp).toBe(TREE_HP);
    expect(w.ores.length).toBe(ORE_SPOTS.length);
    expect(w.decor).toEqual([]);
  });

  it('v3 → 5：挖空的矿脉 hp=0 保留，矿石物品放行，装饰补空', () => {
    const trees = TREE_SPOTS.map(([x, y]) => ({ x, y, hp: TREE_HP }));
    const ores = ORE_SPOTS.map(([x, y], i) => ({ x, y, hp: i === 0 ? 0 : ORE_HP }));
    const w = normalizeWorld({
      ...saveV1({ fmt: 3 }),
      trees,
      ores,
      inventory: { 'ore:copper': 4, 'ore:iron': 1, 'ore:diamond': 9 },
    });

    expect(w.fmt).toBe(SAVE_FMT);
    expect(w.ores[0].hp, '当天挖空的矿脉不能读成满的').toBe(0);
    expect(w.inventory['ore:copper']).toBe(4);
    expect(w.inventory['ore:iron']).toBe(1);
    expect(w.inventory['ore:diamond'], '未知矿石键应被白名单丢掉').toBeUndefined();
    expect(w.decor).toEqual([]);
  });

  it('v4 → 5：已摆装饰保留，decor 物品放行，耐久按背包补满', () => {
    const trees = TREE_SPOTS.map(([x, y]) => ({ x, y, hp: TREE_HP }));
    const ores = ORE_SPOTS.map(([x, y]) => ({ x, y, hp: ORE_HP }));
    const w = normalizeWorld({
      ...saveV1({ fmt: 4 }),
      trees,
      ores,
      decor: [
        { id: 'decor:flowerpot', x: 12, y: 1 },
        { id: 'decor:rug', x: 13, y: 1 },
      ],
      inventory: { 'decor:mailbox': 1, 'tool:pickaxe': 1 },
    });

    expect(w.fmt).toBe(SAVE_FMT);
    expect(w.decor.length).toBe(2);
    expect(w.decor[0]).toEqual({ id: 'decor:flowerpot', x: 12, y: 1 });
    expect(w.inventory['decor:mailbox']).toBe(1);
    expect(w.toolDur['tool:pickaxe']).toBe(toolMaxDur('tool:pickaxe'));
  });

  it('迁移是幂等的：normalize → serialize → normalize 结果一致', () => {
    const once = normalizeWorld(saveV1({
      trees: TREE_SPOTS.map(([x, y]) => ({ x, y, hp: 1 })),
      ores: ORE_SPOTS.map(([x, y]) => ({ x, y, hp: 0 })),
      decor: [{ id: 'decor:scarecrow', x: 20, y: 3 }],
      inventory: { 'tool:pickaxe': 1, 'ore:iron': 2 },
    }));
    const twice = deserialize(serialize(once))!;
    expect(serialize(twice)).toBe(serialize(once));
  });

  it('未来的格式号（比当前大）不会被降级改写数据', () => {
    const w = normalizeWorld({ ...saveV1({ fmt: SAVE_FMT + 3 }), decor: [] });
    expect(w.fmt).toBe(SAVE_FMT);
    expect(w.day).toBe(9);
  });
});
