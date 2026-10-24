// 日循环：睡觉结算 —— 作物推进、过季枯萎、天气、季节、体力恢复。
// 纯函数，与渲染完全解耦。

import {
  COLLAPSE_GOLD_PENALTY, COLLAPSE_NEXT_DAY_ENERGY_RATIO,
  DAY_START_MINUTE, RAIN_CHANCE, SEASON_DAYS,
} from './config';
import { CROPS } from './data';
import { refreshOres } from './mine';
import { marketTip } from './market';
import type { CropState, Plot, World } from './types';

export interface DayReport {
  day: number;
  seasonChanged: boolean;
  withered: number;
  rain: boolean;
  collapsed: boolean;
  lines: string[];
}

/** 一晚过去：推进所有作物。当天浇过水的推进一阶段；没浇的缺水计数并停滞。 */
export function advanceCrops(w: World): number {
  let withered = 0;
  for (const p of w.plots) {
    // 浇湿的地块过一夜就干透，第二天才能再浇
    if (p.state === 'watered') p.state = 'tilled';
    if (!p.crop) continue;
    const c: CropState = p.crop;
    if (c.wateredToday && c.stage < 3) {
      const need = CROPS[c.type].stageThresholds[c.stage];
      c.progress += 1;
      if (c.progress >= need) {
        c.stage += 1;
        c.progress = 0;
      }
    } else if (!c.wateredToday) {
      c.dryDays += 1;
    }
    c.wateredToday = false;

    // 过季枯萎：作物不在当前季节的可种列表 → 枯萎
    if (!CROPS[c.type].seasons.includes(w.season)) {
      if (c.stage < 3) {
        p.crop = makeWithered(c);
        withered += 1;
      }
    }
  }
  return withered;
}

function makeWithered(c: CropState): Plot['crop'] {
  return { type: c.type, stage: c.stage, progress: 0, dryDays: c.dryDays, wateredToday: false, withered: true };
}

/** 雨天：所有已开垦地块自动湿润 */
export function applyRain(w: World): void {
  for (const p of w.plots) {
    if (p.state === 'tilled') p.state = 'watered';
    if (p.crop) p.crop.wateredToday = true;
  }
}

/**
 * 睡觉（或昏倒）→ 结算并进入新的一天。
 * collapsed=true 表示昏倒：体力减半、罚金币，作物照常推进。
 */
export function endDay(w: World, collapsed: boolean): DayReport {
  const prevSeason = w.season;

  // 先把日期/季节推进到「新的一天」，再结算作物：
  // 否则春末最后一晚会用旧季节判断枯萎，春作物会白活第一个夏天白天。
  w.day += 1;
  w.season = (Math.floor((w.day - 1) / SEASON_DAYS) % 4) as World['season'];
  const seasonChanged = w.season !== prevSeason;
  const withered = advanceCrops(w);

  // 天气：雨天补水
  w.weather = Math.random() < RAIN_CHANCE ? 'rain' : 'sun';

  // 体力与金币
  let goldLost = 0;
  if (collapsed) {
    w.energy = Math.max(1, Math.floor(w.maxEnergy * COLLAPSE_NEXT_DAY_ENERGY_RATIO));
    // 先算实际扣多少再扣：身无分文时不能扣成负数，文案也得按真实金额写
    goldLost = Math.min(Math.max(0, w.gold), COLLAPSE_GOLD_PENALTY);
    w.gold = Math.max(0, w.gold - COLLAPSE_GOLD_PENALTY);
    w.stats.collapsedCount += 1;
  } else {
    w.energy = w.maxEnergy;
  }
  w.collapsedLastNight = collapsed;

  // 每日 NPC 标记重置
  for (const id of Object.keys(w.npcs)) {
    w.npcs[id].giftedToday = false;
    w.npcs[id].talkedToday = false;
  }

  if (w.weather === 'rain') applyRain(w);

  // 矿脉每天清晨回满
  refreshOres(w);

  w.minute = DAY_START_MINUTE;

  const lines: string[] = [];
  if (collapsed) {
    // 三种情况分开说，避免"身无分文还说丢了 50 金币"这种假账
    const goldNote = goldLost <= 0
      ? '身上没有金币，没被罚。'
      : goldLost >= COLLAPSE_GOLD_PENALTY
        ? `还丢了 ${COLLAPSE_GOLD_PENALTY} 金币。`
        : `身上的 ${goldLost} 金币全掉光了。`;
    lines.push(`你体力透支昏倒了…体力恢复到一半，${goldNote}`);
  }
  if (withered > 0) lines.push(`${withered} 株作物枯萎了。`);
  if (seasonChanged) lines.push('新的季节开始了！商店上了新种子。');
  lines.push(w.weather === 'rain' ? '今天下雨，作物会自动补水。' : '今天是个晴天。');
  const market = marketTip(w);
  if (market) lines.push(market);
  return { day: w.day, seasonChanged, withered, rain: w.weather === 'rain', collapsed, lines };
}
