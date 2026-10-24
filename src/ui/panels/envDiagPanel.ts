// 环境诊断面板（从 UIScene 拆出来的第一块）。
//
// 为什么单独成文件：UIScene 已经 1200+ 行，所有面板挤在一起，改一个面板要翻很久。
// 这里只依赖 widgets（面板骨架/按钮）+ dev/envDiag（采集与复制），不碰场景状态机，
// 所以可以按「面板 → 一组依赖」的方式搬出来，行为与搬之前完全一致。
//
// 为什么诊断必须做在游戏内：iOS PWA 独立窗口没有地址栏，打不开 public/diag.html。

import type Phaser from 'phaser';
import { collectEnvDiag, copyText } from '../../dev/envDiag';
import type { SafeInsets } from '../../layout';
import { makePanel, textButton, type Panel } from '../widgets';
import { fs as fontPx, UI_FONT_MONO } from '../font';
import { openCopySheet } from '../copySheet';

export interface EnvDiagPanelDeps {
  scene: Phaser.Scene;
  /** 画布像素 / CSS 像素（= UIScene.DP） */
  dpr: number;
  /** UI 实际采用的安全区（不是 env() 原始读数） */
  safe: SafeInsets;
  /** HUD 条高度（CSS 像素） */
  hudHCss: number;
  /** HUD 首行文字顶边（CSS 像素） */
  textTopCss: number;
  /** 提示（复制成功/失败） */
  toast: (text: string) => void;
  /** 面板关闭时回调（调用方在这里复位 panelOpen / 恢复游戏时间） */
  onClose: () => void;
}

/**
 * 构建环境诊断面板。返回值交给调用方 placePanel，便于复用既有的居中逻辑。
 */
export function buildEnvDiagPanel(deps: EnvDiagPanelDeps): Panel {
  const { scene: s, dpr: S } = deps;
  const panel = makePanel(s, '环境诊断', deps.onClose);

  // root 的第一个子对象就是面板外点击区（透明 Rectangle）
  const shade = panel.root.list[0] as Phaser.GameObjects.Rectangle | undefined;
  const shadeBounds = shade?.getBounds();

  const d = collectEnvDiag({
    safe: deps.safe,
    hudHCss: deps.hudHCss,
    textTopCss: deps.textTopCss,
    renderScale: S,
    shadeTopCss: shadeBounds ? shadeBounds.y / S : undefined,
    shadeHCss: shadeBounds ? shadeBounds.height / S : undefined,
  });

  // 取消 body 的「640 基准等比缩放」：那一套是为了让按横屏设计的按钮在竖屏不溢出，
  // 诊断面板是窄排版的文本，缩到 0.58 就小得读不了了。
  panel.body.setScale(1);

  // 行数不固定（UA 那行会按屏宽换行），字号必须自适应，否则最后几行会被面板底边切掉。
  // text.height 在创建后才算得准，所以先建后缩：12px 起，塞不下就每档 0.5px 往下调。
  const availCss = panel.h - 44 - 8; // 44 = 标题栏占位
  let fpx = 12;
  const body = s.add.text(-panel.w / 2 * S + 14 * S, 0, d.summary, {
    fontSize: `${fontPx(fpx) * S}px`, color: '#d8d2c4',
    fontFamily: UI_FONT_MONO,
    lineSpacing: 3 * S,
    wordWrap: { width: (panel.w - 28) * S },
  });
  while (fpx > 7 && body.height > availCss * S) {
    fpx -= 0.5;
    body.setFontSize(Math.round(fontPx(fpx) * S));
    body.setLineSpacing(Math.round(fontPx(fpx) / 4 * S));
  }
  panel.body.add([body]);

  // 复制按钮做标题栏里的一个图标位，不放正文底部 ——
  // 正文行数不确定（UA 会换行），放底部迟早和最后一行叠上。
  // 注意坐标系：✕ 是挂在 root 上（原点=面板中心），这里挂在 body 上
  // （原点=标题栏下沿，即面板顶下 44px 处），所以标题栏行在 body 内是 y=-22。
  const copy = textButton(s, panel.w / 2 - 80, -22, 44, 44, '⧉', () => {
    // 自动复制被系统拦下时不要只弹一句"失败"：把文本摊成可选中的框，用户长按全选也能拿走
    const fallback = () => openCopySheet('诊断信息', d.summary);
    void copyText(d.summary).then((ok) => {
      if (ok) {
        deps.toast('已复制，粘贴发给开发者就行');
        return;
      }
      deps.toast('系统拦下了自动复制，已弹出可手动复制的面板');
      fallback();
    }).catch(() => {
      deps.toast('系统拦下了自动复制，已弹出可手动复制的面板');
      fallback();
    });
  }, { bg: 0x5b5044 });
  panel.body.add([copy]);

  return panel;
}
