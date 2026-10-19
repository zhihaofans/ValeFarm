// UI 小部件：文字按钮、面板骨架。
//
// 单位约定（整份文件唯一一条，别在别处破例）：
//   **调用方一律写 CSS 像素，本文件内部统一乘 S 换算成画布像素。**
// 因为 UI 相机 zoom 恒为 1、坐标就是画布像素，而画布像素 = CSS × dpr。
// 若常量直接当画布像素用，dpr=3 的手机上面板与文字只有设计值的 1/3，
// 看起来"面板没撑开、按钮点不中"（0.4.0 真机上踩过）。

import Phaser from 'phaser';

export const UI_DEPTH = {
  hud: 800,
  buttons: 850,
  joystick: 900,
  /** 面板根容器所在层：必须高于按钮层，否则 ☰、动作键会漂在遮罩之上，点到穿透 */
  modal: 1000,
  /** 面板之后创建的按钮（✕、面板内按钮）用这一层，保证在遮罩和面板本体之上 */
  modalContent: 1010,
  toast: 1100,
};

/** 画布像素 / CSS 像素。Scale.NONE 下 scale.width 就是 CSS×dpr，画面铺满视口 */
export function uiScale(scene: Phaser.Scene): number {
  const cssW = window.innerWidth || scene.scale.width;
  return scene.scale.width / Math.max(1, cssW);
}

export function textButton(
  scene: Phaser.Scene,
  x: number, y: number, w: number, h: number,
  label: string, cb: () => void,
  opts: { bg?: number; fg?: string; fontSize?: number } = {},
): Phaser.GameObjects.Container {
  const S = uiScale(scene);
  const bw = w * S;
  const bh = h * S;
  // 注意：Container 用 Rectangle 子对象做背景时，不要 setSize —— Phaser 的
  // setSize 会把 displayOrigin 设成尺寸的一半，而 Container 按 0 原点渲染，
  // 结果命中区整体偏移 (-w/2, -h/2)，按钮右下 1/4 失灵、左上一圈点不到。
  // 这里改用「无贴图 + 自定义命中区」，origin 保持 0，命中区与视觉严格重合。
  const bg = scene.add.rectangle(0, 0, bw, bh, opts.bg ?? 0x3f7d5a)
    .setStrokeStyle(2 * S, 0xffffff, 0.35);
  const txt = scene.add.text(0, 0, label, {
    fontSize: `${Math.round((opts.fontSize ?? 18) * S)}px`,
    color: opts.fg ?? '#ffffff',
    fontFamily: 'sans-serif',
  }).setOrigin(0.5);
  const c = scene.add.container(x * S, y * S, [bg, txt]);
  // 若当前正有面板打开，新建的按钮必须压在遮罩之上，否则会被半透明遮罩拦住点击
  if (scene.children.list.some((o) => (o as Phaser.GameObjects.Container).depth === UI_DEPTH.modal)) c.setDepth(UI_DEPTH.modalContent);
  c.setInteractive(new Phaser.Geom.Rectangle(-bw / 2, -bh / 2, bw, bh), Phaser.Geom.Rectangle.Contains);
  // 触屏容错：手指按下去就算数，不等抬起 —— 抬起位置漂移/手势被合成鼠标打断都不会丢点击
  c.on('pointerdown', () => { bg.setAlpha(0.75); });
  c.on('pointerout', () => { bg.setAlpha(1); });
  c.on('pointerup', () => { bg.setAlpha(1); });
  c.on('pointerupoutside', () => { bg.setAlpha(1); });
  c.on('pointerdown', () => { cb(); });
  return c;
}

export interface Panel {
  root: Phaser.GameObjects.Container;
  body: Phaser.GameObjects.Container;
  /** 面板实际尺寸（随屏幕变化，调用方排版时应优先用它） */
  w: number;
  h: number;
  close: () => void;
  setTitle: (t: string) => void;
  /** 视口尺寸变了（转屏）：重铺遮罩并重新居中（cy 不传就按几何中心） */
  resizeShade: (vw: number, vh: number, cy?: number) => void;
}

/**
 * 面板尺寸：不写死，按当前可见屏幕取。
 * 竖屏 390 宽时 640 会伸出屏幕外 → 取 min(640, 屏宽-24)，这是"竖屏也能玩"的必要条件。
 * 返回值为 **CSS 像素**；Panel.w/h 存的是 CSS 像素，画布像素由 makePanel 内部换算。
 */
function panelSizeCss(scene: Phaser.Scene): { w: number; h: number } {
  const S = uiScale(scene);
  const vw = scene.scale.width / S;   // CSS 宽
  const vh = scene.scale.height / S;  // CSS 高
  const w = Math.min(640, vw - 24);
  const h = Math.min(360, vh - 40);
  return { w, h };
}

/**
 * 面板 / 对话框的垂直中心（画布像素）。
 *
 * 默认就是屏幕正中。但 HUD 会盖住顶部一条（含安全区），若仍按几何中心摆，
 * 视觉重心会偏上、面板上沿容易顶到 HUD 下沿 —— 用户明确要求"对话框垂直居中"，
 * 所以这里按 **HUD 之下的可用区**居中，上方补 safetyPad、下方扣同样的量，
 * 保证与 HUD、与屏幕底边都留出一样的距离。
 */
/**
 * 面板 / 对话框的垂直中心（画布像素）。
 *
 * 可用区 = HUD 下沿 ~ 屏幕可用的下沿，面板在中间居中，上下边距相等。
 * 上下都要躲：竖屏时底部还有 Home 指示条，不扣掉的话面板下沿会压在手势区上。
 *
 * ⚠️ safeTopCss 传的是**整条 HUD 带的高度**（含状态栏那 59px），不是单独的 env(top)；
 * hudCssH 只算 HUD 本体。两者相加才是 HUD 底色的真实下沿。
 * 以前这里是 safeTop + hudH 分开传、语义模糊，改 safe 口径时很容易算重或算漏。
 */
export function modalCenterY(
  scene: Phaser.Scene,
  panelCssH: number,
  hudCssH = 0,
  safeTopCss = 0,
  safeBottomCss = 0,
): number {
  const S = uiScale(scene);
  const uiH = scene.scale.height;
  const top = (safeTopCss + hudCssH) * S;     // HUD 下沿
  const bottom = safeBottomCss * S;
  const avail = Math.max(1, uiH - top - bottom);
  const cy = top + avail / 2;
  // 面板比可用区还高 → 退回几何中心，否则上半截会被 HUD 压住看不见
  if (panelCssH * S > avail) return uiH / 2;
  return cy;
}

/**
 * 屏幕边缘遮罩：**铺满整屏，不做内缩**（不再铺 3 倍尺寸，省显存也不影响观感）。
 *
 * 0.4.2 build 18 踩过的坑：以前铺的是 3 倍画布尺寸的矩形 + 内缩，内缩一旦算错
 * （dpr 折算 / 画布尺寸与屏幕不一致），屏幕边缘就会漏出一条没被压暗的亮边，
 * 真机上表现成"底部一条黑缝夹着一条没盖住的画面"。铺满整屏最简单也最稳。
 */

export function makePanel(scene: Phaser.Scene, title: string, onClose?: () => void): Panel {
  const S = uiScale(scene);
  const { w: cssW, h: cssH } = panelSizeCss(scene);
  const PANEL_W = cssW * S;
  const PANEL_H = cssH * S;
  const BODY_TOP = -PANEL_H / 2 + 44 * S;
  const uiW = scene.scale.width;
  const uiH = scene.scale.height;
  // 居中位置由调用方在 open 时用 modalCenterY 再校准（scene 里才知道 HUD 多高）
  const root = scene.add.container(uiW / 2, uiH / 2);
  root.setDepth(UI_DEPTH.modal);

  // 遮罩：铺满整屏并吞掉点击（不穿透到背景）——先加，必须在最底层。
  // 尺寸按「屏幕宽高」给、位置按「面板中心」补：矩形在 root 坐标系里，
  // root 原点=面板中心，所以屏幕被完整盖住（3 倍尺寸的老做法会在边缘漏亮边）。
  const shade = scene.add.rectangle(uiW / 2, uiH / 2, uiW, uiH, 0x000000, 0.6);
  shade.setInteractive();
  // 记录创建时已经在屏幕上的手指。这些手指的 pointerup 不应当算作"点遮罩关闭"，
  // 否则"按下动作键 → 面板弹出 → 松手"会把面板瞬间关掉（手机上必然发生）。
  //
  // 必须用 pointerdown 的 **事件对象**（每个事件都是新对象）做 key，不能用 pointer.id：
  // Phaser 的触屏与合成鼠标共用同一组 Pointer 实例，id 会互相顶替，
  // 用 id 判定会把"另一根新手指"当成"刚才那根"，于是点菜单的抬手被当成点遮罩。
  const preDown = new Set<Phaser.Input.Pointer>();
  for (const p of scene.input.manager.pointers) if (p.isDown) preDown.add(p);
  shade.on('pointerup', (p: Phaser.Input.Pointer) => {
    if (!root.active) return;
    if (preDown.has(p)) { preDown.delete(p); return; }
    close();
  });
  root.add(shade);

  const bg = scene.add.rectangle(0, 0, PANEL_W, PANEL_H, 0x2a241c, 0.96)
    .setStrokeStyle(3 * S, 0xc9a06b, 1);
  // 面板本体也吞点击，避免点到面板缝隙时误触发遮罩关闭
  bg.setInteractive();
  bg.on('pointerup', () => { /* 吞掉 */ });

  const titleTxt = scene.add.text(0, -PANEL_H / 2 + 22 * S, title, {
    fontSize: `${Math.round(22 * S)}px`, color: '#f2e06a', fontFamily: 'sans-serif', fontStyle: 'bold',
  }).setOrigin(0.5);

  // ✕ 加大触区（48×44 CSS），并放到最高层，避免被 body 内容盖住
  const closeBtn = textButton(scene, PANEL_W / 2 / S - 30, -PANEL_H / 2 / S + 22, 48, 44, '✕', () => close(), { bg: 0x8a4444 });
  const body = scene.add.container(0, BODY_TOP);
  // 内容自适应：面板排版一律按 640 宽的横屏面板设计（按钮 x=±170/±270 等），
  // 竖屏面板只有 ~320-370 宽，内容会伸出左右边（0.4.1 竖屏「系统」面板翻车）。
  // 让 body 整体等比缩放，一处修复所有面板；命中区随 transform 一起缩，触摸不受影响。
  const bodyScale = Math.min(1, PANEL_W / (640 * S));
  body.setScale(bodyScale);
  root.add([bg, titleTxt, body, closeBtn]);

  function close(): void {
    if (!root.active) return;
    root.destroy();
    onClose?.();
  }
  // w/h 对外一律是 CSS 像素：调用方（UIScene）排版时也全用 CSS 数值
  return {
    root, body, w: cssW, h: cssH, close,
    setTitle: (t: string) => titleTxt.setText(t),
    resizeShade: (vw: number, vh: number, cy?: number) => {
      root.setPosition(vw / 2, cy ?? vh / 2);
      // 遮罩铺满整屏并跟着面板一起移动（它在 root 里，原点=面板中心），
      // 所以尺寸按「屏幕宽高」给，位置按「面板中心」补，屏幕永远被盖全。
      shade.setPosition(-vw / 2, -cy! / 2 + vh / 2);
      shade.setSize(vw, vh);
      shade.input?.hitArea.setTo(-vw / 2, -vh / 2, vw, vh);
    },
  };
}

/** 面板正文可用高度（旧常量，保留给老代码；新代码请用 panel.h - 44） */
export const PANEL_BODY_H = 360 - 44;

export function label(scene: Phaser.Scene, x: number, y: number, text: string, opts: { size?: number; color?: string; bold?: boolean } = {}): Phaser.GameObjects.Text {
  const S = uiScale(scene);
  return scene.add.text(x * S, y * S, text, {
    fontSize: `${Math.round((opts.size ?? 17) * S)}px`,
    color: opts.color ?? '#e8e4dc',
    fontFamily: 'sans-serif',
    fontStyle: opts.bold ? 'bold' : 'normal',
    wordWrap: { width: (640 - 90) * S },
    lineSpacing: 6 * S,
  });
}
