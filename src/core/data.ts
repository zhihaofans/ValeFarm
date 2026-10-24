// 静态游戏数据：作物、NPC、价格、对话。全部原创，不引用任何第三方游戏素材。

import type { CropId, Quality, Season } from './types';

export interface CropDef {
  id: CropId;
  name: string;
  /** 可种植的季节 */
  seasons: Season[];
  /** 阶段 0..3（3 = 成熟）；stageThresholds[i] = 进入阶段 i+1 所需的累计浇水天数 */
  stageThresholds: [number, number, number];
  seedPrice: number;
  baseSell: number;
  /** 商店图标帧（ui 图集） */
  uiFrame: string;
}

export const CROPS: Record<CropId, CropDef> = {
  radish: {
    id: 'radish',
    name: '四季萝卜',       // 四季可种，冬天也有事做
    seasons: [0, 1, 2, 3],
    stageThresholds: [1, 1, 1],   // 3 天成熟
    seedPrice: 20,
    baseSell: 45,
    uiFrame: 'radish',
  },
  pea: {
    id: 'pea',
    name: '糖荚豌豆',
    seasons: [0, 2],              // 春 / 秋
    stageThresholds: [1, 1, 2],   // 4 天
    seedPrice: 35,
    baseSell: 80,
    uiFrame: 'pea',
  },
  corn: {
    id: 'corn',
    name: '金穗玉米',
    seasons: [1, 2],              // 夏 / 秋
    stageThresholds: [1, 2, 2],   // 5 天
    seedPrice: 50,
    baseSell: 120,
    uiFrame: 'corn',
  },
  pumpkin: {
    id: 'pumpkin',
    name: '灯笼南瓜',
    seasons: [2],                 // 秋
    stageThresholds: [2, 2, 2],   // 6 天
    seedPrice: 90,
    baseSell: 240,
    uiFrame: 'pumpkin',
  },
  strawberry: {
    id: 'strawberry',
    name: '红莓草莓',
    seasons: [0],                 // 春
    stageThresholds: [1, 1, 2],   // 4 天
    seedPrice: 40,
    baseSell: 95,
    uiFrame: 'strawberry',
  },
  sweetpotato: {
    id: 'sweetpotato',
    name: '蜜心红薯',
    seasons: [2],                 // 秋
    stageThresholds: [2, 1, 2],   // 5 天
    seedPrice: 55,
    baseSell: 125,
    uiFrame: 'sweetpotato',
  },
};

export const CROP_ORDER: CropId[] = ['radish', 'pea', 'corn', 'pumpkin', 'strawberry', 'sweetpotato'];

/** 每日特价：当季种子里按天轮换一种，8 折 */
export const DAILY_SEED_DISCOUNT = 0.8;

export function dailySeedSpecial(
  season: Season,
  day: number,
): { crop: CropId; price: number; discount: number } | null {
  const seeds = CROP_ORDER.filter((c) => CROPS[c].seasons.includes(season));
  if (seeds.length === 0) return null;
  const crop = seeds[(Math.max(1, Math.floor(day)) - 1) % seeds.length];
  return {
    crop,
    price: Math.max(1, Math.round(CROPS[crop].seedPrice * DAILY_SEED_DISCOUNT)),
    discount: DAILY_SEED_DISCOUNT,
  };
}

/** 品质售价系数与名称 */
export const QUALITY: Record<Quality, { mult: number; name: string; frame: string | null }> = {
  norm: { mult: 1, name: '普通', frame: null },
  sil: { mult: 1.5, name: '银星', frame: 'star_silver' },
  gold: { mult: 2, name: '金星', frame: 'star_gold' },
};

export function sellPrice(crop: CropId, q: Quality): number {
  return Math.round(CROPS[crop].baseSell * QUALITY[q].mult);
}

/** 工具升级（商店出售，一次性） */
export const TOOL_UPGRADES = [
  {
    id: 'tool:can2',
    name: '铜洒水壶',
    desc: '一次浇灌面朝格及其两侧共 3 格',
    price: 800,
  },
  {
    id: 'tool:hoe2',
    name: '铜锄头',
    desc: '一次开垦面朝格及前方共 2 格',
    price: 500,
  },
] as const;

// ---------------------------------------------------------------- 林区 / 制作

/** 林区树木固定点位（tile）；不在道路/水塘/农田上 */
export const TREE_SPOTS: Array<[number, number]> = [
  [26, 5], [29, 6], [32, 4], [35, 6], [38, 8],
  [27, 9], [31, 10], [34, 9], [37, 11],
  [26, 13], [30, 13], [34, 13],
];

// ---------------------------------------------------------------- 矿脉

/** 矿脉固定点位：林区北侧岩壁一线（tile）；避开树木/道路/水塘 */
export const ORE_SPOTS: Array<[number, number]> = [
  [25, 1], [29, 1], [33, 1], [37, 2],
];

/** 矿石收购价（商店出售页 = 出货箱） */
export const ORE_SELL: Record<string, number> = {
  'ore:copper': 22,
  'ore:iron': 58,
};

export const ORE_IDS = ['ore:copper', 'ore:iron'] as const;

export interface RecipeDef {
  id: string;
  name: string;
  desc: string;
  /** itemId → 数量 */
  cost: Record<string, number>;
  result: string;
}

/** 制作台配方：木镐 → 林区北侧岩壁挖矿脉 */
export const RECIPES: RecipeDef[] = [
  {
    id: 'recipe:pickaxe',
    name: '木镐子',
    desc: '挖矿用（耐久 30）· 3 木头',
    cost: { wood: 3 },
    result: 'tool:pickaxe',
  },
];

// ---------------------------------------------------------------- 研究（知识点）

/**
 * 把物品"研究掉"能换多少知识点。
 * 原则：原料少、成品多；矿石比木材值钱；品质越高越多。
 * 只放固定分值，不做随机 —— 玩家要能算清楚"我该研究什么"。
 */
export const RESEARCH_POINTS: Record<string, number> = {
  wood: 1,
  'ore:copper': 3,
  'ore:iron': 6,
};

/** 作物按品质给分（键是品质） */
export const RESEARCH_CROP_POINTS: Record<string, number> = {
  norm: 2,
  sil: 3,
  gold: 4,
};

/** 某物品研究一次得多少点；不支持研究的返回 0 */
export function researchPointsOf(itemId: string): number {
  if (itemId.startsWith('crop:')) {
    const q = itemId.split(':')[2] ?? 'norm';
    return RESEARCH_CROP_POINTS[q] ?? 0;
  }
  return RESEARCH_POINTS[itemId] ?? 0;
}

export interface KnowledgeShopItem {
  id: string;
  name: string;
  desc: string;
  cost: number;
}

/**
 * 知识点能换什么。
 * 设计意图：给后期一条**不依赖金币**的成长线 —— 钱会溢出，知识点不会。
 * 两条都复用已有机制（工具升级 / 体力上限），不引入新系统。
 */
export const KNOWLEDGE_SHOP: KnowledgeShopItem[] = [
  { id: 'kn:hoe2', name: '铜锄头', desc: '一次开垦 2 格（等同商店 500G 的那件）', cost: 40 },
  { id: 'kn:can2', name: '铜洒水壶', desc: '一次浇 3 格（等同商店 800G 的那件）', cost: 60 },
  { id: 'kn:stamina', name: '体力上限 +10', desc: '最大体力 +10（只能换一次）', cost: 50 },
];

// ---------------------------------------------------------------- 工具（耐久挂在物品定义上）

/**
 * 工具的物品定义。耐久放这里而不是写在世界状态里，加新工具只要加一行：
 *   - `maxDur` = 满耐久；背包里那把当前剩多少，存在 `World.toolDur[id]`
 *   - 没有耐久概念的工具（未来的水壶等）不写 maxDur 即可
 */
export interface ToolDef {
  id: string;
  name: string;
  /** 满耐久；缺省 = 该工具没有耐久 */
  maxDur?: number;
}

export const TOOLS: ToolDef[] = [
  { id: 'tool:pickaxe', name: '木镐子', maxDur: 30 },
];

export function toolDef(id: string): ToolDef | undefined {
  return TOOLS.find((t) => t.id === id);
}

/** 满耐久；没有耐久概念的工具返回 0 */
export function toolMaxDur(id: string): number {
  return toolDef(id)?.maxDur ?? 0;
}

// ---------------------------------------------------------------- 装饰

/**
 * 可摆放的装饰。价格按"卖 1~4 次收成能买一件"来定，避免变成纯钱坑。
 * `blocks` = 摆上去是否挡路（野餐布可以踩，稻草人挡路）；`tile` 是 tiles 图集里的帧名，
 * 第 2 步生成美术时用（这里先存字符串，避免和生成的 TILE 常量互相牵制）。
 */
export interface DecorDef {
  id: string;
  name: string;
  price: number;
  blocks: boolean;
  tile: string;
}

export const DECORS: DecorDef[] = [
  { id: 'decor:flowerpot', name: '陶土花盆', price: 60, blocks: true, tile: 'ornament_pot' },
  { id: 'decor:mailbox', name: '小邮箱', price: 90, blocks: true, tile: 'ornament_mailbox' },
  { id: 'decor:fence', name: '木栅栏段', price: 40, blocks: true, tile: 'ornament_fence' },
  { id: 'decor:rug', name: '野餐布', price: 70, blocks: false, tile: 'ornament_rug' },
  { id: 'decor:stonelantern', name: '石灯笼', price: 150, blocks: true, tile: 'ornament_stonelantern' },
  { id: 'decor:scarecrow', name: '稻草人', price: 220, blocks: true, tile: 'ornament_scarecrow' },
];

export const DECOR_IDS: string[] = DECORS.map((d) => d.id);

export function decorDef(id: string): DecorDef | undefined {
  return DECORS.find((d) => d.id === id);
}

/** 背包/制作台展示名 */
export function itemName(id: string): string {
  if (id === 'wood') return '木头';
  if (id === 'tool:pickaxe') return '木镐子';
  if (id === 'tool:can2') return '铜洒水壶';
  if (id === 'tool:hoe2') return '铜锄头';
  const dec = DECORS.find((d) => d.id === id);
  if (dec) return dec.name;
  if (id === 'ore:copper') return '铜矿石';
  if (id === 'ore:iron') return '铁矿石';
  if (id.startsWith('seed:')) {
    const crop = id.slice(5) as CropId;
    return CROPS[crop] ? `${CROPS[crop].name}种子` : id;
  }
  if (id.startsWith('crop:')) {
    const [, crop, q] = id.split(':') as [string, CropId, Quality];
    return CROPS[crop] ? `${CROPS[crop].name}（${QUALITY[q]?.name ?? q}）` : id;
  }
  return id;
}

// ---------------------------------------------------------------- NPC

export interface NpcDef {
  id: string;
  name: string;
  color: number;      // 头顶名牌
  /** 固定站位（大地图 tile 坐标） */
  home: { x: number; y: number };
  lovedGift: CropId;
  /** 里程碑：好感达到 → 一次性奖励 */
  rewards: { at: number; text: string; gold?: number; seeds?: { crop: CropId; n: number } }[];
  lines: { tier: 0 | 1 | 2; text: string }[];
}

export const NPCS: NpcDef[] = [
  {
    id: 'mira',
    name: '米拉',
    color: 0x9a6fd0,
    home: { x: 18, y: 4 },
    lovedGift: 'pea',
    rewards: [
      { at: 100, text: '这点种子你拿去试一试吧，别嫌少。', seeds: { crop: 'radish', n: 10 } },
      { at: 300, text: '这钱你先拿去扩产，就当我入了股！', gold: 500 },
    ],
    lines: [
      { tier: 0, text: '你是新搬来的农场主吧？这片地荒了好些年了。' },
      { tier: 0, text: '种子铺就在我旁边，记得看季节买种。' },
      { tier: 0, text: '杂草要清干净，不然没地可锄。' },
      { tier: 0, text: '今天风向不错，晒谷子正合适。' },
      { tier: 0, text: '山里的泉水甜，浇出来的菜也甜。' },
      { tier: 1, text: '你的田越来越像样了，路过闻着都香。' },
      { tier: 1, text: '下雨天就歇着吧，老天爷替你浇水。' },
      { tier: 1, text: '你上次送的菜我腌起来了，冬天配粥正好。' },
      { tier: 1, text: '镇上的旅人问起这片田，我说是你的。' },
      { tier: 1, text: '别总一个人忙，累了就来铺子坐坐。' },
      { tier: 2, text: '有你在，这山谷都热闹起来了。' },
      { tier: 2, text: '说真的，谢谢你常来看我。' },
      { tier: 2, text: '要是哪天累了，就来铺子坐坐，别硬撑。' },
      { tier: 2, text: '等春天到了，我们一起在田边种一排花吧。' },
      { tier: 2, text: '这片田有你照看，我放心。' },
    ],
  },
];

/** 图集行（player/npc spritesheet）：0 下 1 左 2 右 3 上 */
export const DIR_ROW: Record<string, number> = { down: 0, left: 1, right: 2, up: 3 };
