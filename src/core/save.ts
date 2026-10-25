// 存档层：normalize 逐字段重建 + SAVE_FMT 整数迁移链。
//
// ⚠️ 铁律（本项目踩过的坑里最隐蔽的一类）：
//   World 新增字段时必须在这里登记一行，漏登记 = 用户数据静默丢失。
//   不写 `{ ...defaults, ...raw }` 这种展开 —— 脏数据会原样进内存。

import { FARM_H, FARM_W, MAP_H, MAP_W, ORE_HP, SAVE_FMT as FMT_CURRENT, TREE_HP } from './config';
import { DECOR_IDS, KNOWLEDGE_SHOP, NPCS, ORE_SPOTS, TOOLS, TREE_SPOTS, toolMaxDur } from './data';
import { CAVE_H, CAVE_W, CAVE_ORE_SPOTS, defaultCave } from './cave';
import { createWorld } from './world';
import type { CaveState, Facing, Inventory, OreState, PlacedDecor, Plot, Season, TreeState, Weather, World } from './types';

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
    if (type === 'radish' || type === 'pea' || type === 'corn' || type === 'pumpkin'
      || type === 'strawberry' || type === 'sweetpotato') {
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
    if (n > 0 && /^(seed:(radish|pea|corn|pumpkin|strawberry|sweetpotato)|crop:(radish|pea|corn|pumpkin|strawberry|sweetpotato):(norm|sil|gold)|tool:(can2|hoe2|pickaxe)|wood|ore:(copper|iron)|decor:(flowerpot|mailbox|fence|rug|stonelantern|scarecrow))$/.test(k)) {
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

/**
 * 装饰：玩家自由摆放，没有固定点位 —— 所以按「白名单 id + 地图范围 + 不重复占用同一格」过滤。
 * 脏档/后续删掉的装饰 id 会被静默丢弃，不会把碰撞铺到任意位置。
 */
function normalizeDecor(raw: unknown): PlacedDecor[] {
  const out: PlacedDecor[] = [];
  if (!Array.isArray(raw)) return out;
  const seen = new Set<string>();
  for (const item of raw) {
    if (!isObj(item)) continue;
    const id = str(item.id, '');
    if (!DECOR_IDS.includes(id)) continue;
    const x = int(item.x, -1);
    const y = int(item.y, -1);
    if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) continue;
    const key = `${x},${y}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id, x, y });
  }
  return out;
}

/** 已兑换的知识升级：只认 KNOWLEDGE_SHOP 里的 id，去重保序 */
function normalizeUnlocked(raw: unknown): string[] {
  const out: string[] = [];
  if (!Array.isArray(raw)) return out;
  const known = new Set(KNOWLEDGE_SHOP.map((k) => k.id));
  for (const v of raw) {
    if (typeof v === 'string' && known.has(v) && !out.includes(v)) out.push(v);
  }
  return out;
}

/**
 * 工具耐久：键只认 TOOLS 里声明了 maxDur 的 id，值夹到 0..maxDur。
 * 旧档（没有 toolDur）按背包补满；耐久 <= 0 视为已损坏 —— 直接从背包移除并丢弃该键，
 * 保证「背包里有镐子 ⇒ 耐久 > 0」这个不变量在读档后始终成立。
 */
function normalizeToolDur(raw: unknown, invRaw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  const src = isObj(raw) ? raw : null;
  for (const tool of TOOLS) {
    const max = toolMaxDur(tool.id);
    if (max <= 0) continue;
    const fromSave = src ? num(src[tool.id], NaN) : NaN;
    let dur: number;
    if (Number.isFinite(fromSave)) {
      dur = Math.max(0, Math.min(max, Math.floor(fromSave)));
    } else {
      // 旧档/缺字段：背包里有这把工具就补满，没有就是 0
      const owned = isObj(invRaw) && int((invRaw as Obj)[tool.id], 0) > 0;
      dur = owned ? max : 0;
    }
    if (dur > 0) out[tool.id] = dur;
  }
  return out;
}

/** 树木按固定点位重建：只认白名单里的点，避免脏档把碰撞铺到任意位置 */
function normalizeTrees(raw: unknown): TreeState[] {
  const byPos = new Map<string, number>();
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!isObj(item)) continue;
      const x = int(item.x, -1);
      const y = int(item.y, -1);
      if (x < 0 || y < 0) continue;
      byPos.set(`${x},${y}`, Math.min(TREE_HP, Math.max(0, int(item.hp, TREE_HP))));
    }
  }
  return TREE_SPOTS.map(([x, y]) => ({ x, y, hp: byPos.get(`${x},${y}`) ?? TREE_HP }));
}

/** 矿脉同样按固定点位重建：只认白名单里的点，脏档不会把碰撞铺到任意位置 */
function normalizeOres(raw: unknown): OreState[] {
  const byPos = new Map<string, number>();
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!isObj(item)) continue;
      const x = int(item.x, -1);
      const y = int(item.y, -1);
      if (x < 0 || y < 0) continue;
      byPos.set(`${x},${y}`, Math.min(ORE_HP, Math.max(0, int(item.hp, ORE_HP))));
    }
  }
  return ORE_SPOTS.map(([x, y]) => ({ x, y, hp: byPos.get(`${x},${y}`) ?? ORE_HP }));
}

/** 矿洞：depth/返回坐标/固定矿脉白名单，全部逐项夹取 */
function normalizeCave(raw: unknown): CaveState {
  const base = defaultCave();
  const o = isObj(raw) ? raw : {};
  const byPos = new Map<string, number>();
  if (Array.isArray(o.ores)) {
    for (const item of o.ores) {
      if (!isObj(item)) continue;
      const x = int(item.x, -1);
      const y = int(item.y, -1);
      if (x < 0 || y < 0) continue;
      byPos.set(`${x},${y}`, Math.min(ORE_HP, Math.max(0, int(item.hp, ORE_HP))));
    }
  }
  return {
    depth: Math.max(1, int(o.depth, base.depth)),
    ores: CAVE_ORE_SPOTS.map(([x, y]) => ({ x, y, hp: byPos.get(`${x},${y}`) ?? ORE_HP })),
    returnX: Math.min(MAP_W - 1, Math.max(0, int(o.returnX, base.returnX))),
    returnY: Math.min(MAP_H - 1, Math.max(0, int(o.returnY, base.returnY))),
  };
}

// ---------------------------------------------------------------- 迁移链
// 用整数格式号链式迁移：`if (fmt < N)`。数字比较天然正确，
// 千万别用版本字符串比较（'1.9' < '1.13' 在字符串下是 false）。

function migrateFrom(raw: Obj, fmt: number): { data: Obj; fmt: number } {
  let data = raw;
  let f = fmt;
  // v1 → v2：新增林区树木；旧档没有 trees，normalizeTrees() 会按固定点位补满，无需改旧字段。
  if (f < 2) f = 2;
  // v2 → v3：新增林区矿脉（含 ore:copper / ore:iron 两种矿石）。
  // 旧档没有 ores，normalizeOres() 会按固定点位补满；矿石键由 normalizeInventory 白名单放行。
  if (f < 3) f = 3;
  // v3 → v4：新增可摆放装饰（World.decor）与 decor:<id> 物品。
  // 旧档没有 decor，normalizeDecor() 会回落成空数组；背包键由 normalizeInventory 白名单放行。
  if (f < 4) f = 4;
  // v4 → v5：工具加耐久（World.toolDur，仿 Minecraft：类型定上限、实例记当前值）。
  // 旧档没有这个字段：normalizeWorld 里按「背包有没有这把工具」补满，这里只推格式号。
  if (f < 5) f = 5;
  // v5 → v6：新增研究（World.knowledge / World.unlocked）。
  // 旧档没有这两个字段：normalizeWorld 里回落成 0 与空数组，这里只推格式号。
  if (f < 6) f = 6;
  // v6 → v7：新增矿洞区域（World.area / World.cave）。
  // 旧档默认回农场；cave 由 normalizeCave() 按固定点位补满。
  if (f < 7) f = 7;
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

  // 区域与矿洞：旧档默认农场；玩家坐标按当前区域夹取
  const area: World['area'] = o.area === 'cave' ? 'cave' : 'farm';
  const cave = o.cave === undefined ? base.cave : normalizeCave(o.cave);
  const maxX = area === 'cave' ? CAVE_W - 1 : MAP_W - 1;
  const maxY = area === 'cave' ? CAVE_H - 1 : MAP_H - 1;

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
    // season —— 必须登记（脏档里的 2.5 / -1 也要落到 0..3 的合法季节）
    season: (((int(o.season, base.season) % 4) + 4) % 4) as Season,
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
    // area / cave —— 必须登记：当前区域与矿洞状态
    area,
    cave,
    // trees —— 必须登记：林区固定点位 + hp
    trees: o.trees === undefined ? base.trees : normalizeTrees(o.trees),
    // ores —— 必须登记：矿脉固定点位 + hp（挖空当天 hp=0，次日 refreshOres 回满）
    ores: o.ores === undefined ? base.ores : normalizeOres(o.ores),
    // decor —— 必须登记：玩家自由摆放的装饰，按 id 白名单 + 范围 + 不重复占格过滤
    decor: o.decor === undefined ? base.decor : normalizeDecor(o.decor),
    // toolDur —— 必须登记：每把工具的当前耐久（键只认 TOOLS 里的 id）
    toolDur: normalizeToolDur(o.toolDur, o.inventory),
    // knowledge —— 必须登记：研究点（非负整数）
    knowledge: Math.max(0, int(o.knowledge, 0)),
    // unlocked —— 必须登记：已兑换的知识升级（白名单 + 去重）
    unlocked: normalizeUnlocked(o.unlocked),
    // inventory —— 必须登记（老档/新档都没有 inventory 时回落初始背包）
    inventory: o.inventory === undefined ? base.inventory : normalizeInventory(o.inventory),
    // playerX / playerY —— 必须登记；夹到当前区域地图内，避免旧档 y=-1 读档后卡在空气墙
    playerX: Math.min(maxX, Math.max(0, int(o.playerX, base.playerX))),
    playerY: Math.min(maxY, Math.max(0, int(o.playerY, base.playerY))),
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

  // 不变量：工具耐久 <= 0 时，背包里不能再留着这把工具（否则会出现"有镐但挖不动"的脏状态）
  for (const tool of TOOLS) {
    if (toolMaxDur(tool.id) > 0 && (w.toolDur[tool.id] ?? 0) <= 0) {
      delete w.inventory[tool.id];
    }
  }

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
    // 带包装的存档必须是我们自己的：别的游戏的 JSON 也能被 normalize 兜住，
    // 那样会静默变成"一个全新的空农场"，用户会以为存档丢了。宁可明确拒绝。
    if (isObj(raw) && typeof raw.app === 'string' && raw.app !== 'vale-farm') return null;
    const data = isObj(raw) && isObj(raw.data) ? raw.data : raw;
    return normalizeWorld(data);
  } catch {
    return null;
  }
}
