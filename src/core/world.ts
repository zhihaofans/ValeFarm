// 世界状态：创建、查询、时钟换算。只放纯函数，不依赖 Phaser —— 单测直接跑。

import {
  FARM_H, FARM_OX, FARM_OY, FARM_W, MAP_H, MAP_W,
  DAY_START_MINUTE, FORCE_SLEEP_MINUTE, SEASON_DAYS,
  START_GOLD, START_MAX_ENERGY, SAVE_FMT,
  ORE_HP, TREE_HP,
} from './config';
import { NPCS, ORE_SPOTS, TREE_SPOTS } from './data';
import type { Plot, World } from './types';

export const worldVersion = SAVE_FMT;

export function createWorld(): World {
  const plots: Plot[] = [];
  for (let i = 0; i < FARM_W * FARM_H; i++) {
    plots.push({ state: 'wild', crop: null, obstacle: null });
  }
  // 初始给一点开垦好的地 + 杂草石头树桩混杂，教学成本低、又有清理目标
  const obstacles: Array<[number, number, Plot['obstacle']]> = [
    [0, 0, 'stone'], [4, 0, 'stump'], [9, 1, 'stone'], [2, 3, 'weed'],
    [6, 2, 'weed'], [11, 0, 'weed'], [1, 7, 'stone'], [8, 8, 'stump'],
    [10, 6, 'weed'], [5, 9, 'weed'],
  ];
  const tilled: Array<[number, number]> = [[0, 1], [1, 1], [2, 1]];
  for (const [x, y, ob] of obstacles) {
    const p = plotAt({ plots } as World, x, y);
    if (p) p.obstacle = ob;
  }
  for (const [x, y] of tilled) {
    const p = plotAt({ plots } as World, x, y);
    if (p && !p.obstacle) p.state = 'tilled';
  }

  const npcs: World['npcs'] = {};
  for (const n of NPCS) {
    npcs[n.id] = { friendship: 0, giftedToday: false, talkedToday: false, reward100: false, reward300: false };
  }

  return {
    fmt: SAVE_FMT,
    day: 1,
    minute: DAY_START_MINUTE,
    season: 0,
    weather: 'sun',
    gold: START_GOLD,
    energy: START_MAX_ENERGY,
    maxEnergy: START_MAX_ENERGY,
    toolCan: 1,
    toolHoe: 1,
    plots,
    trees: TREE_SPOTS.map(([x, y]) => ({ x, y, hp: TREE_HP })),
    ores: ORE_SPOTS.map(([x, y]) => ({ x, y, hp: ORE_HP })),
    inventory: { 'seed:radish': 6 },
    playerX: FARM_OX + 1,
    playerY: FARM_OY - 2,
    facing: 'down',
    npcs,
    collapsedLastNight: false,
    stats: { earned: 0, harvested: 0, collapsedCount: 0 },
  };
}

export function plotIndex(x: number, y: number): number {
  return y * FARM_W + x;
}

/** 农田坐标（0 起）→ Plot；越界返回 null */
export function plotAt(w: World, x: number, y: number): Plot | null {
  if (x < 0 || y < 0 || x >= FARM_W || y >= FARM_H) return null;
  return w.plots[plotIndex(x, y)];
}

/** 大地图坐标（tile）→ 农田坐标；不在农田内返回 null */
export function farmCoord(tileX: number, tileY: number): { x: number; y: number } | null {
  const x = tileX - FARM_OX;
  const y = tileY - FARM_OY;
  if (x < 0 || y < 0 || x >= FARM_W || y >= FARM_H) return null;
  return { x, y };
}

export function isFarmTile(tileX: number, tileY: number): boolean {
  return farmCoord(tileX, tileY) !== null;
}

export function inMap(tileX: number, tileY: number): boolean {
  return tileX >= 0 && tileY >= 0 && tileX < MAP_W && tileY < MAP_H;
}

/** 分钟数 → "HH:MM"；>=1440 显示为凌晨（次日） */
export function clockText(minute: number): string {
  const h24 = Math.floor(minute / 60) % 24;
  const m = minute % 60;
  const ampm = h24 < 6 ? '凌晨' : h24 < 12 ? '上午' : h24 < 18 ? '下午' : '晚上';
  return `${ampm} ${String(h24).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function seasonOf(day: number): number {
  return Math.floor((day - 1) / SEASON_DAYS) % 4;
}

export function dayOfSeason(day: number): number {
  return ((day - 1) % SEASON_DAYS) + 1;
}

export function isAwakeEnd(minute: number): boolean {
  return minute >= FORCE_SLEEP_MINUTE;
}
