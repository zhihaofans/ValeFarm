// 系统菜单面板（UIScene 拆分第六块，也是最后一块大面板）。
//
// 里面混了三类东西，都只依赖 core 或 DOM，不依赖场景状态机：
//   1) 存档导出/导入（导出自己就能做完；导入要场景里那个隐藏 file input，所以走回调）
//   2) 设置（音效开关 + 持久化）
//   3) 入口按钮（物品栏 / 制作台 / 环境诊断）—— 只负责"关掉自己 + 通知场景"

import type Phaser from 'phaser';
import { SFX, setSfxEnabled } from '../../core/audio';
import { exportSave } from '../../core/save';
import { saveSettings, type Settings } from '../../core/storage';
import { ratingSummary } from '../../core/rating';
import type { World } from '../../core/types';
import { isStandaloneApp } from '../../layout';
import { label, makePanel, textButton, type Panel } from '../widgets';

export interface SystemPanelDeps {
  scene: Phaser.Scene;
  world: World;
  /** 设置对象（就地修改后由本面板负责持久化） */
  settings: Settings;
  toast: (text: string) => void;
  onClose: () => void;
  /** 音效开关后重建面板（与重构前一致：关掉再 openSystem） */
  onReopen: () => void;
  onInventory: () => void;
  onCrafting: () => void;
  onEnvDiag: () => void;
  /** 触发隐藏的 file input（由场景持有） */
  onImportClick: () => void;
}

export function buildSystemPanel(deps: SystemPanelDeps): Panel {
  const { scene: s, world: w, settings } = deps;
  const panel = makePanel(s, '系统', () => deps.onClose());

  const exp = textButton(s, -170, 60, 260, 46, '导出存档（下载 JSON）', () => {
    const data = exportSave(w);
    const blob = new Blob([data], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `vale-farm-save-day${w.day}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    deps.toast('存档已导出');
  }, { fontSize: 17 });

  const imp = textButton(s, 170, 60, 260, 46, '导入存档（选择文件）', () => {
    deps.onImportClick();
  }, { bg: 0x5b5044, fontSize: 17 });

  const sfxToggle = textButton(s, -170, 130, 260, 46,
    `音效：${settings.sfx ? '开' : '关'}`, () => {
      settings.sfx = !settings.sfx;
      setSfxEnabled(settings.sfx);
      saveSettings(settings);
      SFX.ui();
      // 重建面板刷新按钮文案（与重构前一致：先关掉再重新打开）
      panel.close();
      deps.onReopen();
    }, { bg: 0x5b5044, fontSize: 17 });

  const inventory = textButton(s, 170, 130, 260, 46, '物品栏', () => {
    panel.close();
    deps.onInventory();
  }, { bg: 0x5b5044, fontSize: 17 });

  const help = textButton(s, -170, 190, 260, 46, '操作说明', () => {
    deps.toast('左下拖动移动 / 右下按钮做动作 / 种子槽点按切换 / 走到商店、出货箱、小屋前按动作键');
  }, { bg: 0x5b5044, fontSize: 17 });

  const crafting = textButton(s, 170, 190, 260, 46, '制作台', () => {
    panel.close();
    deps.onCrafting();
  }, { bg: 0x5b5044, fontSize: 17 });

  // 按钮文案里直接带当前模式：不点进诊断也能一眼确认「这是 PWA 还是标签页」
  const env = textButton(s, 0, 250, 545, 46,
    `环境诊断（当前：${isStandaloneApp() ? 'PWA 独立模式' : '标签页模式'}）`, () => {
      panel.close();
      deps.onEnvDiag();
    }, { bg: 0x5b5044, fontSize: 17 });

  const stats = label(s, -270, 300,
    `农场评价 ${ratingSummary(w)} · 知识点 ${w.knowledge} · 已收获 ${w.stats.harvested} 份 · 累计 ${w.stats.earned}G · 昏倒 ${w.stats.collapsedCount} 次`,
    { size: 13, color: '#c9a06b' });

  panel.body.add([exp, imp, sfxToggle, inventory, help, crafting, env, stats]);
  return panel;
}
