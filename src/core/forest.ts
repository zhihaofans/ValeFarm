// 林区：树木状态与砍伐。纯逻辑，不依赖 Phaser。

import { ENERGY, TREE_WOOD } from './config';
import { spendEnergy } from './actions';
import type { TreeState, World } from './types';

export interface ChopResult {
  ok: boolean;
  text: string;
  energy: number;
  wood?: number;
  chopped?: boolean;
}

export function treeAt(w: World, x: number, y: number): TreeState | null {
  return w.trees.find((t) => t.x === x && t.y === y && t.hp > 0) ?? null;
}

/** 砍一下树：消耗体力，第三次砍倒给木头 */
export function chopTree(w: World, x: number, y: number): ChopResult {
  const tree = treeAt(w, x, y);
  if (!tree) return { ok: false, text: '这里没有树', energy: 0 };
  if (!spendEnergy(w, ENERGY.chop)) return { ok: false, text: '体力不够了…', energy: 0 };

  tree.hp -= 1;
  if (tree.hp <= 0) {
    w.inventory.wood = (w.inventory.wood ?? 0) + TREE_WOOD;
    return {
      ok: true,
      text: `砍倒了树，木头 +${TREE_WOOD}`,
      energy: ENERGY.chop,
      wood: TREE_WOOD,
      chopped: true,
    };
  }
  return {
    ok: true,
    text: `砍了一下，树还剩 ${tree.hp} 下`,
    energy: ENERGY.chop,
  };
}
