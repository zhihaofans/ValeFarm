// 农场评价：把「我的农场整体怎么样」变成一个可见的数字与档位。
// 纯函数、确定性、不读时间不读随机 —— 单测直接跑。
//
// 为什么要有这个：作物品质只反馈单件收成，装饰只是"好看"。评分把
// 「开垦 / 装饰 / 多样性 / 整洁」四件事都变成有回报的行为，也是后续
// 集市日额外收入的依据（core/market.ts）。

import { FARM_H, FARM_W } from './config';
import { CROPS } from './data';
import type { World } from './types';

export interface RatingDetail {
  /** 已开垦（tilled / watered，不含 wild）占比 0..1 */
  tillRatio: number;
  /** 装饰件数（原始值） */
  decor: number;
  /** 装饰项得分 0..1（12 件封顶） */
  decorScore: number;
  /** 作物种类数（田里种着的 + 库存里的，去重） */
  diversity: number;
  /** 多样性得分 0..1（4 种封顶） */
  diversityScore: number;
  /** 障碍 + 枯苗数量（原始值） */
  mess: number;
  /** 整洁得分 0..1（20 个封顶归零） */
  cleanScore: number;
}

export interface Rating {
  /** 0..100 整数 */
  score: number;
  /** 0 荒芜 / 1 尚可 / 2 兴旺 / 3 闻名 */
  grade: 0 | 1 | 2 | 3;
  label: string;
  detail: RatingDetail;
}

export const RATING_LABELS = ['荒芜', '尚可', '兴旺', '闻名'] as const;
/** 权重：开垦 30 / 装饰 25 / 多样性 20 / 整洁 25，加起来 100 */
export const RATING_WEIGHTS = { till: 30, decor: 25, diversity: 20, clean: 25 } as const;
/** 达到满分所需的量 */
export const RATING_CAPS = { decor: 12, diversity: 4, mess: 20 } as const;
/** 档位下限（含） */
export const RATING_STEPS = [75, 50, 25] as const;

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

export function ratingDetail(w: World): RatingDetail {
  const total = FARM_W * FARM_H;
  let tilled = 0;
  let mess = 0;
  const cropTypes = new Set<string>();

  for (const p of w.plots) {
    if (p.state !== 'wild') tilled += 1;
    if (p.obstacle) mess += 1;
    if (p.crop) {
      if (p.crop.withered) mess += 1;
      else cropTypes.add(p.crop.type);
    }
  }
  // 库存里的作物也算多样性：收进箱子里的同样是"我种出来的品种"
  for (const key of Object.keys(w.inventory)) {
    if (!key.startsWith('crop:')) continue;
    const crop = key.split(':')[1];
    if (crop && CROPS[crop as keyof typeof CROPS]) cropTypes.add(crop);
  }

  const tillRatio = total > 0 ? tilled / total : 0;
  const decor = w.decor.length;
  const decorScore = clamp01(decor / RATING_CAPS.decor);
  const diversity = cropTypes.size;
  const diversityScore = clamp01(diversity / RATING_CAPS.diversity);
  const cleanScore = 1 - clamp01(mess / RATING_CAPS.mess);

  return { tillRatio, decor, decorScore, diversity, diversityScore, mess, cleanScore };
}

export function rating(w: World): Rating {
  const d = ratingDetail(w);
  const raw = RATING_WEIGHTS.till * d.tillRatio
    + RATING_WEIGHTS.decor * d.decorScore
    + RATING_WEIGHTS.diversity * d.diversityScore
    + RATING_WEIGHTS.clean * d.cleanScore;
  const score = Math.max(0, Math.min(100, Math.round(raw)));

  let grade: 0 | 1 | 2 | 3 = 0;
  if (score >= RATING_STEPS[0]) grade = 3;
  else if (score >= RATING_STEPS[1]) grade = 2;
  else if (score >= RATING_STEPS[2]) grade = 1;

  return { score, grade, label: RATING_LABELS[grade], detail: d };
}

/** 一行摘要，给系统面板/HUD 用 */
export function ratingSummary(w: World): string {
  const r = rating(w);
  return `${r.label}（${r.score}）`;
}
