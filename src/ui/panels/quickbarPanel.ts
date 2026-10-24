// 快捷栏选择器面板（UIScene 拆分第三块）。
//
// 三个页签：种子 / 道具 / 装饰。
// 为什么分成页签：种子最多 6 种、道具 2 种、装饰 6 件，全塞一列会把内容顶出面板
// （面板可用高度约 316 CSS px）。页签这种做法与商店面板一致，不新造结构。
//
// 面板只负责"列出可选项 + 把选择结果回调出去"；选中后要做的事
// （记住当前物品、切换播种用的种子、刷新槽位显示）留在场景侧，因为它牵涉 UI 状态。

import type Phaser from 'phaser';
import { CROPS, CROP_ORDER, itemName, toolMaxDur } from '../../core/data';
import { toolDur } from '../../core/tools';
import { countItem, decorEntries } from '../../core/economy';
import type { World } from '../../core/types';
import { label, makePanel, textButton, type Panel } from '../widgets';

export interface QuickbarPanelDeps {
  scene: Phaser.Scene;
  world: World;
  /** 当前选中的物品 id（用来高亮） */
  currentItem: string | null;
  /** 选中回调；面板会在回调之后自己关闭 */
  onSelect: (id: string) => void;
  onClose: () => void;
}

type Tab = 'seed' | 'item' | 'decor';

export function buildQuickbarPanel(deps: QuickbarPanelDeps): Panel {
  const { scene: s, world: w } = deps;
  const panel = makePanel(s, '快捷栏', deps.onClose);

  const select = (id: string): void => {
    deps.onSelect(id);
    panel.close();
  };

  const button = (x: number, y: number, text: string, id: string) =>
    textButton(s, x, y, 230, 36, text, () => select(id),
      { bg: deps.currentItem === id ? 0x8a6a2a : 0x3f7d5a, fontSize: 15 });

  const renderSeeds = (): void => {
    const seeds = CROP_ORDER.filter((c) => countItem(w.inventory, 'seed:' + c) > 0);
    panel.body.add(label(s, -270, 56, '选一种种子，面朝已开垦的地按「互动」播种。', { size: 13, color: '#c9a06b' }));
    if (seeds.length === 0) {
      panel.body.add(label(s, -260, 96, '没有种子，去商店买吧。', { size: 14, color: '#c9a06b' }));
    }
    seeds.forEach((c, i) => {
      const id = `seed:${c}`;
      const x = i % 2 === 0 ? -140 : 140;
      const y = 92 + Math.floor(i / 2) * 44;
      panel.body.add(button(x, y, `${CROPS[c].name} ×${countItem(w.inventory, id)}`, id));
    });
  };

  const renderItems = (): void => {
    panel.body.add(label(s, -270, 56, '道具 / 材料：目前只切换快捷显示。', { size: 13, color: '#c9a06b' }));
    const items: Array<{ id: string; label: string }> = [];
    const wood = countItem(w.inventory, 'wood');
    if (wood > 0) items.push({ id: 'wood', label: `木头 ×${wood}` });
    if (countItem(w.inventory, 'tool:pickaxe') > 0) {
      // 耐久必须显示出来：挖矿是"手持 + 耐久"两道门槛，看不见剩余耐久等于让玩家盲挖
      items.push({
        id: 'tool:pickaxe',
        label: `木镐子 耐久 ${toolDur(w, 'tool:pickaxe')}/${toolMaxDur('tool:pickaxe')}`,
      });
    }
    if (items.length === 0) {
      panel.body.add(label(s, -260, 96, '暂无可切换道具，去林区砍树试试。', { size: 14, color: '#c9a06b' }));
    }
    items.forEach((it, i) => {
      const x = i % 2 === 0 ? -140 : 140;
      const y = 92 + Math.floor(i / 2) * 44;
      panel.body.add(button(x, y, it.label, it.id));
    });
  };

  const renderDecor = (): void => {
    const decors = decorEntries(w.inventory);
    panel.body.add(label(s, -270, 56, '选中后对着空地按「互动」摆放；对着已摆放的按「互动」收回。',
      { size: 13, color: '#c9a06b' }));
    if (decors.length === 0) {
      panel.body.add(label(s, -260, 100, '没有装饰：去杂货铺的「装饰」页买一件。', { size: 14, color: '#c9a06b' }));
    }
    decors.forEach((d, i) => {
      const x = i % 2 === 0 ? -140 : 140;
      const y = 96 + Math.floor(i / 2) * 44;
      panel.body.add(button(x, y, `${itemName(d.id)} ×${d.n}`, d.id));
    });
  };

  let tab: Tab = 'seed';
  const render = (): void => {
    panel.body.removeAll(true);
    const mk = (text: string, t: Tab, x: number) =>
      textButton(s, x, 8, 100, 34, text, () => { tab = t; render(); },
        { bg: tab === t ? 0x3f7d5a : 0x5b5044, fontSize: 15 });
    panel.body.add([mk('种子', 'seed', -180), mk('道具', 'item', -60), mk('装饰', 'decor', 60)]);
    if (tab === 'seed') renderSeeds();
    else if (tab === 'item') renderItems();
    else renderDecor();
  };
  render();

  return panel;
}
