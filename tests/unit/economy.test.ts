import { describe, expect, it } from 'vitest';
import { doHoe, doPlant, doHarvest } from '../../src/core/actions';
import {
  buySeed, buyToolUpgrade, craft, cropEntries, sellAllCrops, sellCrop, seasonSeeds,
} from '../../src/core/economy';
import { sellPrice, dailySeedSpecial } from '../../src/core/data';
import { createWorld } from '../../src/core/world';

describe('经济', () => {
  it('品质售价：普通/银星 1.5 倍/金星 2 倍', () => {
    expect(sellPrice('radish', 'norm')).toBe(45);
    expect(sellPrice('radish', 'sil')).toBe(68); // round(45*1.5)
    expect(sellPrice('radish', 'gold')).toBe(90);
  });

  it('商店按季节出售种子：春有豌豆/草莓、秋有南瓜/红薯、冬只有四季萝卜', () => {
    expect(seasonSeeds(0)).toContain('pea');
    expect(seasonSeeds(0)).toContain('strawberry');
    expect(seasonSeeds(0)).not.toContain('pumpkin');
    expect(seasonSeeds(1)).toContain('corn');
    expect(seasonSeeds(2)).toContain('pumpkin');
    expect(seasonSeeds(2)).toContain('sweetpotato');
    expect(seasonSeeds(3)).toEqual(['radish']);
  });

  it('每日特价按天轮换当季种子，8 折', () => {
    expect(dailySeedSpecial(0, 1)).toMatchObject({ crop: 'radish', price: 16 });
    expect(dailySeedSpecial(0, 2)).toMatchObject({ crop: 'pea', price: 28 });
    expect(dailySeedSpecial(0, 3)).toMatchObject({ crop: 'strawberry', price: 32 });
    expect(dailySeedSpecial(0, 4)?.crop).toBe('radish');
    expect(dailySeedSpecial(2, 1)).toMatchObject({ crop: 'radish', price: 16 });
  });

  it('买种子扣金币入背包，钱不够买不到', () => {
    const w = createWorld();
    w.day = 2; // 春季第 2 天特价是豌豆，萝卜按原价 20G
    w.gold = 50;
    const r = buySeed(w, 'pumpkin', 1); // 90G
    expect(r.ok).toBe(false);
    const r2 = buySeed(w, 'radish', 2); // 40G
    expect(r2.ok).toBe(true);
    expect(w.gold).toBe(10);
    expect(w.inventory['seed:radish']).toBe(6 + 2);
  });

  it('买当日特价种子按 8 折扣钱', () => {
    const w = createWorld();
    w.day = 1;
    w.gold = 50;
    const r = buySeed(w, 'radish', 1);
    expect(r.ok).toBe(true);
    expect(r.text).toContain('今日特价');
    expect(w.gold).toBe(34);
  });

  it('卖出作物结算金币并计入统计', () => {
    const w = createWorld();
    w.inventory['crop:corn:gold'] = 2;
    const r = sellCrop(w, 'corn', 'gold', 2);
    expect(r.gold).toBe(480); // 120*2
    expect(w.gold).toBe(150 + 480);
    expect(w.stats.earned).toBe(480);
    expect(w.inventory['crop:corn:gold']).toBeUndefined();
  });

  it('全部卖出清空作物背包', () => {
    const w = createWorld();
    doHoe(w, 0, 3);
    doPlant(w, 0, 3, 'radish');
    const p = w.plots[3 * 12 + 0]; // y=3, x=0
    p.crop!.stage = 3;
    const r = doHarvest(w, 0, 3);
    expect(r.ok).toBe(true);
    expect(cropEntries(w.inventory).length).toBe(1);
    const all = sellAllCrops(w);
    expect(all.count).toBe(1);
    expect(cropEntries(w.inventory).length).toBe(0);
  });

  it('工具升级只能买一次并生效', () => {
    const w = createWorld();
    w.gold = 5000;
    expect(buyToolUpgrade(w, 'tool:can2').ok).toBe(true);
    expect(w.toolCan).toBe(2);
    expect(buyToolUpgrade(w, 'tool:can2').ok).toBe(false);
    expect(w.gold).toBe(4200);
  });

  it('制作台：3 木头做木镐，材料不足/重复制作会失败', () => {
    const w = createWorld();
    expect(craft(w, 'recipe:pickaxe').ok).toBe(false);
    w.inventory.wood = 3;
    const r = craft(w, 'recipe:pickaxe');
    expect(r.ok).toBe(true);
    expect(w.inventory.wood).toBeUndefined();
    expect(w.inventory['tool:pickaxe']).toBe(1);
    expect(craft(w, 'recipe:pickaxe').ok).toBe(false);
  });
});
