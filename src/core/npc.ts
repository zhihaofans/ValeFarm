// NPC：对话、送礼、好感度里程碑。

import { FRIEND_TALK, GIFT_LOVED, GIFT_NORMAL, GIFT_WITHERED } from './config';
import { NPCS } from './data';
import { addItem, countItem, removeItem } from './economy';
import type { World } from './types';

export function npcDef(id: string) {
  return NPCS.find((n) => n.id === id)!;
}

/** 好感等级：0 陌生 / 1 朋友 / 2 挚友 */
export function tierOf(friendship: number): 0 | 1 | 2 {
  if (friendship >= 300) return 2;
  if (friendship >= 100) return 1;
  return 0;
}

export function tierName(t: 0 | 1 | 2): string {
  return t === 2 ? '挚友' : t === 1 ? '朋友' : '初识';
}

/** 每日首次对话加好感；返回当天要说的台词 */
export function talk(w: World, id: string): { lines: string[]; friendUp: number; rewardLine?: string } {
  const st = w.npcs[id];
  const def = npcDef(id);
  const t = tierOf(st.friendship);
  const pool = def.lines.filter((l) => l.tier === t);
  // 按天轮换而不是随机：同一天重复对话说同一句，第二天自然换下一句。
  const line = pool[(Math.max(1, w.day) + t * 3) % pool.length].text;
  let friendUp = 0;
  let rewardLine: string | undefined;
  if (!st.talkedToday) {
    st.talkedToday = true;
    st.friendship += FRIEND_TALK;
    friendUp = FRIEND_TALK;
    rewardLine = checkRewards(w, id);
  }
  return { lines: [line], friendUp, rewardLine };
}

export type GiftResult = { ok: false; text: string } | {
  ok: true;
  text: string;
  friendUp: number;
  rewardLine?: string;
};

/** 送礼：每天一次；作物按 NPC 喜好给不同好感 */
export function giveGift(w: World, id: string, itemId: string): GiftResult {
  const st = w.npcs[id];
  const def = npcDef(id);
  if (st.giftedToday) return { ok: false, text: '今天已经送过礼物了，明天再来吧' };
  const have = countItem(w.inventory, itemId);
  if (have <= 0) return { ok: false, text: '背包里没有这件东西' };

  let up = GIFT_NORMAL;
  let text = '谢谢你，我会好好收下的。';
  if (itemId.startsWith('crop:')) {
    const crop = itemId.split(':')[1];
    if (itemId.endsWith('withered') || itemId.endsWith(':dead')) up = GIFT_WITHERED;
    else if (crop === def.lovedGift) {
      up = GIFT_LOVED;
      text = `${def.name}最喜欢这个了！太开心了！`;
    }
  }
  removeItem(w.inventory, itemId, 1);
  st.giftedToday = true;
  st.friendship = Math.max(0, st.friendship + up);
  const rewardLine = checkRewards(w, id);
  return { ok: true, text, friendUp: up, rewardLine };
}

/** 好感里程碑奖励（一次性）。可能同时触发多个，全部发放，返回拼接文案。 */
export function checkRewards(w: World, id: string): string | undefined {
  const st = w.npcs[id];
  const def = npcDef(id);
  const got: string[] = [];
  for (const r of def.rewards) {
    const flag = r.at === 100 ? 'reward100' : 'reward300';
    if (st.friendship >= r.at && !st[flag]) {
      st[flag] = true;
      if (r.gold) {
        w.gold += r.gold;
        got.push(`${def.name}：${r.text}（获得 ${r.gold} 金币）`);
      } else if (r.seeds) {
        addItem(w.inventory, `seed:${r.seeds.crop}`, r.seeds.n);
        got.push(`${def.name}：${r.text}（获得 ${r.seeds.n} 包种子）`);
      } else {
        got.push(`${def.name}：${r.text}`);
      }
    }
  }
  return got.length ? got.join(' ') : undefined;
}
