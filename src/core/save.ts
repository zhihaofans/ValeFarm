// 存档层：normalize 逐字段重建 + SAVE_FMT 整数迁移链。
//
// ⚠️ 铁律（本项目踩过的坑里最隐蔽的一类）：
//   World 新增字段时必须在这里登记一行，漏登记 = 用户数据静默丢失。
//   不写 `{ ...defaults, ...raw }` 这种展开 —— 脏数据会原样进内存。

import { FARM_H, FARM_W, SAVE_FMT as FMT_CURRENT } from './config';
import { NPCS } from './data';
import { createWorld } from './world';
import type { Facing, Inventory, Plot, Season, Weather, World } from './types';

// ---------------------------------------------------------------- 基础类型守卫

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function num(v: unknown, d: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : d;
}
function int(v: unknown, d: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : d;
}
function str(v: unknown, d: string): string {
  return typeof v === 'string' ? v : d;
}
function bool(v: unknown, d: boolean): boolean {
  return typeof v === 'boolean' ? v : d;
}

// ---------------------------------------------------------------- 子结构

function normalizePlot(raw: unknown): Plot {
  const p: Plot = { state: 'wild', crop: null, obstacle: null };
  if (!isObj(raw)) return p;
  // state —— 必须登记：地块三态
  const st = raw.state;
  if (st === 'wild' || st === 'tilled' || st === 'watered') p.state = st;
  // obstacle —— 必须登记：障碍物
  const ob = raw.obstacle;
  if (ob === 'weed' || ob === 'stone' || ob === 'stump') p.obstacle = ob;
  // crop —— 必须登记：作物（含全部子字段，嵌套字段漏一个就是"看着有、实际没"）
  if (isObj(raw.crop)) {
    const type = raw.crop.type;
    if (type === 'radish' || type === 'pea' || type === 'corn' || type === 'pumpkin') {
      p.crop = {
        type,
        stage: Math.min(3, Math.max(0, int(raw.crop.stage, 0))),
        progress: Math.max(0, int(raw.crop.progress, 0)),
        dryDays: Math.max(0, int(raw.crop.dryDays, 0)),
        wateredToday: bool(raw.crop.wateredToday, false),
        withered: bool(raw.crop.withered, false),
      };
    }
  }
  return p;
}

function normalizeInventory(raw: unknown): Inventory {
  const inv: Inventory = {};
  if (!isObj(raw)) return inv;
  for (const k of Object.keys(raw)) {
    const n = int(raw[k], 0);
    if (n > 0 && /^(seed:(radish|pea|corn|pumpkin)|crop:(radish|pea|corn|pumpkin):(norm|sil|gold)|tool:(can2|hoe2))$/.test(k)) {
      inv[k] = n;
    }
  }
  return inv;
}

function normalizeNpcs(raw: unknown): World['npcs'] {
  const npcs: World['npcs'] = {};
  for (const n of NPCS) {
    const s = isObj(raw) && isObj(raw[n.id]) ? raw[n.id] as Obj : {};
    npcs[n.id] = {
      friendship: Math.max(0, num(s.friendship, 0)),
      giftedToday: bool(s.giftedToday, false),
      talkedToday: bool(s.talkedToday, false),
      reward100: bool(s.reward100, false),
      reward300: bool(s.reward300, false),
    };
  }
  return npcs;
}

// ---------------------------------------------------------------- 迁移链
// 用整数格式号链式迁移：`if (fmt < N)`。数字比较天然正确，
// 千万别用版本字符串比较（'1.9' < '1.13' 在字符串下是 false）。

function migrateFrom(raw: Obj, fmt: number): { data: Obj; fmt: number } {
  let data = raw;
  let f = fmt;
  // if (f < 2) { data = migrate0to1(data); f = 2; }
  return { data, fmt: f };
}

// ---------------------------------------------------------------- 顶层 normalize

export function normalizeWorld(raw: unknown): World {
  let o: Obj = isObj(raw) ? raw : {};
  const base = createWorld();

  // 存档格式号与迁移
  const rawFmt = int(o.fmt, 0);
  const migrated = migrateFrom(o, rawFmt);
  o = migrated.data;

  let w: World = {
    // fmt —— 必须登记
    fmt: FMT_CURRENT,
    // day —— 必须登记
    day: Math.max(1, int(o.day, base.day)),
    // minute —— 必须登记（合法域 0..1560，越界回落起床时间）
    minute: (() => {
      const m = int(o.minute, base.minute);
      return m >= 0 && m <= 1560 ? m : base.minute;
    })(),
    // season —— 必须登记
    season: (num(o.season, base.season) % 4) as Season,
    // weather —— 必须登记
    weather: (o.weather === 'rain' ? 'rain' : 'sun') as Weather,
    // gold —— 必须登记
    gold: Math.max(0, num(o.gold, base.gold)),
    // energy —— 必须登记（连同上限）
    energy: Math.max(0, num(o.energy, base.energy)),
    maxEnergy: Math.max(1, num(o.maxEnergy, base.maxEnergy)),
    // toolCan / toolHoe —— 必须登记：工具等级
    toolCan: o.toolCan === 2 ? 2 : 1,
    toolHoe: o.toolHoe === 2 ? 2 : 1,
    // plots —— 必须登记：整片农田逐格重建
    plots: Array.isArray(o.plots)
      ? o.plots.slice(0, FARM_W * FARM_H).map(normalizePlot)
      : base.plots,
    // inventory —— 必须登记（老档/新档都没有 inventory 时回落初始背包）
    inventory: o.inventory === undefined ? base.inventory : normalizeInventory(o.inventory),
    // playerX / playerY / facing —— 必须登记：玩家位置
    playerX: int(o.playerX, base.playerX),
    playerY: int(o.playerY, base.playerY),
    facing: (['down', 'left', 'right', 'up'].includes(str(o.facing, 'down'))
      ? str(o.facing, 'down') : 'down') as Facing,
    // npcs —— 必须登记：好感度
    npcs: normalizeNpcs(o.npcs),
    // collapsedLastNight —— 必须登记
    collapsedLastNight: bool(o.collapsedLastNight, false),
    // stats —— 必须登记
    stats: {
      earned: Math.max(0, num(isObj(o.stats) ? o.stats.earned : undefined, 0)),
      harvested: Math.max(0, int(isObj(o.stats) ? o.stats.harvested : undefined, 0)),
      collapsedCount: Math.max(0, int(isObj(o.stats) ? o.stats.collapsedCount : undefined, 0)),
    },
  };

  // plots 数量补齐（老档/截断档）
  while (w.plots.length < FARM_W * FARM_H) {
    w.plots.push({ state: 'wild', crop: null, obstacle: null });
  }
  if (w.energy > w.maxEnergy) w.energy = w.maxEnergy;
  return w;
}

/** 序列化就是 JSON（World 本身就是纯数据） */
export function serialize(w: World): string {
  return JSON.stringify(w);
}

export function deserialize(text: string): World | null {
  try {
    return normalizeWorld(JSON.parse(text));
  } catch {
    return null;
  }
}

/** 导出文件头：带版本与时间，导入时按 normalize 校验 */
export function exportSave(w: World): string {
  return JSON.stringify({
    app: 'vale-farm',
    ver: FMT_CURRENT,
    fmt: w.fmt,
    exportedAt: new Date().toISOString(),
    data: w,
  }, null, 2);
}

export function importSave(text: string): World | null {
  try {
    const raw = JSON.parse(text);
    const data = isObj(raw) && isObj(raw.data) ? raw.data : raw;
    return normalizeWorld(data);
  } catch {
    return null;
  }
}
