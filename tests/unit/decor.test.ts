// 装饰系统回归（第一步：core 数据与存档层）
// 守四件事：
//   1) 购买/摆放/收回的钱与背包账目对得上，失败路径不扣东西
//   2) 摆放规则：地图内、非农田、单格不重复；收回永远允许
//   3) blocks 语义：挡路的挡，野餐布不挡
//   4) 存档：写入 → reload → 逐字段一致；v3 旧档补空数组；脏档被白名单过滤

import { describe, expect, it } from 'vitest';
import { DECORS } from '../../src/core/data';
import {
  buyDecor, canPlaceDecor, decorAt, decorBlocks, placeDecor, removeDecor,
} from '../../src/core/decor';
import { createWorld } from '../../src/core/world';
import { normalizeWorld, serialize, deserialize } from '../../src/core/save';
import { SAVE_FMT } from '../../src/core/config';
import { TILE } from '../../src/core/generated/tiles.frames';
import { FARM_OX, FARM_OY, MAP_W } from '../../src/core/config';

const POT = 'decor:flowerpot';
const RUG = 'decor:rug';

describe('购买装饰', () => {
  it('扣钱并进背包', () => {
    const w = createWorld();
    const gold0 = w.gold;
    const price = DECORS.find((d) => d.id === POT)!.price;
    const r = buyDecor(w, POT, 2);
    expect(r.ok).toBe(true);
    expect(r.gold).toBe(price * 2);
    expect(w.gold).toBe(gold0 - price * 2);
    expect(w.inventory[POT]).toBe(2);
  });

  it('金币不够 / 未知 id 都不扣钱', () => {
    const w = createWorld();
    w.gold = 1;
    const gold0 = w.gold;
    expect(buyDecor(w, POT).ok).toBe(false);
    expect(w.gold).toBe(gold0);
    expect(w.inventory[POT]).toBeUndefined();
    expect(buyDecor(w, 'decor:dragon').ok).toBe(false);
  });
});

describe('摆放与收回', () => {
  it('摆放：背包 -1、地面 +1', () => {
    const w = createWorld();
    w.inventory[POT] = 1;
    const r = placeDecor(w, POT, 10, 2);
    expect(r.ok).toBe(true);
    expect(w.decor.length).toBe(1);
    expect(w.inventory[POT]).toBeUndefined();
    expect(decorAt(w, 10, 2)?.id).toBe(POT);
  });

  it('越界 / 农田 / 同格重复 / 背包没有 → 全部拒绝且不消耗', () => {
    const w = createWorld();
    w.inventory[POT] = 1;
    expect(canPlaceDecor(w, -1, 0).ok).toBe(false);
    expect(canPlaceDecor(w, MAP_W, 0).ok).toBe(false);
    expect(canPlaceDecor(w, FARM_OX, FARM_OY).ok).toBe(false);        // 农田
    expect(canPlaceDecor(w, FARM_OX, FARM_OY + 1).ok).toBe(false);

    expect(placeDecor(w, POT, -1, 0).ok).toBe(false);
    expect(placeDecor(w, POT, FARM_OX, FARM_OY).ok).toBe(false);
    expect(w.inventory[POT]).toBe(1);                                  // 一次都没花掉

    expect(placeDecor(w, POT, 12, 2).ok).toBe(true);
    expect(placeDecor(w, POT, 12, 2).ok).toBe(false);                  // 同格重复
    expect(w.decor.length).toBe(1);

    expect(placeDecor(w, 'decor:mailbox', 13, 2).ok).toBe(false);      // 背包里没有
  });

  it('收回：回到背包并清掉地面', () => {
    const w = createWorld();
    w.inventory[POT] = 1;
    placeDecor(w, POT, 11, 2);
    const r = removeDecor(w, 11, 2);
    expect(r.ok).toBe(true);
    expect(w.decor.length).toBe(0);
    expect(w.inventory[POT]).toBe(1);
    expect(removeDecor(w, 11, 2).ok).toBe(false);                      // 空格收不到东西
  });

  it('blocks：挡路的挡，野餐布可以踩', () => {
    const w = createWorld();
    w.inventory[POT] = 1;
    w.inventory[RUG] = 1;
    placeDecor(w, POT, 14, 2);
    placeDecor(w, RUG, 15, 2);
    expect(decorBlocks(w, 14, 2)).toBe(true);
    expect(decorBlocks(w, 15, 2)).toBe(false);
    expect(decorBlocks(w, 16, 2)).toBe(false);                         // 空地
  });
});

describe('装饰美术帧', () => {
  it('每件装饰的 tile 名都能在生成的图集里找到（防手写错帧名）', () => {
    for (const d of DECORS) {
      const frame = (TILE as Record<string, number>)[d.tile];
      expect(typeof frame, `图集缺少帧 ${d.tile}`).toBe('number');
    }
  });
});

describe('装饰存档', () => {
  it('写入 → reload → 装饰与背包逐字段一致', () => {
    const w = createWorld();
    w.inventory[POT] = 2;
    w.inventory[RUG] = 1;
    placeDecor(w, POT, 20, 2);
    placeDecor(w, RUG, 21, 2);
    expect(w.inventory[POT]).toBe(1);

    const back = deserialize(serialize(w))!;
    expect(back.fmt).toBe(SAVE_FMT);
    expect(back.decor.length).toBe(2);
    expect(back.decor.find((d) => d.x === 20 && d.y === 2)?.id).toBe(POT);
    expect(back.decor.find((d) => d.x === 21 && d.y === 2)?.id).toBe(RUG);
    expect(back.inventory[POT]).toBe(1);
    expect(back.inventory[RUG]).toBeUndefined();                       // 已摆出去
  });

  it('v3 旧档：补空数组并升到 4', () => {
    const old = normalizeWorld({ fmt: 3, day: 9, inventory: { wood: 2, 'decor:flowerpot': 1 } });
    expect(old.fmt).toBe(SAVE_FMT);
    expect(old.decor).toEqual([]);
    expect(old.inventory['decor:flowerpot']).toBe(1);                  // 白名单放行
  });

  it('脏档：未知 id / 越界坐标 / 重复占格 都被过滤', () => {
    const w = normalizeWorld({
      decor: [
        { id: 'decor:flowerpot', x: 5, y: 5 },
        { id: 'decor:dragon', x: 6, y: 5 },      // 未知 id
        { id: 'decor:mailbox', x: 999, y: 5 },   // 越界
        { id: 'decor:mailbox', x: 5, y: 5 },     // 重复占格
        { id: 'decor:rug' },                     // 缺坐标
        'garbage',
      ],
    });
    expect(w.decor).toEqual([{ id: 'decor:flowerpot', x: 5, y: 5 }]);
  });
});
