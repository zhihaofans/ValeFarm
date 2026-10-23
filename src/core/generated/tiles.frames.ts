// 由 tools/gen_assets.py 生成 —— 请勿手改，改美术请改脚本后重跑 `npm run assets`。
// 帧索引按图集行主序排列，与 Phaser spritesheet 的切帧规则一致。

export const TILE_COLS = 8;

export const TILE = {
  grass_a: 0,
  grass_b: 1,
  grass_c: 2,
  wild: 3,
  tilled_dry: 4,
  tilled_wet: 5,
  path: 6,
  water: 7,
  weed: 8,
  stone: 9,
  stump: 10,
  fence: 11,
  tree: 12,
  house: 13,
  shop: 14,
  bin: 15,
  bed: 16,
  well: 17,
  bench: 18,
  lamp: 19,
  sign: 20,
  ore: 21,
  ornament_pot: 22,
  ornament_mailbox: 23,
  ornament_fence: 24,
  ornament_rug: 25,
  ornament_stonelantern: 26,
  ornament_scarecrow: 27,
} as const;

export type TileName = keyof typeof TILE;
