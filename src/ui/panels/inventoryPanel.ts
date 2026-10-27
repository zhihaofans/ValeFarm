// 物品栏面板（UIScene 拆分第二块）。
//
// 纯展示：只读 World（背包含量、工具等级、镐子耐久），不写任何状态，
// 也不改游戏时间 —— 面板开关与暂停由调用方（UIScene）负责。

import type Phaser from 'phaser';
import { CROPS, CROP_ORDER, itemName, toolMaxDur } from '../../core/data';
import { countItem, cropEntries, matEntries, oreEntries } from '../../core/economy';
import { toolDur } from '../../core/tools';
import type { World } from '../../core/types';
import { label, makePanel, type Panel } from '../widgets';

export interface InventoryPanelDeps {
  scene: Phaser.Scene;
  world: World;
  onClose: () => void;
}

/** 分两列展示：左列种子/材料，右列作物/工具 */
export function buildInventoryPanel(deps: InventoryPanelDeps): Panel {
  const { scene: s, world: w } = deps;
  const panel = makePanel(s, '物品栏', deps.onClose);

  const seedLines = CROP_ORDER
    .map((c) => ({ c, n: countItem(w.inventory, 'seed:' + c) }))
    .filter((e) => e.n > 0)
    .map((e) => `${CROPS[e.c].name}种子 ×${e.n}`);

  const cropLines = cropEntries(w.inventory).map((e) =>
    `${itemName(`crop:${e.crop}:${e.quality}`)} ×${e.n}`);

  const materialLines = [`木头 ×${countItem(w.inventory, 'wood')}`];
  for (const e of oreEntries(w.inventory)) materialLines.push(`${itemName(e.id)} ×${e.n}`);
  // 加工品（D1）：和原料同列，玩家一眼能看出"该不该再加工"
  for (const e of matEntries(w.inventory)) materialLines.push(`${itemName(e.id)} ×${e.n}`);

  const toolLines: string[] = [];
  toolLines.push(w.toolCan === 2 ? '铜洒水壶（3 格浇水）' : '旧洒水壶');
  toolLines.push(w.toolHoe === 2 ? '铜锄头（2 格开垦）' : '旧锄头');
  if (countItem(w.inventory, 'tool:pickaxe') > 0) {
    toolLines.push(`木镐子（耐久 ${toolDur(w, 'tool:pickaxe')}/${toolMaxDur('tool:pickaxe')}）`);
  }

  /** 画一列区块，返回下一个可用的 y（行数超出 max 时折成"…还有 N 项"） */
  const drawBlock = (x: number, startY: number, title: string, lines: string[], max = 8): number => {
    panel.body.add(label(s, x, startY, title, { size: 15, color: '#f2e06a' }));
    let yy = startY + 24;
    for (const line of lines.slice(0, max)) {
      panel.body.add(label(s, x + 8, yy, line, { size: 14 }));
      yy += 21;
    }
    if (lines.length > max) {
      panel.body.add(label(s, x + 8, yy, `…还有 ${lines.length - max} 项`, { size: 12, color: '#c9a06b' }));
      yy += 18;
    }
    return yy + 8;
  };

  let leftY = 24;
  leftY = drawBlock(-270, leftY, '种子', seedLines, 6);
  leftY = drawBlock(-270, leftY, '材料', materialLines, 5);
  let rightY = 24;
  rightY = drawBlock(10, rightY, '作物', cropLines, 6);
  rightY = drawBlock(10, rightY, '工具', toolLines, 8);

  const bottom = Math.max(leftY, rightY);
  if (bottom < 290) {
    panel.body.add(label(s, -270, bottom + 8,
      '砍树：站到树旁边，面朝树按「互动」。挖矿：带木镐去林区北侧岩壁。',
      { size: 12, color: '#c9a06b' }));
  }

  return panel;
}
