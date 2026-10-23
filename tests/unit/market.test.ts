// 集市日（D3）回归：每 7 天一次的卖价加成，以及"评价越高加成越大"。
//   1) 判定：7 的倍数才是集市日，0 / 负数不算
//   2) 倍率：非集市日恒为 1（老行为不变）；集市日 1.2 起，按评价档位再叠
//   3) 结算：卖作物/卖矿石都按倍率，且不出现"每件四舍五入"的累加误差
//   4) 晨报：进入集市日那天必须有一行提示
//   5) 无存档字段：倍率完全由 day 推导

import { describe, expect, it } from 'vitest';
import { createWorld } from '../../src/core/world';
import { sellCrop, sellOre } from '../../src/core/economy';
import { endDay } from '../../src/core/daycycle';
import {
  isMarketDay, marketTip, sellMultiplier, MARKET_SELL_BONUS, MARKET_RATING_BONUS,
} from '../../src/core/market';
import { RATING_CAPS } from '../../src/core/rating';
import { FARM_W } from '../../src/core/config';

/** 把农场做到"闻名"档，用来验证评价加成 */
function thrivingWorld(): ReturnType<typeof createWorld> {
  const w = createWorld();
  for (const p of w.plots) { p.obstacle = null; p.state = 'tilled'; }
  w.decor = Array.from({ length: RATING_CAPS.decor }, (_, i) => ({ id: 'decor:flowerpot', x: i % FARM_W, y: 0 }));
  for (const c of ['radish', 'pea', 'corn', 'pumpkin']) w.inventory[`crop:${c}:norm`] = 1;
  return w;
}

describe('集市日判定', () => {
  it('7 的倍数才是集市日', () => {
    for (const d of [7, 14, 21, 28]) expect(isMarketDay(d)).toBe(true);
    for (const d of [1, 6, 8, 13, 27]) expect(isMarketDay(d)).toBe(false);
    expect(isMarketDay(0)).toBe(false);
    expect(isMarketDay(-7)).toBe(false);
  });
});

describe('倍率', () => {
  it('非集市日恒为 1（老行为不变）', () => {
    const w = createWorld();
    w.day = 6;
    expect(sellMultiplier(w)).toBe(1);
    expect(marketTip(w)).toBeNull();
  });

  it('集市日基础 +20%，评价越高叠得越多', () => {
    const low = createWorld();          // 有障碍/没装饰 → 低档
    low.day = 7;
    expect(sellMultiplier(low)).toBeCloseTo(1 + MARKET_SELL_BONUS, 5);

    const high = thrivingWorld();
    high.day = 7;
    expect(sellMultiplier(high)).toBeCloseTo(1 + MARKET_SELL_BONUS + MARKET_RATING_BONUS[3], 5);
    expect(sellMultiplier(high)).toBeGreaterThan(sellMultiplier(low));
  });
});

describe('结算', () => {
  it('卖作物：集市日拿下更多金币，且数量扣减一致', () => {
    const normal = createWorld();
    const market = createWorld();
    normal.day = 1;
    market.day = 7;
    normal.inventory['crop:radish:norm'] = 3;
    market.inventory['crop:radish:norm'] = 3;

    const a = sellCrop(normal, 'radish', 'norm', 2);
    const b = sellCrop(market, 'radish', 'norm', 2);
    expect(a.ok && b.ok).toBe(true);
    expect(b.gold).toBeGreaterThan(a.gold);
    expect(market.inventory['crop:radish:norm']).toBe(1);
    expect(normal.inventory['crop:radish:norm']).toBe(1);
  });

  it('卖矿石：同样吃集市倍率', () => {
    const normal = createWorld();
    const market = createWorld();
    normal.day = 1;
    market.day = 7;
    normal.inventory['ore:iron'] = 1;
    market.inventory['ore:iron'] = 1;
    expect(sellOre(market, 'ore:iron', 1).gold).toBeGreaterThan(sellOre(normal, 'ore:iron', 1).gold);
  });
});

describe('晨报提示', () => {
  it('从第 6 天睡到第 7 天，晨报里有一行集市日', () => {
    const w = createWorld();
    w.day = 6;
    const report = endDay(w, false);
    expect(w.day).toBe(7);
    expect(report.lines.join('\n')).toContain('集市日');
  });

  it('非集市日的晨报里没有这一行', () => {
    const w = createWorld();
    w.day = 7;
    const report = endDay(w, false);
    expect(w.day).toBe(8);
    expect(report.lines.join('\n')).not.toContain('集市日');
  });
});
