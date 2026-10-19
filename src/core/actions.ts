// 玩家动作：锄地 / 播种 / 浇水 / 收获 / 清障碍。
// 全部纯函数：改 World，返回结果对象供 UI 提示，不碰 Phaser。

import { CROPS } from './data';
import { ENERGY } from './config';
import { plotAt } from './world';
import type { CropId, Plot, Quality, World } from './types';

export type ActionResult =
  | { ok: true; text: string; energy: number }
  | { ok: false; text: string; energy: 0 };

function fail(text: string): ActionResult {
  return { ok: false, text, energy: 0 };
}
function done(text: string, energy: number): ActionResult {
  return { ok: true, text, energy };
}

export function spendEnergy(w: World, n: number): boolean {
  if (w.energy < n) return false;
  w.energy -= n;
  return true;
}

/** 锄地（单格）。升级锄头的多格遍历由场景层负责，这里只处理一格。 */
export function doHoe(w: World, fx: number, fy: number): ActionResult {
  return doHoeAt(w, fx, fy);
}

export function doHoeAt(w: World, x: number, y: number): ActionResult {
  const p = plotAt(w, x, y);
  if (!p) return fail('这里不能耕种');
  if (p.state !== 'wild') return fail('这里已经翻过了');
  if (p.obstacle) return fail('先清理这里的障碍物');
  if (!spendEnergy(w, ENERGY.hoe)) return fail('体力不够了…');
  p.state = 'tilled';
  return done('翻好了土地', ENERGY.hoe);
}

export function doWater(w: World, x: number, y: number): ActionResult {
  const p = plotAt(w, x, y);
  if (!p) return fail('这里不能浇水');
  if (p.state === 'wild') return fail('先用锄头翻地');
  if (w.weather === 'rain') return fail('下雨天不需要浇水');
  if (p.state === 'watered') return fail('这块地已经浇过水了');
  if (!spendEnergy(w, ENERGY.water)) return fail('体力不够了…');
  p.state = 'watered';
  if (p.crop) p.crop.wateredToday = true;
  return done('浇了水', ENERGY.water);
}

export function doPlant(w: World, x: number, y: number, crop: CropId): ActionResult {
  const p = plotAt(w, x, y);
  if (!p) return fail('这里不能播种');
  if (p.state === 'wild') return fail('先用锄头翻地');
  if (p.crop) return fail('这里已经种了东西');
  const inv = w.inventory['seed:' + crop] || 0;
  if (inv <= 0) return fail('没有这种种子，去商店买');
  const def = CROPS[crop];
  if (!def.seasons.includes(w.season)) return fail(`${def.name}不能在当前季节种植`);
  if (!spendEnergy(w, ENERGY.plant)) return fail('体力不够了…');
  w.inventory['seed:' + crop] = inv - 1;
  // 雨天/刚浇过水的土地：新苗当天就算浇过水，否则玩家会碰到
  // 「下雨天种下去 → 浇水被拒 → 当晚不生长」的死角。
  const wet = w.weather === 'rain' || p.state === 'watered';
  p.crop = { type: crop, stage: 0, progress: 0, dryDays: 0, wateredToday: wet, withered: false };
  if (wet) p.state = 'watered';
  return done(`种下了${def.name}`, ENERGY.plant);
}

/** 收获：返回品质供音效/飘字 */
export function doHarvest(w: World, x: number, y: number): ActionResult & { quality?: Quality; crop?: CropId } {
  const p = plotAt(w, x, y);
  if (!p || !p.crop) return fail('这里没有可收获的作物');
  if (p.crop.withered) return fail('这株已经枯萎，用锄头清理吧');
  if (p.crop.stage < 3) return fail('还没成熟');
  if (!spendEnergy(w, ENERGY.harvest)) return fail('体力不够了…');
  const q = qualityOf(p.crop);
  const cropType = p.crop.type;
  const item = `crop:${cropType}:${q}`;
  w.inventory[item] = (w.inventory[item] || 0) + 1;
  const def = CROPS[cropType];
  w.stats.harvested += 1;
  p.crop = null;
  p.state = 'tilled';
  return { ok: true, text: `收获了${def.name}（${q === 'gold' ? '金星' : q === 'sil' ? '银星' : '普通'}）`, energy: ENERGY.harvest, quality: q, crop: cropType };
}

/** 清理障碍或枯萎作物 */
export function doClear(w: World, x: number, y: number): ActionResult {
  const p = plotAt(w, x, y);
  if (!p) return fail('这里没有可清理的东西');
  if (p.crop && p.crop.withered) {
    if (!spendEnergy(w, ENERGY.clearWeed)) return fail('体力不够了…');
    p.crop = null;
    return done('清理了枯萎的作物', ENERGY.clearWeed);
  }
  if (!p.obstacle) return fail('这里没有可清理的东西');
  const cost = p.obstacle === 'weed' ? ENERGY.clearWeed : p.obstacle === 'stone' ? ENERGY.clearStone : ENERGY.clearStump;
  if (!spendEnergy(w, cost)) return fail('体力不够了…');
  const name = p.obstacle === 'weed' ? '杂草' : p.obstacle === 'stone' ? '石头' : '树桩';
  p.obstacle = null;
  return done(`清掉了${name}`, cost);
}

/** 缺水越少品质越高：0 缺水 → 金/银掷点；1 次 → 有机会银星 */
export function qualityOf(c: Plot['crop']): Quality {
  if (!c) return 'norm';
  if (c.dryDays === 0) {
    const r = Math.random();
    if (r < 0.45) return 'gold';
    if (r < 0.85) return 'sil';
    return 'norm';
  }
  if (c.dryDays === 1) {
    return Math.random() < 0.35 ? 'sil' : 'norm';
  }
  return 'norm';
}
