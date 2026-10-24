// 杂货铺面板（UIScene 拆分第四块，也是最大的一块）。
//
// 四个页签：买种子 / 出售 / 工具 / 装饰。
// 面板只做「展示 + 触发动作 + 重画自己」，动作全走 core 的纯函数
// （buySeed / sellCrop / sellOre / buyToolUpgrade / buyDecor），
// 音效直接调 core/audio 的单例，不经过场景。

import type Phaser from 'phaser';
import { SFX } from '../../core/audio';
import {
  CROPS, DECORS, QUALITY, TOOL_UPGRADES, dailySeedSpecial, itemName,
} from '../../core/data';
import {
  buySeed, buyToolUpgrade, countItem, cropEntries, oreEntries,
  seasonSeeds, sellAllCrops, sellAllOres, sellCrop, sellOre,
} from '../../core/economy';
import { buyDecor } from '../../core/decor';
import { marketTip, sellMultiplier } from '../../core/market';
import type { World } from '../../core/types';
import { label, makePanel, textButton, type Panel } from '../widgets';

export type ShopTab = 'seed' | 'sell' | 'tool' | 'decor';

export interface ShopPanelDeps {
  scene: Phaser.Scene;
  world: World;
  initialTab?: ShopTab;
  toast: (text: string) => void;
  onClose: () => void;
}

export function buildShopPanel(deps: ShopPanelDeps): Panel {
  const { scene: s, world: w } = deps;
  const panel = makePanel(s, '杂货铺', deps.onClose);
  let tab: ShopTab = deps.initialTab ?? 'seed';

  const render = (): void => {
    panel.body.removeAll(true);
    const mk = (text: string, t: ShopTab, x: number) =>
      textButton(s, x, 8, 100, 34, text, () => { tab = t; render(); },
        { bg: tab === t ? 0x3f7d5a : 0x5b5044, fontSize: 15 });
    panel.body.add([mk('买种子', 'seed', -180), mk('出售', 'sell', -60), mk('工具', 'tool', 60), mk('装饰', 'decor', 180)]);
    if (tab === 'seed') renderSeedTab();
    else if (tab === 'sell') renderSellTab();
    else if (tab === 'tool') renderToolTab();
    else renderDecorTab();
  };

  const renderSeedTab = (): void => {
    let y = 44;
    const seeds = seasonSeeds(w.season);
    const special = dailySeedSpecial(w.season, w.day);
    if (seeds.length === 0) {
      panel.body.add(label(s, -260, y + 30, '这个季节没有种子出售。'));
    }
    for (const c of seeds) {
      const def = CROPS[c];
      const specialPrice = special?.crop === c ? special.price : null;
      const unit = specialPrice ?? def.seedPrice;
      const days = def.stageThresholds.reduce((a, b) => a + b, 0);
      const priceLine = specialPrice !== null
        ? `★${def.name} ${unit}G（原${def.seedPrice}G）`
        : `${def.name} ${def.seedPrice}G`;
      panel.body.add(label(s, -270, y + 20, `${priceLine} · ${days}天 · 卖${def.baseSell}G`, { size: 15 }));

      const buy = (n: number) => {
        const r = buySeed(w, c, n);
        deps.toast(r.text);
        if (r.ok) SFX.coin();
        render();
      };
      panel.body.add([
        textButton(s, 150, y + 24, 80, 34, '买 1', () => buy(1), { fontSize: 15 }),
        textButton(s, 244, y + 24, 80, 34, '买 5', () => buy(5), { fontSize: 15 }),
      ]);
      y += 46;
    }
    panel.body.add(label(s, -270, y + 20, `当前金币：${w.gold}G`, { color: '#f2e06a' }));
  };

  const renderSellTab = (): void => {
    const entries = cropEntries(w.inventory);
    const ores = oreEntries(w.inventory);
    let y = 44;

    // 集市日把倍率写在最上面：玩家一眼知道要不要"攒到今天卖"
    const mult = sellMultiplier(w);
    const market = marketTip(w);
    if (market) {
      panel.body.add(label(s, -270, y - 6, `★ ${market}（当前 ×${mult.toFixed(2)}）`,
        { size: 14, color: '#f2e06a' }));
      y += 26;
    }
    if (entries.length === 0 && ores.length === 0) {
      panel.body.add(label(s, -260, y + 30, '背包里没有可出售的东西。先去田里收获，或去林区挖矿。'));
    }

    for (const e of entries.slice(0, 5)) {
      const qName = QUALITY[e.quality].name;
      panel.body.add(label(s, -270, y + 20, `${CROPS[e.crop].name}（${qName}）× ${e.n}   单价 ${e.unit}G`));
      panel.body.add([
        textButton(s, 170, y + 24, 70, 34, '卖 1', () => {
          const r = sellCrop(w, e.crop, e.quality, 1);
          deps.toast(r.text); if (r.ok) SFX.coin();
          render();
        }, { fontSize: 15 }),
        textButton(s, 254, y + 24, 70, 34, '全卖', () => {
          const r = sellCrop(w, e.crop, e.quality, e.n);
          deps.toast(r.text); if (r.ok) SFX.coin();
          render();
        }, { fontSize: 15 }),
      ]);
      y += 46;
    }

    // 矿石（挖矿产出）：和作物分开列，避免"全部卖出"误伤
    for (const e of ores) {
      panel.body.add(label(s, -270, y + 20, `${itemName(e.id)} × ${e.n}   单价 ${e.unit}G`, { color: '#c9d6e8' }));
      panel.body.add([
        textButton(s, 170, y + 24, 70, 34, '卖 1', () => {
          const r = sellOre(w, e.id, 1);
          deps.toast(r.text); if (r.ok) SFX.coin();
          render();
        }, { fontSize: 15 }),
        textButton(s, 254, y + 24, 70, 34, '全卖', () => {
          const r = sellOre(w, e.id, e.n);
          deps.toast(r.text); if (r.ok) SFX.coin();
          render();
        }, { fontSize: 15 }),
      ]);
      y += 46;
    }

    if (entries.length > 0) {
      panel.body.add(textButton(s, -120, y + 40, 200, 40, '作物全卖', () => {
        const r = sellAllCrops(w);
        deps.toast(`卖出 ${r.count} 份作物，+${r.gold}G`);
        if (r.gold > 0) SFX.coin();
        render();
      }, { bg: 0x8a6a2a, fontSize: 17 }));
    }
    if (ores.length > 0) {
      panel.body.add(textButton(s, 120, y + 40, 200, 40, '矿石全卖', () => {
        const r = sellAllOres(w);
        deps.toast(`卖出 ${r.count} 块矿石，+${r.gold}G`);
        if (r.gold > 0) SFX.coin();
        render();
      }, { bg: 0x8a6a2a, fontSize: 17 }));
    }
  };

  const renderToolTab = (): void => {
    let y = 60;
    panel.body.add(label(s, -270, y - 20, '已拥有：', { color: '#c9a06b' }));
    panel.body.add(label(s, -180, y - 20,
      `${w.toolCan === 2 ? '铜洒水壶（3 格浇水）' : '旧洒水壶'}   ${w.toolHoe === 2 ? '铜锄头（2 格开垦）' : '旧锄头'}`));
    y += 16;
    for (const t of TOOL_UPGRADES) {
      const owned = (t.id === 'tool:can2' && w.toolCan === 2) || (t.id === 'tool:hoe2' && w.toolHoe === 2);
      panel.body.add(label(s, -270, y + 20, `${t.name}  ${t.price}G\n${t.desc}`, { size: 16 }));
      panel.body.add(textButton(s, 180, y + 30, 120, 38, owned ? '已拥有' : '购买', () => {
        if (owned) return;
        const r = buyToolUpgrade(w, t.id);
        deps.toast(r.text); if (r.ok) SFX.coin();
        render();
      }, { bg: owned ? 0x555f55 : 0x3f7d5a, fontSize: 15 }));
      y += 92;
    }
    panel.body.add(label(s, -270, y + 10, `当前金币：${w.gold}G`, { color: '#f2e06a' }));
  };

  const renderDecorTab = (): void => {
    panel.body.add(label(s, -270, 34, '买来先进背包；在快捷栏「装饰」页选中后按「互动」摆放。',
      { size: 13, color: '#c9a06b' }));
    let y = 56;
    for (const d of DECORS) {
      const owned = countItem(w.inventory, d.id);
      const tag = d.blocks ? '' : '（不挡路）';
      panel.body.add(label(s, -270, y + 12,
        `${d.name}${tag}  ${d.price}G${owned > 0 ? `  已拥有 ×${owned}` : ''}`, { size: 16 }));
      panel.body.add(textButton(s, 200, y + 16, 90, 36, '买 1', () => {
        const r = buyDecor(w, d.id, 1);
        deps.toast(r.text);
        if (r.ok) SFX.coin(); else SFX.fail();
        render();
      }, { fontSize: 15 }));
      y += 42;
    }
  };

  render();
  return panel;
}
