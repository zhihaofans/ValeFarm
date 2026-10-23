// 矿脉：林区的可挖矿点。纯逻辑，不依赖 Phaser。
//
// 设计取舍（见 dev-docs/GAME_DESIGN.md §6.5）：
// 本期做的是"露天矿脉"而不是独立的矿洞场景 —— 木镐先有确定的用途与产出，
// 矿洞（第二张地图 + 场景切换）等有可视化验收环境时再单独做。

import { ENERGY, ORE_COPPER_PER_HIT, ORE_HP, ORE_IRON_BONUS } from './config';
import { spendEnergy } from './actions';
import { addItem, countItem } from './economy';
import type { OreState, World } from './types';

export interface MineResult {
  ok: boolean;
  text: string;
  energy: number;
  /** 本次挖到的铜矿石数量 */
  copper?: number;
  /** 本次挖到的铁矿石数量（只在挖空那一击） */
  iron?: number;
  /** 这一击把矿脉挖空了 */
  depleted?: boolean;
}

/** 拿在身上的矿脉（hp>0）；已挖空返回 null */
export function oreAt(w: World, x: number, y: number): OreState | null {
  return w.ores.find((o) => o.x === x && o.y === y && o.hp > 0) ?? null;
}

export function hasPickaxe(w: World): boolean {
  return countItem(w.inventory, 'tool:pickaxe') > 0;
}

/** 挖一下：需要木镐 + 体力；每下 1 铜矿，挖空那一下额外 1 铁矿 */
export function mineOre(w: World, x: number, y: number): MineResult {
  const ore = oreAt(w, x, y);
  if (!ore) return { ok: false, text: '这里没有可挖的矿脉', energy: 0 };
  if (!hasPickaxe(w)) return { ok: false, text: '需要木镐子：林区砍 3 个木头，在制作台做一把', energy: 0 };
  if (!spendEnergy(w, ENERGY.mine)) return { ok: false, text: '体力不够了…', energy: 0 };

  ore.hp -= 1;
  const copper = ORE_COPPER_PER_HIT;
  addItem(w.inventory, 'ore:copper', copper);

  if (ore.hp <= 0) {
    const iron = ORE_IRON_BONUS;
    addItem(w.inventory, 'ore:iron', iron);
    return {
      ok: true,
      text: `矿脉挖空了：铜矿石 +${copper}、铁矿石 +${iron}`,
      energy: ENERGY.mine,
      copper,
      iron,
      depleted: true,
    };
  }
  return {
    ok: true,
    text: `挖了一下，矿脉还剩 ${ore.hp} 下（铜矿石 +${copper}）`,
    energy: ENERGY.mine,
    copper,
  };
}

/** 次日清晨：所有矿脉回满（当天的产出额度自然刷新） */
export function refreshOres(w: World): void {
  for (const o of w.ores) o.hp = ORE_HP;
}
