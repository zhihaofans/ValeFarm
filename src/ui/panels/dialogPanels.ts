// NPC 对话与送礼选择器（UIScene 拆分第五块·下）。
//
// 这两个面板有嵌套关系：对话面板里点「送礼」会打开选择器。为了避免两个 modal 叠加
// 导致 activePanel 指向已销毁的容器，**由调用方先关掉对话面板再打开选择器**。
// 所以这里不互相调用，只把"要打开选择器了"作为回调抛出去。

import type Phaser from 'phaser';
import { SFX } from '../../core/audio';
import { CROPS, QUALITY } from '../../core/data';
import { cropEntries } from '../../core/economy';
import { giveGift, npcDef, talk, tierName, tierOf } from '../../core/npc';
import type { World } from '../../core/types';
import { label, makePanel, textButton, type Panel } from '../widgets';

export interface DialogPanelDeps {
  scene: Phaser.Scene;
  world: World;
  npcId: string;
  /** 点「送礼」：调用方负责先关掉本面板再打开选择器 */
  onGift: () => void;
  onClose: () => void;
}

export function buildDialogPanel(deps: DialogPanelDeps): Panel {
  const { scene: s, world: w, npcId } = deps;
  const def = npcDef(npcId);
  const npc = w.npcs[npcId];
  const panel = makePanel(s, `${def.name} · ${tierName(tierOf(npc.friendship))}`, () => deps.onClose());

  const r = talk(w, npcId);
  let y = 30;
  for (const line of r.lines) {
    panel.body.add(label(s, -270, y, `「${line}」`, { size: 18 }));
    y += 44;
  }
  if (r.rewardLine) {
    panel.body.add(label(s, -270, y, `★ ${r.rewardLine}`, { color: '#f2e06a' }));
    y += 44;
  }
  if (r.friendUp > 0) {
    panel.body.add(label(s, -270, y, `好感度 +${r.friendUp}`, { color: '#e05252', size: 15 }));
    y += 30;
  }
  panel.body.add(label(s, -270, y + 8,
    `好感度：${Math.floor(npc.friendship)}（${tierName(tierOf(npc.friendship))}）· 最爱：${CROPS[def.lovedGift].name}`,
    { size: 14, color: '#c9a06b' }));

  const gifted = npc.giftedToday;
  panel.body.add(textButton(s, -160, 280, 150, 42, gifted ? '今天已送礼' : '送 礼', () => {
    if (npc.giftedToday) return;
    deps.onGift();
  }, { bg: gifted ? 0x555f55 : 0x8a6a2a }));

  return panel;
}

export interface GiftPickerDeps {
  scene: Phaser.Scene;
  world: World;
  npcId: string;
  toast: (text: string) => void;
  onClose: () => void;
}

export function buildGiftPickerPanel(deps: GiftPickerDeps): Panel {
  const { scene: s, world: w, npcId } = deps;
  const panel = makePanel(s, '送什么好呢？', () => deps.onClose());

  const entries = cropEntries(w.inventory);
  let y = 40;
  if (entries.length === 0) {
    panel.body.add(label(s, -260, y + 20, '背包里没有可以送的东西。'));
  }
  for (const e of entries.slice(0, 5)) {
    panel.body.add(textButton(s, 0, y + 24, 500, 40,
      `${CROPS[e.crop].name}（${QUALITY[e.quality].name}）× ${e.n}`, () => {
        const r = giveGift(w, npcId, `crop:${e.crop}:${e.quality}`);
        if (!r.ok) { deps.toast(r.text); return; }
        SFX.harvest();
        deps.toast(r.text + (r.rewardLine ? ` ★${r.rewardLine}` : ''));
        panel.close();
      }, { fontSize: 16, bg: 0x5b5044 }));
    y += 50;
  }

  return panel;
}
