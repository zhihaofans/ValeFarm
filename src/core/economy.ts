// 经济：背包操作、商店买卖、工具升级。

import { CROPS, CROP_ORDER, QUALITY, RECIPES, dailySeedSpecial, sellPrice, TOOL_UPGRADES } from './data';
import type { CropId, Inventory, Quality, Season, World } from './types';

export function addItem(inv: Inventory, id: string, n: number): void {
  inv[id] = (inv[id] || 0) + n;
}

export function countItem(inv: Inventory, id: string): number {
  return inv[id] || 0;
}

export function removeItem(inv: Inventory, id: string, n: number): boolean {
  const have = inv[id] || 0;
  if (have < n) return false;
  inv[id] = have - n;
  if (inv[id] <= 0) delete inv[id];
  return true;
}

/** 背包里所有的种子（含跨季种子） */
export function seedEntries(inv: Inventory): Array<{ crop: CropId; n: number }> {
  const out: Array<{ crop: CropId; n: number }> = [];
  for (const c of CROP_ORDER) {
    const n = countItem(inv, 'seed:' + c);
    if (n > 0) out.push({ crop: c, n });
  }
  return out;
}

/** 背包里所有的收获作物（按品质分开） */
export function cropEntries(inv: Inventory): Array<{ crop: CropId; quality: Quality; n: number; unit: number }> {
  const out: Array<{ crop: CropId; quality: Quality; n: number; unit: number }> = [];
  for (const c of CROP_ORDER) {
    for (const q of ['norm', 'sil', 'gold'] as Quality[]) {
      const n = countItem(inv, `crop:${c}:${q}`);
      if (n > 0) out.push({ crop: c, quality: q, n, unit: sellPrice(c, q) });
    }
  }
  return out;
}

/** 商店当前季节出售的种子 */
export function seasonSeeds(season: Season): CropId[] {
  return CROP_ORDER.filter((c) => CROPS[c].seasons.includes(season));
}

export function canAfford(w: World, price: number): boolean {
  return w.gold >= price;
}

export function buySeed(w: World, crop: CropId, n = 1): { ok: boolean; text: string } {
  const def = CROPS[crop];
  const special = dailySeedSpecial(w.season, w.day);
  const unit = special?.crop === crop ? special.price : def.seedPrice;
  const cost = unit * n;
  if (!canAfford(w, cost)) return { ok: false, text: '金币不够' };
  w.gold -= cost;
  addItem(w.inventory, 'seed:' + crop, n);
  const tag = special?.crop === crop ? '（今日特价）' : '';
  return { ok: true, text: `买了 ${n} 包${def.name}种子${tag}` };
}

/** 制作台：按配方扣材料，产出一个物品 */
export function craft(w: World, recipeId: string): { ok: boolean; text: string } {
  const recipe = RECIPES.find((r) => r.id === recipeId);
  if (!recipe) return { ok: false, text: '没有这个配方' };
  if (recipe.result.startsWith('tool:') && countItem(w.inventory, recipe.result) > 0) {
    return { ok: false, text: '这个工具已经有一把了' };
  }
  for (const [id, n] of Object.entries(recipe.cost)) {
    if (countItem(w.inventory, id) < n) {
      return { ok: false, text: `材料不够：${id === 'wood' ? '木头' : id} 需要 ${n}` };
    }
  }
  for (const [id, n] of Object.entries(recipe.cost)) removeItem(w.inventory, id, n);
  addItem(w.inventory, recipe.result, 1);
  return { ok: true, text: `做好了${recipe.name}` };
}

export function sellCrop(w: World, crop: CropId, quality: Quality, n: number): { ok: boolean; text: string; gold: number } {
  const id = `crop:${crop}:${quality}`;
  const have = countItem(w.inventory, id);
  const m = Math.min(have, n);
  if (m <= 0) return { ok: false, text: '没有这个物品', gold: 0 };
  const gold = sellPrice(crop, quality) * m;
  removeItem(w.inventory, id, m);
  w.gold += gold;
  w.stats.earned += gold;
  return { ok: true, text: `卖出 ${m} 份，+${gold} 金币`, gold };
}

export function sellAllCrops(w: World): { gold: number; count: number } {
  let gold = 0, count = 0;
  for (const e of cropEntries(w.inventory)) {
    const r = sellCrop(w, e.crop, e.quality, e.n);
    gold += r.gold;
    count += e.n;
  }
  return { gold, count };
}

export function buyToolUpgrade(w: World, itemId: string): { ok: boolean; text: string } {
  const t = TOOL_UPGRADES.find((u) => u.id === itemId);
  if (!t) return { ok: false, text: '没有这个商品' };
  if (countItem(w.inventory, itemId) > 0 || (itemId === 'tool:can2' && w.toolCan === 2) || (itemId === 'tool:hoe2' && w.toolHoe === 2)) {
    return { ok: false, text: '已经拥有' };
  }
  if (!canAfford(w, t.price)) return { ok: false, text: '金币不够' };
  w.gold -= t.price;
  if (itemId === 'tool:can2') w.toolCan = 2;
  if (itemId === 'tool:hoe2') w.toolHoe = 2;
  return { ok: true, text: `买到了${t.name}！` };
}

export function qualityName(q: Quality): string {
  return QUALITY[q].name;
}
