// 日循环相关的两个小面板：晨报（showDayReport）与睡觉确认（openSleepConfirm）。
//
// 它们共同点：都要「关掉自己 + 复位面板状态 + 恢复游戏时间」，但复位属于场景状态，
// 所以这里只通过 onClose / onConfirm 回调出去；面板自己负责 close()。

import type Phaser from 'phaser';
import { SEASON_DAYS, SEASON_NAMES } from '../../core/config';
import type { World } from '../../core/types';
import { dayOfSeason, seasonOf } from '../../core/world';
import { label, makePanel, textButton, uiScale, type Panel } from '../widgets';

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

  const S = uiScale(s);
  // 竖屏面板只有 ~336 CSS 宽（body 整体等比缩放），一句 30+ 字的正文会换成两行。
  // 所以：① 窄屏用 16 号字；② 行距按**上一条的实际高度**累加 —— 以前写死 34，
  // 换行那条（两行高约 48）就会把第二行压到下一句上，第 1 天的欢迎语最容易踩到。
  const narrow = s.scale.width / S < 480;
  const size = narrow ? 16 : 17;
  const gap = narrow ? 8 : 10;
  const bodyH = panel.h - 44;

  let y = 40;
  for (const l of lines) {
    // 符号单独占一列：正文用更窄的 wrap（550 - 24），否则长句会从符号右边伸到面板外。
    panel.body.add(label(s, -272, y, '·', { size }));
    const t = label(s, -252, y, l, { size, wrap: 560 });
    panel.body.add(t);
    y += t.height / S + gap;
  }

  // 晨报只负责“看 + 开始新的一天”。横屏按钮属于竖屏建议卡片，
  // 不再塞进每天的晨报——横屏玩家看到它只会莫名其妙。
  // 位置夹在正文高度内：欢迎语较长时按钮不能掉到面板外。
  const btnY = Math.min(y + 40, bodyH - 40);
  panel.body.add(textButton(s, 0, btnY, 220, 46, '开始新的一天', () => {
    panel.close();
    deps.onClose();
  }, { bg: 0x3f7d5a, fontSize: 18 }));

  return panel;
}
