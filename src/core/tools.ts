// 工具耐久（仿 Minecraft：物品类型定上限，物品实例记当前值）。
//
// 为什么单独一层：耐久逻辑要「归零就损坏并从背包移除」，这跟具体是镐子还是斧头无关。
// 新工具只要在 data.ts 的 TOOLS 里声明 maxDur，这里的函数就能直接用。

import { toolMaxDur } from './data';
import { removeItem } from './economy';
import type { World } from './types';

/** 当前耐久（夹在 0..maxDur；没有耐久概念的工具恒为 0） */
export function toolDur(w: World, id: string): number {
  const max = toolMaxDur(id);
  if (max <= 0) return 0;
  const raw = w.toolDur[id] ?? 0;
  return Math.max(0, Math.min(max, Math.floor(raw)));
}

/** 是否还能用（没有耐久概念的工具：只要有这件物品就算可用） */
export function toolUsable(w: World, id: string): boolean {
  if ((w.inventory[id] ?? 0) <= 0) return false;
  const max = toolMaxDur(id);
  return max <= 0 ? true : toolDur(w, id) > 0;
}

/**
 * 磨损 n 点。返回 true 表示这一下**用坏了**（已从背包移除并清掉耐久键）。
 * 归零即移除，保证「背包里有这把工具 ⇒ 耐久 > 0」这个不变量永远成立。
 */
export function damageTool(w: World, id: string, n = 1): boolean {
  const max = toolMaxDur(id);
  if (max <= 0) return false;
  const next = toolDur(w, id) - Math.max(1, Math.floor(n));
  if (next <= 0) {
    delete w.toolDur[id];
    removeItem(w.inventory, id, 1);
    return true;
  }
  w.toolDur[id] = next;
  return false;
}

/** 把耐久修满（制作/修理用） */
export function restoreTool(w: World, id: string): void {
  const max = toolMaxDur(id);
  if (max <= 0) return;
  if ((w.inventory[id] ?? 0) <= 0) return;
  w.toolDur[id] = max;
}

/** 耐久比例 0..1，给 UI 画条用 */
export function toolRatio(w: World, id: string): number {
  const max = toolMaxDur(id);
  if (max <= 0) return 0;
  return toolDur(w, id) / max;
}
