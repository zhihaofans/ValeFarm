// 矿洞（B1）：单层小房间。纯逻辑，不依赖 Phaser。
//
// 本期只做「森林洞口 ↔ 14×10 矿洞」的闭环：固定矿脉、进出洞、存档往返。
// 多层下潜/宝箱/怪物留到后续；所有点位固定，读档不会把碰撞铺到任意位置。

import { MAP_H, MAP_W, ORE_HP } from './config';
import type { CaveState, OreState, World } from './types';

export const CAVE_W = 14;
export const CAVE_H = 10;
/** 森林里的洞口（实心；面朝它按互动进洞） */
export const CAVE_ENTRANCE = { x: 27, y: 1 } as const;
/** 从洞里出来时站的位置（洞口前） */
export const CAVE_RETURN = { x: 27, y: 2 } as const;
/** 洞里最下方出口（实心；面朝它按互动出洞） */
export const CAVE_EXIT = { x: 7, y: CAVE_H - 1 } as const;
/** 进洞后的落点 */
export const CAVE_SPAWN = { x: 7, y: CAVE_H - 2 } as const;
/** 洞内固定矿脉点位 */
export const CAVE_ORE_SPOTS: Array<[number, number]> = [
  [3, 3], [10, 3], [5, 6], [9, 6],
];

export function defaultCave(): CaveState {
  return {
    depth: 1,
    ores: CAVE_ORE_SPOTS.map(([x, y]) => ({ x, y, hp: ORE_HP })),
    returnX: CAVE_RETURN.x,
    returnY: CAVE_RETURN.y,
  };
}

/** 14×10 房间内；边界墙由 GameScene 处理 */
export function inCaveMap(x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < CAVE_W && y < CAVE_H;
}

function clampMap(v: number, max: number): number {
  return Math.min(max, Math.max(0, v));
}

/** 进洞：记录返回坐标，把玩家移到洞里 */
export function enterCave(w: World): boolean {
  if (w.area === 'cave') return false;
  w.cave.returnX = clampMap(w.playerX, MAP_W - 1);
  w.cave.returnY = clampMap(w.playerY, MAP_H - 1);
  w.area = 'cave';
  w.playerX = CAVE_SPAWN.x;
  w.playerY = CAVE_SPAWN.y;
  w.facing = 'up';
  return true;
}

/** 出洞：回到进洞前的位置（夹在地图内） */
export function exitCave(w: World): boolean {
  if (w.area !== 'cave') return false;
  w.area = 'farm';
  w.playerX = clampMap(w.cave.returnX, MAP_W - 1);
  w.playerY = clampMap(w.cave.returnY, MAP_H - 1);
  w.facing = 'down';
  return true;
}

/** 洞内矿脉（hp>0）；坐标不依赖 w.area，专门给场景层判断 */
export function caveOreAt(w: World, x: number, y: number): OreState | null {
  return w.cave.ores.find((o) => o.x === x && o.y === y && o.hp > 0) ?? null;
}
