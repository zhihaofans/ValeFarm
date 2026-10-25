// 矿脉：林区的可挖矿点。纯逻辑，不依赖 Phaser。
//
// 设计取舍（见 dev-docs/GAME_DESIGN.md §6.5）：
// 本期做的是"露天矿脉"而不是独立的矿洞场景 —— 木镐先有确定的用途与产出，
// 矿洞（第二张地图 + 场景切换）等有可视化验收环境时再单独做。
//
// v0.9.6 起木镐有两道门槛：
//   1) 必须**拿在手上**（快捷栏选中 tool:pickaxe），不再"背包里有就能挖"
//   2) 有**耐久**：每挖一下 -1，归零当次即损坏（从背包移除），要回制作台重做

import { ENERGY, ORE_COPPER_PER_HIT, ORE_HP, ORE_IRON_BONUS } from './config';
import { damageTool, toolDur, toolUsable } from './tools';
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
  /** 这一击把镐子用坏了 */
  pickaxeBroken?: boolean;
  /** 用完之后剩余耐久（方便 UI 直接显示） */
  pickaxeDur?: number;
}

/** 当前区域的矿脉（hp>0）；已挖空返回 null */
export function oreAt(w: World, x: number, y: number): OreState | null {
  const list = w.area === 'cave' ? w.cave.ores : w.ores;
  return list.find((o) => o.x === x && o.y === y && o.hp > 0) ?? null;
}

export function hasPickaxe(w: World): boolean {
  return countItem(w.inventory, 'tool:pickaxe') > 0;
}

/**
 * 能否开挖：背包里有镐 + 拿在手上 + 还有耐久。
 * 场景层在调用 mineOre 之前先用它给出准确的失败原因（三条文案各不相同）。
 */
export function canMine(w: World, equipped: string | null): { ok: boolean; text: string } {
  if (!hasPickaxe(w)) return { ok: false, text: '需要木镐子：林区砍 3 个木头，在制作台做一把' };
  if (equipped !== 'tool:pickaxe') return { ok: false, text: '要先把木镐子拿在手上（快捷栏 → 道具）' };
  if (!toolUsable(w, 'tool:pickaxe')) return { ok: false, text: '木镐子已经用坏了，回制作台再做一把（3 木头）' };
  return { ok: true, text: '' };
}

/** 挖一下：需要木镐在手 + 体力 + 耐久；每下 1 铜矿，挖空那一下额外 1 铁矿 */
export function mineOre(w: World, x: number, y: number): MineResult {
  const ore = oreAt(w, x, y);
  if (!ore) return { ok: false, text: '这里没有可挖的矿脉', energy: 0 };
  if (!hasPickaxe(w)) return { ok: false, text: '需要木镐子：林区砍 3 个木头，在制作台做一把', energy: 0 };
  if (!toolUsable(w, 'tool:pickaxe')) return { ok: false, text: '木镐子已经用坏了，回制作台再做一把（3 木头）', energy: 0 };
  if (!spendEnergy(w, ENERGY.mine)) return { ok: false, text: '体力不够了…', energy: 0 };

  // 耐久先扣：这一下已经使上劲了，无论挖出什么都要磨损
  const broken = damageTool(w, 'tool:pickaxe', 1);

  ore.hp -= 1;
  const copper = ORE_COPPER_PER_HIT;
  addItem(w.inventory, 'ore:copper', copper);

  const breakNote = broken ? '；木镐子用坏了，回制作台再做一把' : '';

  if (ore.hp <= 0) {
    const iron = ORE_IRON_BONUS;
    addItem(w.inventory, 'ore:iron', iron);
    return {
      ok: true,
      text: `矿脉挖空了：铜矿石 +${copper}、铁矿石 +${iron}${breakNote}`,
      energy: ENERGY.mine,
      copper,
      iron,
      depleted: true,
      pickaxeBroken: broken,
      pickaxeDur: toolDur(w, 'tool:pickaxe'),
    };
  }
  return {
    ok: true,
    text: `挖了一下，矿脉还剩 ${ore.hp} 下（铜矿石 +${copper}）${breakNote}`,
    energy: ENERGY.mine,
    copper,
    pickaxeBroken: broken,
    pickaxeDur: toolDur(w, 'tool:pickaxe'),
  };
}

/** 次日清晨：所有矿脉（林区 + 矿洞）回满 */
export function refreshOres(w: World): void {
  for (const o of w.ores) o.hp = ORE_HP;
  for (const o of w.cave.ores) o.hp = ORE_HP;
}

/** 镐子耐久比例 0..1（转发到 tools 层，保留旧名字方便调用方） */
export { toolRatio as pickaxeRatio } from './tools';
