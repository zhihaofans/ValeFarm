// 日循环相关的两个小面板：晨报（showDayReport）与睡觉确认（openSleepConfirm）。
//
// 它们共同点：都要「关掉自己 + 复位面板状态 + 恢复游戏时间」，但复位属于场景状态，
// 所以这里只通过 onClose / onConfirm 回调出去；面板自己负责 close()。

import type Phaser from 'phaser';
import { SEASON_DAYS, SEASON_NAMES } from '../../core/config';
import type { World } from '../../core/types';
import { dayOfSeason, seasonOf } from '../../core/world';
import { label, makePanel, textButton, type Panel } from '../widgets';

export interface SleepConfirmDeps {
  scene: Phaser.Scene;
  /** 玩家点了「睡觉」：调用方负责 panelOpen/pauseGame 复位，然后让场景结算 */
  onSleep: () => void;
  /** 点了「再转一会儿」或右上角 ✕ */
  onCancel: () => void;
}

export function buildSleepConfirmPanel(deps: SleepConfirmDeps): Panel {
  const { scene: s } = deps;
  const panel = makePanel(s, '睡觉', () => deps.onCancel());

  panel.body.add(label(s, -240, 60, '今天到此为止？睡觉会结算作物生长，', { size: 18 }));
  panel.body.add(label(s, -240, 88, '未浇水的作物会停滞一天。', { size: 18 }));

  panel.body.add([
    textButton(s, -110, 210, 160, 46, '睡觉', () => {
      panel.close();
      deps.onSleep();
    }, { bg: 0x3f7d5a, fontSize: 19 }),
    textButton(s, 110, 210, 160, 46, '再转一会儿', () => {
      panel.close();
      deps.onCancel();
    }, { bg: 0x5b5044, fontSize: 19 }),
  ]);

  return panel;
}

export interface DayReportDeps {
  scene: Phaser.Scene;
  world: World;
  /** 晨报正文（一行一条） */
  lines: string[];
  onClose: () => void;
}

export function buildDayReportPanel(deps: DayReportDeps): Panel {
  const { scene: s, world: w, lines } = deps;
  const season = seasonOf(w.day);
  const panel = makePanel(
    s,
    `第 ${w.day} 天 · ${SEASON_NAMES[season]}季 ${dayOfSeason(w.day)}/${SEASON_DAYS}`,
    () => deps.onClose(),
  );

  let y = 40;
  for (const l of lines) {
    panel.body.add(label(s, -270, y, `· ${l}`, { size: 17 }));
    y += 34;
  }

  // 晨报只负责“看 + 开始新的一天”。横屏按钮属于竖屏建议卡片，
  // 不再塞进每天的晨报——横屏玩家看到它只会莫名其妙。
  panel.body.add(textButton(s, 0, y + 60, 220, 46, '开始新的一天', () => {
    panel.close();
    deps.onClose();
  }, { bg: 0x3f7d5a, fontSize: 18 }));

  return panel;
}
