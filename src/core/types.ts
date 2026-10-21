// 世界数据结构 —— 存档的"合同"。
// ⚠️ 新增字段必须同步登记到 save.ts 的 normalizeWorld（逐字段重建），
//    否则会出现「存进去也读不回来」的静默丢档 —— 这类坑不报错、不崩溃。

export type Facing = 'down' | 'left' | 'right' | 'up';

export type CropId = 'radish' | 'pea' | 'corn' | 'pumpkin' | 'strawberry' | 'sweetpotato';

export type Quality = 'norm' | 'sil' | 'gold';

export type Season = 0 | 1 | 2 | 3; // 0 春 1 夏 2 秋 3 冬

export type Weather = 'sun' | 'rain';

export type Obstacle = 'weed' | 'stone' | 'stump';

/** 单个可耕地块 */
export interface Plot {
  /** wild=未开垦（有杂草覆盖）；tilled=已锄干土；watered=已浇水 */
  state: 'wild' | 'tilled' | 'watered';
  crop: CropState | null;
  obstacle: Obstacle | null;
}

export interface CropState {
  type: CropId;
  /** 生长阶段 0..3，3 = 成熟 */
  stage: number;
  /** 当前阶段已浇水天数 */
  progress: number;
  /** 累计缺水天数（决定收获品质） */
  dryDays: number;
  /** 当天是否已浇水 */
  wateredToday: boolean;
  /** 过季枯萎：无法收获也无法生长，只能用锄头清理 */
  withered: boolean;
}

export interface NPCState {
  friendship: number;
  /** 今天是否已送礼（每天一次有效） */
  giftedToday: boolean;
  /** 今天是否已对话 */
  talkedToday: boolean;
  /** 好感里程碑奖励是否已领取 */
  reward100: boolean;
  reward300: boolean;
}

/** 林区的一棵树；hp=0 表示已砍倒，可通过 */
export interface TreeState {
  x: number;
  y: number;
  hp: number;
}

export interface Inventory {
  /** 键约定：`seed:<crop>` | `crop:<crop>:<quality>` | `tool:can2` | `tool:hoe2` | `tool:pickaxe` | `wood` */
  [itemId: string]: number;
}

export interface WorldStats {
  earned: number;
  harvested: number;
  collapsedCount: number;
}

export interface World {
  /** 存档格式号（整数单调递增，迁移用；不要和展示版本号混用） */
  fmt: number;
  /** 游戏第几天，从 1 开始 */
  day: number;
  /** 当天分钟数：0 = 0:00。起床为 360（6:00），凌晨 2 点 = 1560 强制结束 */
  minute: number;
  season: Season;
  weather: Weather;
  gold: number;
  energy: number;
  maxEnergy: number;
  /** 玩家面朝的工具等级：1=基础 2=升级 */
  toolCan: 1 | 2;
  toolHoe: 1 | 2;
  /** 农田地块，长度 = FARM_W * FARM_H，行主序 */
  plots: Plot[];
  /** 林区树木状态（固定点位，hp=0 已砍倒） */
  trees: TreeState[];
  inventory: Inventory;
  playerX: number;
  playerY: number;
  facing: Facing;
  npcs: Record<string, NPCState>;
  /** 昨晚是否昏倒（用于次日晨报文案） */
  collapsedLastNight: boolean;
  stats: WorldStats;
}

export type ToolId = 'hoe' | 'can' | 'seed' | 'hand';
