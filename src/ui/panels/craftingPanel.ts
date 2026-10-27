// 制作台面板（四个页签：配方 / 加工 / 研究 / 兑换）。
//
// 拆成独立文件的原因与其它面板一致：UIScene 只保留"开关面板 + 暂停"，面板自己管内容。
//
// 加工（D1）见 core/data.ts 的 PROCESSES：原料 → 半成品，产物可堆叠；
// 站点（工作台/熔炉）目前只是分组标签，没有建造门槛，所以没有新增存档字段。
// 研究与兑换的设计见 core/research.ts：
//   · 研究 = 把多余产出换成知识点（原料少、成品多、矿石比木材值钱）
//   · 兑换 = 用知识点换**已有机制**（铜锄头 / 铜洒水壶 / 体力上限），不引入新系统

import type Phaser from 'phaser';
import { SFX } from '../../core/audio';
import { KNOWLEDGE_SHOP, PROCESSES, RECIPES, itemName } from '../../core/data';
import { countItem, craft, processItem } from '../../core/economy';
import {
  isUnlocked, redeemKnowledge, researchItem, researchableEntries,
} from '../../core/research';
import type { World } from '../../core/types';
import { label, makePanel, textButton, type Panel } from '../widgets';

export interface CraftingPanelDeps {
  scene: Phaser.Scene;
  world: World;
  toast: (text: string) => void;
  onClose: () => void;
}

type Tab = 'recipe' | 'process' | 'research' | 'exchange';

export function buildCraftingPanel(deps: CraftingPanelDeps): Panel {
  const { scene: s, world: w } = deps;
  const panel = makePanel(s, '制作台', deps.onClose);
  let tab: Tab = 'recipe';

  const render = (): void => {
    panel.body.removeAll(true);
    const mk = (text: string, t: Tab, x: number) =>
      textButton(s, x, 8, 100, 34, text, () => { tab = t; render(); },
        { bg: tab === t ? 0x3f7d5a : 0x5b5044, fontSize: 15 });
    panel.body.add([
      mk('配方', 'recipe', -180), mk('加工', 'process', -60),
      mk('研究', 'research', 60), mk('兑换', 'exchange', 180),
    ]);
    if (tab === 'recipe') renderRecipe();
    else if (tab === 'process') renderProcess();
    else if (tab === 'research') renderResearch();
    else renderExchange();
  };

  const renderRecipe = (): void => {
    panel.body.add(label(s, -270, 24, `木头：${countItem(w.inventory, 'wood')}`, { size: 16, color: '#f2e06a' }));
    let y = 66;
    for (const recipe of RECIPES) {
      const owned = recipe.result.startsWith('tool:') && countItem(w.inventory, recipe.result) > 0;
      const enough = Object.entries(recipe.cost).every(([id, n]) => countItem(w.inventory, id) >= n);
      panel.body.add(label(s, -270, y, recipe.name, { size: 18, color: '#f4ead8' }));
      panel.body.add(label(s, -270, y + 24,
        `${recipe.desc} · 木头 ${countItem(w.inventory, 'wood')} / ${recipe.cost.wood ?? 0}`,
        { size: 14, color: '#c9a06b' }));
      panel.body.add(textButton(s, 180, y + 20, 150, 40, owned ? '已拥有' : enough ? '制作' : '材料不足', () => {
        if (owned) return;
        const r = craft(w, recipe.id);
        deps.toast(r.text);
        if (r.ok) SFX.coin(); else SFX.fail();
        render();
      }, { bg: owned ? 0x555f55 : enough ? 0x3f7d5a : 0x5b5044, fontSize: 16 }));
      y += 92;
    }
    panel.body.add(label(s, -270, y + 16,
      '砍树得木头；做好木镐后去林区北侧岩壁挖矿脉（每处 3 下，每天刷新）。',
      { size: 13, color: '#c9a06b' }));
  };

  const renderProcess = (): void => {
    let y = 52;
    panel.body.add(label(s, -270, 24,
      `木头 ${countItem(w.inventory, 'wood')} · 铜矿石 ${countItem(w.inventory, 'ore:copper')}`,
      { size: 15, color: '#f2e06a' }));
    for (const proc of PROCESSES) {
      const enough = Object.entries(proc.cost).every(([id, n]) => countItem(w.inventory, id) >= n);
      const have = countItem(w.inventory, proc.result);
      panel.body.add(label(s, -270, y + 14, `${proc.name}  ×${have}`, { size: 18, color: '#f4ead8' }));
      panel.body.add(label(s, -140, y + 15, `[${proc.station}]`, { size: 12, color: '#8fc7a6' }));
      panel.body.add(label(s, -270, y + 38, proc.desc, { size: 13, color: '#c9a06b' }));
      panel.body.add(textButton(s, 180, y + 24, 150, 40, enough ? '加工' : '材料不足', () => {
        if (!enough) { SFX.fail(); return; }
        const r = processItem(w, proc.id);
        deps.toast(r.text);
        if (r.ok) SFX.coin(); else SFX.fail();
        render();
      }, { bg: enough ? 0x3f7d5a : 0x5b5044, fontSize: 16 }));
      y += 84;
    }
    panel.body.add(label(s, -270, y + 18,
      '加工品比原料值钱，研究也更划算（木板 3 点 / 金属锭 8 点）；',
      { size: 13, color: '#c9a06b' }));
    panel.body.add(label(s, -270, y + 40,
      '卖的话去杂货铺「出售」页，那里会把加工品单独列出来。',
      { size: 13, color: '#c9a06b' }));
  };

  const renderResearch = (): void => {
    panel.body.add(label(s, -270, 20, `知识点：${w.knowledge}`, { size: 17, color: '#f2e06a' }));
    panel.body.add(label(s, -270, 44,
      '把多余的作物 / 矿石 / 木头研究掉换知识点；工具、种子、装饰不能研究。',
      { size: 13, color: '#c9a06b' }));

    const entries = researchableEntries(w.inventory);
    if (entries.length === 0) {
      panel.body.add(label(s, -260, 86, '背包里没有可研究的东西。先去收获或挖矿。',
        { size: 14, color: '#c9a06b' }));
    }
    let y = 78;
    for (const e of entries.slice(0, 6)) {
      panel.body.add(label(s, -270, y + 14,
        `${itemName(e.id)} ×${e.n}   每件 +${e.points} 点`, { size: 15 }));
      panel.body.add(textButton(s, 190, y + 12, 120, 36, '研究 ×1', () => {
        const r = researchItem(w, e.id);
        deps.toast(r.text);
        if (r.ok) SFX.harvest(); else SFX.fail();
        render();
      }, { fontSize: 15 }));
      y += 42;
    }
  };

  const renderExchange = (): void => {
    panel.body.add(label(s, -270, 20, `知识点：${w.knowledge}`, { size: 17, color: '#f2e06a' }));
    panel.body.add(label(s, -270, 44, '知识点换的是已有机制，不花金币 —— 钱会溢出，知识点不会。',
      { size: 13, color: '#c9a06b' }));
    let y = 78;
    for (const item of KNOWLEDGE_SHOP) {
      const done = isUnlocked(w, item.id);
      const ownedTool = (item.id === 'kn:hoe2' && w.toolHoe === 2)
        || (item.id === 'kn:can2' && w.toolCan === 2);
      const affordable = w.knowledge >= item.cost;
      const soldOut = done || ownedTool;
      const tag = soldOut ? '已拥有' : affordable ? '兑换' : '点数不足';
      panel.body.add(label(s, -270, y + 12, `${item.name}  ${item.cost} 点`, { size: 16 }));
      panel.body.add(label(s, -270, y + 32, item.desc, { size: 13, color: '#c9a06b' }));
      panel.body.add(textButton(s, 190, y + 16, 120, 38, tag, () => {
        if (soldOut) return;
        const r = redeemKnowledge(w, item.id);
        deps.toast(r.text);
        if (r.ok) SFX.coin(); else SFX.fail();
        render();
      }, { bg: soldOut ? 0x555f55 : affordable ? 0x3f7d5a : 0x5b5044, fontSize: 15 }));
      y += 64;
    }
  };

  render();
  return panel;
}
