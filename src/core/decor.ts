// 装饰：购买 → 摆放 → 收回。纯逻辑，不依赖 Phaser。
//
// 设计取舍：
//   - 装饰**不占农田**（farmCoord 命中直接拒绝），避免玩家把耕地摆满没法种。
//   - 摆放位置只做"core 能判断的"校验（地图内 / 非农田 / 该格没有别的装饰 / 背包里有货）；
//     树、矿脉、建筑、水面这些**只有场景知道**的阻挡，由 GameScene 在调用前额外判一次。
//   - 收回永远允许（不会把玩家自己的东西锁死在地上）。

import { DECORS, decorDef } from './data';
import { addItem, countItem, removeItem } from './economy';
import { farmCoord, inMap } from './world';
import type { PlacedDecor, World } from './types';

export interface DecorResult {
  ok: boolean;
  text: string;
  gold?: number;
}

/** 该格上的装饰（没有则 null） */
export function decorAt(w: World, x: number, y: number): PlacedDecor | null {
  return w.decor.find((d) => d.x === x && d.y === y) ?? null;
}

/** 该格是否被装饰挡住（野餐布这类 blocks=false 的不挡） */
export function decorBlocks(w: World, x: number, y: number): boolean {
  const d = decorAt(w, x, y);
  if (!d) return false;
  return decorDef(d.id)?.blocks ?? false;
}

export function buyDecor(w: World, id: string, n = 1): DecorResult {
  const def = decorDef(id);
  if (!def) return { ok: false, text: '没有这件装饰' };
  const count = Math.max(1, Math.floor(n));
  const cost = def.price * count;
  if (w.gold < cost) return { ok: false, text: '金币不够' };
  w.gold -= cost;
  addItem(w.inventory, id, count);
  return { ok: true, text: `买了 ${count} 个${def.name}`, gold: cost };
}

/** 摆放前置校验（不含场景侧阻挡判定） */
export function canPlaceDecor(w: World, x: number, y: number): { ok: boolean; text: string } {
  if (!inMap(x, y)) return { ok: false, text: '这里放不下' };
  if (farmCoord(x, y)) return { ok: false, text: '农田上不能摆装饰' };
  if (decorAt(w, x, y)) return { ok: false, text: '这里已经摆过东西了' };
  return { ok: true, text: '' };
}

export function placeDecor(w: World, id: string, x: number, y: number): DecorResult {
  const def = decorDef(id);
  if (!def) return { ok: false, text: '没有这件装饰' };
  if (countItem(w.inventory, id) <= 0) return { ok: false, text: `背包里没有${def.name}` };
  const pre = canPlaceDecor(w, x, y);
  if (!pre.ok) return { ok: false, text: pre.text };
  removeItem(w.inventory, id, 1);
  w.decor.push({ id, x, y });
  return { ok: true, text: `摆好了${def.name}` };
}

export function removeDecor(w: World, x: number, y: number): DecorResult {
  const d = decorAt(w, x, y);
  if (!d) return { ok: false, text: '这里没有可收的装饰' };
  const def = decorDef(d.id);
  w.decor = w.decor.filter((p) => !(p.x === x && p.y === y));
  addItem(w.inventory, d.id, 1);
  return { ok: true, text: `收起了${def?.name ?? '装饰'}` };
}

/** 读档/存档自检用：只保留白名单 id */
export function isDecorId(id: string): boolean {
  return DECORS.some((d) => d.id === id);
}
