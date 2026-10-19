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
};

export const CROP_ORDER: CropId[] = ['radish', 'pea', 'corn', 'pumpkin'];

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
      { tier: 1, text: '你的田越来越像样了，路过闻着都香。' },
      { tier: 1, text: '下雨天就歇着吧，老天爷替你浇水。' },
      { tier: 2, text: '有你在，这山谷都热闹起来了。' },
      { tier: 2, text: '说真的，谢谢你常来看我。' },
    ],
  },
];

/** 图集行（player/npc spritesheet）：0 下 1 左 2 右 3 上 */
export const DIR_ROW: Record<string, number> = { down: 0, left: 1, right: 2, up: 3 };
