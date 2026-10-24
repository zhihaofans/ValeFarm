// 研究（知识点）：把多余产出"研究掉"换成知识点，再用知识点兑升级。
// 纯逻辑，不依赖 Phaser。
//
// 为什么要有这条：木镐之后就没有新的成长线了，而钱到中后期会溢出
// （作物越卖越多、商店只有种子和两件工具升级）。研究点给"多余产出"第二出口，
// 而且兑换的是**已有机制**（工具升级 / 体力上限），不需要再造一套系统。

import { KNOWLEDGE_SHOP, researchPointsOf } from './data';
import { addItem, countItem, removeItem } from './economy';
import type { World } from './types';

export interface ResearchResult {
  ok: boolean;
  text: string;
  /** 本次获得的知识点 */
  gained?: number;
}

export interface RedeemResult {
  ok: boolean;
  text: string;
  cost?: number;
}

/** 这个物品能不能研究，能得几点 */
export function canResearch(itemId: string): { ok: boolean; points: number; text: string } {
  const points = researchPointsOf(itemId);
  if (points <= 0) return { ok: false, points: 0, text: '这个东西没什么可研究的' };
  return { ok: true, points, text: '' };
}

/**
 * 研究一件物品：消耗背包里 1 个，换成知识点。
 * 只吃真正有用的东西 —— 工具/种子/装饰不给研究，避免"把刚买的镐子研究没了"。
 */
export function researchItem(w: World, itemId: string): ResearchResult {
  const { ok, points, text } = canResearch(itemId);
  if (!ok) return { ok: false, text };
  if (countItem(w.inventory, itemId) <= 0) return { ok: false, text: '背包里没有这件东西' };
  removeItem(w.inventory, itemId, 1);
  w.knowledge += points;
  return { ok: true, text: `研究完成：知识点 +${points}（共 ${w.knowledge}）`, gained: points };
}

/** 已兑换过哪些知识升级 */
export function isUnlocked(w: World, id: string): boolean {
  return w.unlocked.includes(id);
}

/** 兑换知识升级；不满足条件时给出具体原因 */
export function redeemKnowledge(w: World, id: string): RedeemResult {
  const item = KNOWLEDGE_SHOP.find((k) => k.id === id);
  if (!item) return { ok: false, text: '没有这项升级' };
  if (isUnlocked(w, id)) return { ok: false, text: '已经兑换过了' };
  if (w.knowledge < item.cost) {
    return { ok: false, text: `知识点不够（还差 ${item.cost - w.knowledge}）` };
  }

  if (id === 'kn:hoe2') {
    if (w.toolHoe === 2) return { ok: false, text: '已经有铜锄头了' };
    w.toolHoe = 2;
  } else if (id === 'kn:can2') {
    if (w.toolCan === 2) return { ok: false, text: '已经有铜洒水壶了' };
    w.toolCan = 2;
  } else if (id === 'kn:stamina') {
    w.maxEnergy += 10;
    w.energy = Math.min(w.maxEnergy, w.energy + 10); // 换完立刻补上这 10 点，别让玩家觉得白花
  } else {
    return { ok: false, text: '这项升级还没实现' };
  }

  w.knowledge -= item.cost;
  w.unlocked.push(id);
  return { ok: true, text: `兑换成功：${item.name}（剩余知识点 ${w.knowledge}）`, cost: item.cost };
}

/** 背包里可研究的物品清单（按研究点从高到低），给 UI 用 */
export function researchableEntries(inv: Record<string, number>): Array<{ id: string; n: number; points: number }> {
  const out: Array<{ id: string; n: number; points: number }> = [];
  for (const id of Object.keys(inv)) {
    const n = countItem(inv, id);
    if (n <= 0) continue;
    const pts = researchPointsOf(id);
    if (pts > 0) out.push({ id, n, points: pts });
  }
  return out.sort((a, b) => b.points - a.points);
}

/** 便捷：直接给背包加一件（测试/调试用，正式流程走 economy/craft） */
export function _addItemForTest(w: World, id: string, n = 1): void {
  addItem(w.inventory, id, n);
}
