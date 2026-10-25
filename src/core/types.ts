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

/** 林区的一棵矿脉；hp=0 表示当天已挖空，次日清晨恢复 */
export interface OreState {
  x: number;
  y: number;
  hp: number;
}

export type AreaId = 'farm' | 'cave';

/** 单层矿洞状态；depth 先固定 1，为后续多层预留 */
export interface CaveState {
  depth: number;
  ores: OreState[];
  /** 进洞前在农场/林区的坐标，出洞时回到这里 */
  returnX: number;
  returnY: number;
}

/** 摆放出来的装饰：id 必须是 DECORS 里的一个（白名单，读档时校验） */
export interface PlacedDecor {
  id: string;
  x: number;
  y: number;
}

export interface Inventory {
  /** 键约定：`seed:<crop>` | `crop:<crop>:<quality>` | `tool:can2` | `tool:hoe2` | `tool:pickaxe` | `wood` | `ore:copper` | `ore:iron` | `decor:<id>` */
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
  /** 玩家当前所在区域；矿洞是独立小房间，但复用同一套移动/UI */
  area: AreaId;
  /** 矿洞状态（固定点位矿脉 + 返回坐标） */
  cave: CaveState;
  /** 林区矿脉状态（固定点位，hp=0 当天已挖空，次日恢复） */
  ores: OreState[];
  /** 已摆放的装饰（玩家自由摆放，读档时按 DECORS 白名单 + 地图范围过滤） */
  decor: PlacedDecor[];
  /**
   * 工具当前耐久：`{ 'tool:pickaxe': 24 }`。
   * 满耐久/是否有耐久概念都在 data.ts 的 `TOOLS` 里定义（仿 Minecraft：类型定上限、实例记当前值）。
   * 键只允许 TOOLS 里的 id；耐久归零的物品会被移除。
   */
  /** 研究点（知识点）：把多余产出"研究掉"换来的，用于兑换升级 */
  knowledge: number;
  /** 已兑换的知识升级 id（白名单，防重复购买） */
  unlocked: string[];
  toolDur: Record<string, number>;
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
