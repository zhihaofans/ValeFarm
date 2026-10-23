// 集市日：每 7 天一次，当天卖价加成；农场评价越高，额外加成越大。
// 纯函数，不读时间不读随机 —— 由 World.day 推导，因此**不需要新存档字段**。

import { rating } from './rating';
import type { World } from './types';

/** 每隔几天一次集市（28 天一季 → 每季 4 次，跨季不断档） */
export const MARKET_INTERVAL = 7;
/** 集市日基础加成：卖价 +20% */
export const MARKET_SELL_BONUS = 0.2;
/** 按农场评价档位（荒芜/尚可/兴旺/闻名）再叠一笔 */
export const MARKET_RATING_BONUS = [0, 0.05, 0.1, 0.2] as const;

export function isMarketDay(day: number): boolean {
  const d = Math.floor(day);
  return d > 0 && d % MARKET_INTERVAL === 0;
}

/** 当天卖出单价倍率；非集市日恒为 1 */
export function sellMultiplier(w: World): number {
  if (!isMarketDay(w.day)) return 1;
  return 1 + MARKET_SELL_BONUS + MARKET_RATING_BONUS[rating(w).grade];
}

/** 给 UI/晨报用的一句话；非集市日返回 null */
export function marketTip(w: World): string | null {
  if (!isMarketDay(w.day)) return null;
  const percent = Math.round((sellMultiplier(w) - 1) * 100);
  return `今天是集市日：卖价 +${percent}%（农场评价越高，加得越多）`;
}
