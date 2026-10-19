// 全局常量：调平衡只改这里。

/** 农田尺寸（可耕种区域 12×10，符合 10×10~16×12 的 MVP 约定） */
export const FARM_W = 12;
export const FARM_H = 10;
/** 农田在整张大地图中的左上角（地图 24×16） */
export const FARM_OX = 3;
export const FARM_OY = 5;

export const MAP_W = 24;
export const MAP_H = 16;
export const TILE_PX = 32;

/** 1 游戏分钟 = 350ms 真实时间 → 一天( awake 6:00→次日2:00, 1200 分钟 )约 7 分钟 */
export const MS_PER_GAME_MINUTE = 350;

export const DAY_START_MINUTE = 360;   // 6:00
export const FORCE_SLEEP_MINUTE = 1560; // 次日 2:00

export const SEASON_DAYS = 28;
export const SEASON_NAMES = ['春', '夏', '秋', '冬'] as const;

export const RAIN_CHANCE = 0.25;

// ---- 体力 ----
export const ENERGY = {
  hoe: 4,
  water: 2,
  plant: 1,
  harvest: 1,
  clearWeed: 3,
  clearStone: 6,
  clearStump: 10,
  talk: 0,
} as const;

export const COLLAPSE_NEXT_DAY_ENERGY_RATIO = 0.5; // 昏倒次日体力减半
export const COLLAPSE_GOLD_PENALTY = 50;

// ---- 初始状态 ----
export const START_GOLD = 150;
export const START_MAX_ENERGY = 100;

// ---- 商店 ----
export const SHOP_OPEN_MINUTE = 9 * 60;    // 9:00 开门
export const SHOP_CLOSE_MINUTE = 22 * 60;  // 22:00 打门

// ---- NPC ----
export const FRIEND_TALK = 2;    // 每日首次对话好感
export const GIFT_NORMAL = 30;
export const GIFT_LOVED = 80;
export const GIFT_WITHERED = -10;

export const SAVE_KEY = 'save';
export const DB_NAME = 'vale-farm';
export const DB_VERSION = 1;
export const SETTINGS_KEY = 'vale-farm.settings';

/** 当前存档格式号：改 World 结构时 +1，并在 save.ts 的 migrateFrom 里加一档 */
export const SAVE_FMT = 1;
