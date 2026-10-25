// 存档层回归 —— 这是本项目「静默丢档」的头号防线：
// 1) 脏数据 normalize 后不会炸、字段全部回落正确值
// 2) 写入 → 反序列化 → 每个登记字段（含嵌套）都还在
// 3) 老格式档能迁移（未来 SAVE_FMT 提升后在这里加用例）
// 4) 导出文件能原样导入

import { describe, expect, it } from 'vitest';
import {
  deserialize, exportSave, importSave, normalizeWorld, serialize,
} from '../../src/core/save';
import { createWorld } from '../../src/core/world';
import { FARM_W, SAVE_FMT } from '../../src/core/config';
import { ORE_SPOTS, toolMaxDur } from '../../src/core/data';

describe('存档 normalize', () => {
  it('空档/垃圾输入回落到可用的新世界，不抛异常', () => {
    for (const bad of [null, undefined, 123, 'garbage', { fmt: 'x', day: 'abc' }]) {
      const w = normalizeWorld(bad);
      expect(w.day).toBeGreaterThanOrEqual(1);
      expect(w.plots.length).toBe(120);
    }
  });

  it('新游戏档必须带上初始种子背包（e2e 抓出过的回归：normalize 丢初始背包）', () => {
    const w = normalizeWorld(null);
    expect(w.inventory['seed:radish']).toBe(6);
  });

  it('逐字段往返：每个登记字段（含嵌套）都必须一致', () => {
    const w = createWorld();
    // 造一个"满"的世界：所有字段都填上非默认值
    w.day = 42;
    w.minute = 777;
    w.gold = 9876;
    w.energy = 55;
    w.maxEnergy = 120;
    w.season = 2;
    w.weather = 'rain';
    w.toolCan = 2;
    w.toolHoe = 2;
    w.playerX = 10;
    w.playerY = 11;
    w.facing = 'up';
    w.collapsedLastNight = true;
    w.inventory = { 'seed:corn': 3, 'crop:pea:gold': 5, 'tool:can2': 1 };
    w.npcs.mira = { friendship: 321, giftedToday: true, talkedToday: false, reward100: true, reward300: false };
    w.stats = { earned: 1111, harvested: 22, collapsedCount: 2 };
    w.plots[5] = { state: 'watered', crop: { type: 'corn', stage: 2, progress: 1, dryDays: 3, wateredToday: true, withered: false }, obstacle: null };
    w.plots[6] = { state: 'wild', crop: null, obstacle: 'stump' };

    const back = deserialize(serialize(w))!;
    // 顶层标量
    expect(back.day).toBe(42);
    expect(back.minute).toBe(777);
    expect(back.gold).toBe(9876);
    expect(back.energy).toBe(55);
    expect(back.maxEnergy).toBe(120);
    expect(back.season).toBe(2);
    expect(back.weather).toBe('rain');
    expect(back.toolCan).toBe(2);
    expect(back.toolHoe).toBe(2);
    expect(back.playerX).toBe(10);
    expect(back.playerY).toBe(11);
    expect(back.facing).toBe('up');
    expect(back.collapsedLastNight).toBe(true);
    // 背包（多键）
    expect(back.inventory['seed:corn']).toBe(3);
    expect(back.inventory['crop:pea:gold']).toBe(5);
    // NPC 嵌套字段 —— 只断言顶层会漏掉子字段
    expect(back.npcs.mira.friendship).toBe(321);
    expect(back.npcs.mira.giftedToday).toBe(true);
    expect(back.npcs.mira.reward100).toBe(true);
    // stats 子字段
    expect(back.stats.earned).toBe(1111);
    expect(back.stats.harvested).toBe(22);
    expect(back.stats.collapsedCount).toBe(2);
    // 地块嵌套：state / crop 全部子字段 / obstacle
    expect(back.plots[5].state).toBe('watered');
    expect(back.plots[5].crop!.type).toBe('corn');
    expect(back.plots[5].crop!.stage).toBe(2);
    expect(back.plots[5].crop!.progress).toBe(1);
    expect(back.plots[5].crop!.dryDays).toBe(3);
    expect(back.plots[5].crop!.wateredToday).toBe(true);
    expect(back.plots[5].crop!.withered).toBe(false);
    expect(back.plots[6].obstacle).toBe('stump');
  });

  it('脏值不穿透：越界数字/非法枚举回落默认值', () => {
    const w = normalizeWorld({
      day: -5, minute: 99999, gold: Infinity, energy: NaN,
      weather: 'typhoon', facing: 'sideways', toolCan: 9,
      inventory: { 'seed:hack': 5, 'crop:radish:gold': -3, 'crop:corn:sil': 2 },
      plots: [{ state: 'lava', crop: { type: 'dragon' }, obstacle: 'ufo' }],
    });
    expect(w.day).toBe(1);
    expect(w.minute).toBe(360); // 越界分钟回落起床时间
    expect(w.gold).toBe(150);   // Infinity 视为缺失，回落初始金币
    expect(w.gold).toBe(150);
    expect(w.energy).toBe(100);
    expect(w.weather).toBe('sun');
    expect(w.facing).toBe('down');
    expect(w.toolCan).toBe(1);
    expect(w.inventory).toEqual({ 'crop:corn:sil': 2 });
    expect(w.plots[0].state).toBe('wild');
    expect(w.plots[0].crop).toBeNull();
    expect(w.plots[0].obstacle).toBeNull();
    expect(w.plots.length).toBe(FARM_W * 10);
  });

  it('plots 截断/缺失时补齐，不崩溃', () => {
    const w = normalizeWorld({ plots: [] });
    expect(w.plots.length).toBe(120);
  });

  it('season 脏值归一化到 0..3 的整数', () => {
    expect(normalizeWorld({ season: 2.5 }).season).toBe(2);
    expect(normalizeWorld({ season: -1 }).season).toBe(3);
  });

  it('新作物草莓/红薯在 normalize 中登记，不静默丢档', () => {
    const w = normalizeWorld({
      inventory: { 'seed:strawberry': 2, 'crop:sweetpotato:sil': 1 },
      plots: [{
        state: 'tilled',
        crop: { type: 'strawberry', stage: 1, progress: 1, dryDays: 0, wateredToday: true, withered: false },
        obstacle: null,
      }],
    });
    expect(w.inventory['seed:strawberry']).toBe(2);
    expect(w.inventory['crop:sweetpotato:sil']).toBe(1);
    expect(w.plots[0].crop?.type).toBe('strawberry');
    expect(w.plots[0].crop?.stage).toBe(1);
  });

  it('林区树木 hp、木头和木镐都能存档往返；老档补默认树', () => {
    const w = createWorld();
    w.trees[0].hp = 1;
    w.inventory.wood = 4;
    w.inventory['tool:pickaxe'] = 1;
    const back = deserialize(serialize(w))!;
    expect(back.trees[0].hp).toBe(1);
    expect(back.inventory.wood).toBe(4);
    expect(back.inventory['tool:pickaxe']).toBe(1);

    const old = normalizeWorld({ fmt: 1, day: 3 });
    expect(old.trees.length).toBe(12);
    expect(old.trees.every((t) => t.hp === 3)).toBe(true);
  });

  it('林区矿脉与矿石都能存档往返；v2 旧档按固定点位补矿脉', () => {
    const w = createWorld();
    w.ores[0].hp = 1;
    w.ores[1].hp = 0; // 挖空当天
    w.inventory['ore:copper'] = 4;
    w.inventory['ore:iron'] = 2;
    const back = deserialize(serialize(w))!;
    expect(back.ores.length).toBe(ORE_SPOTS.length);
    expect(back.ores[0].hp).toBe(1);
    expect(back.ores[1].hp).toBe(0);
    expect(back.inventory['ore:copper']).toBe(4);
    expect(back.inventory['ore:iron']).toBe(2);

    // v2 档（有树、没矿脉）补满矿脉，矿石键仍按白名单放行
    const old = normalizeWorld({ fmt: 2, day: 3, inventory: { wood: 2, 'ore:copper': 1, 'ore:diamond': 9 } });
    expect(old.fmt).toBe(SAVE_FMT);
    expect(old.ores.length).toBe(ORE_SPOTS.length);
    expect(old.ores.every((o) => o.hp === 3)).toBe(true);
    expect(old.inventory['ore:copper']).toBe(1);
    expect(old.inventory['ore:diamond']).toBeUndefined();
  });

  it('工具耐久：往返保留、旧档补满、脏值夹取、耐久 0 的工具被移出背包', () => {
    const PICK = 'tool:pickaxe';
    const MAX = toolMaxDur(PICK);

    // 往返
    const w = createWorld();
    w.inventory[PICK] = 1;
    w.toolDur[PICK] = 7;
    const back = deserialize(serialize(w))!;
    expect(back.toolDur[PICK]).toBe(7);

    // 旧档（有镐、没有 toolDur）：补满，不让老玩家突然要重做
    const old = normalizeWorld({ fmt: 4, inventory: { 'tool:pickaxe': 1 } });
    expect(old.fmt).toBe(SAVE_FMT);
    expect(old.toolDur[PICK]).toBe(MAX);

    // 旧档（没有镐）：空映射
    const noTool = normalizeWorld({ fmt: 4, inventory: { wood: 1 } });
    expect(noTool.toolDur[PICK]).toBeUndefined();

    // 脏值：超上限、负数、非数字
    expect(normalizeWorld({ toolDur: { 'tool:pickaxe': 999 } }).toolDur[PICK]).toBe(MAX);
    expect(normalizeWorld({ toolDur: { 'tool:pickaxe': -3 }, inventory: { 'tool:pickaxe': 1 } }).toolDur[PICK]).toBeUndefined();
    expect(normalizeWorld({ toolDur: { 'tool:pickaxe': 'x' }, inventory: { 'tool:pickaxe': 1 } }).toolDur[PICK]).toBe(MAX);

    // 未知工具 id 一律丢弃
    expect(normalizeWorld({ toolDur: { 'tool:dragon': 5 } }).toolDur).toEqual({});

    // 不变量：耐久 0 却有物品 → 物品被移除
    const broken = normalizeWorld({ toolDur: { 'tool:pickaxe': 0 }, inventory: { 'tool:pickaxe': 1 } });
    expect(broken.inventory[PICK]).toBeUndefined();
  });

  it('玩家坐标会夹到地图内，y=-1 不会读档后卡在空气墙', () => {
    const w = normalizeWorld({ playerX: 13, playerY: -1 });
    expect(w.playerX).toBe(13);
    expect(w.playerY).toBe(0);
    const far = normalizeWorld({ playerX: -5, playerY: 999 });
    expect(far.playerX).toBe(0);
    expect(far.playerY).toBe(15);
  });

  it('非法存档 JSON 返回 null（不白屏）', () => {
    expect(deserialize('{not json')).toBeNull();
    expect(importSave('nonsense')).toBeNull();
  });
});

describe('导出 / 导入', () => {
  it('导出文件头部带版本与时间，可原样导入还原', () => {
    const w = createWorld();
    w.day = 9;
    w.gold = 1234;
    w.inventory['crop:pumpkin:sil'] = 4;
    const text = exportSave(w);
    expect(JSON.parse(text).app).toBe('vale-farm');
    const back = importSave(text)!;
    expect(back.day).toBe(9);
    expect(back.gold).toBe(1234);
    expect(back.inventory['crop:pumpkin:sil']).toBe(4);
  });

  it('别的游戏的存档（app 不是 vale-farm）一律拒绝，不静默变成空农场', () => {
    const foreign = JSON.stringify({ app: 'another-game', fmt: 11, data: { day: 9, gold: 500 } });
    expect(importSave(foreign)).toBeNull();
    // 旧版裸 World 没有 app 字段 → 仍按原逻辑接收
    const bare = JSON.stringify({ day: 4, gold: 20 });
    expect(importSave(bare)?.day).toBe(4);
  });

  it('导入裸 World（旧版手工备份）也能识别', () => {
    const w = createWorld();
    w.day = 3;
    const back = importSave(JSON.stringify(w))!;
    expect(back.day).toBe(3);
  });
});
