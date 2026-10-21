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

export interface RecipeDef {
  id: string;
  name: string;
  desc: string;
  /** itemId → 数量 */
  cost: Record<string, number>;
  result: string;
}

/** 制作台配方：木镐先做出来，矿洞系统后续接 */
export const RECIPES: RecipeDef[] = [
  {
    id: 'recipe:pickaxe',
    name: '木镐子',
    desc: '挖矿用（矿洞后续开放）· 3 木头',
    cost: { wood: 3 },
    result: 'tool:pickaxe',
  },
];

/** 背包/制作台展示名 */
export function itemName(id: string): string {
  if (id === 'wood') return '木头';
  if (id === 'tool:pickaxe') return '木镐子';
  if (id === 'tool:can2') return '铜洒水壶';
  if (id === 'tool:hoe2') return '铜锄头';
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
