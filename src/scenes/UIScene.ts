// UI 场景：HUD、虚拟摇杆、动作键、全部面板（商店/对话/睡觉/晨报/系统）。
// 与 GameScene 单向依赖：只调用其公开方法，不直接改地块。

import Phaser from 'phaser';
import { SEASON_NAMES, SEASON_DAYS } from '../core/config';
import { CROPS, CROP_ORDER, QUALITY, TOOL_UPGRADES } from '../core/data';
import {
  buySeed, buyToolUpgrade, countItem, cropEntries, sellAllCrops, sellCrop, seasonSeeds,
} from '../core/economy';
import { giveGift, npcDef, talk, tierName, tierOf } from '../core/npc';
import { exportSave, importSave } from '../core/save';
import { loadSettings, saveSettings } from '../core/storage';
import { SFX, setSfxEnabled } from '../core/audio';
import { clockText, dayOfSeason, seasonOf } from '../core/world';
import { UI } from '../core/generated/ui.frames';
import { Joystick } from '../ui/joystick';
import { UI_DEPTH, label, makePanel, modalCenterY, textButton, uiScale, type Panel } from '../ui/widgets';
import { collectEnvDiag, copyText } from '../dev/envDiag';
import { currentSafeInsets, isStandaloneApp, NO_INSETS, uiInsets, type SafeInsets } from '../layout';
import type { CropId, World } from '../core/types';
import type { GameScene } from './GameScene';

export class UIScene extends Phaser.Scene {
  private gameScene!: GameScene;
  private joy!: Joystick;

  private dayText!: Phaser.GameObjects.Text;
  private timeText!: Phaser.GameObjects.Text;
  private goldText!: Phaser.GameObjects.Text;
  private weatherIcon!: Phaser.GameObjects.Image;
  private energyBar!: Phaser.GameObjects.Rectangle;
  private energyText!: Phaser.GameObjects.Text;
  private energyBarMaxW = 158;
  private seedBtn!: Phaser.GameObjects.Container;
  private seedIcon!: Phaser.GameObjects.Image;
  private seedText!: Phaser.GameObjects.Text;
  private toastObj?: Phaser.GameObjects.Text;
  private toastTimer?: Phaser.Time.TimerEvent;
  private panelOpen = false;
  private activePanel: Panel | null = null;
  /** 面板存在时的轻提示（☰ 与面板同层，点开后按钮仍可点，需要给个"已打开"的反馈） */
  private tipObj?: Phaser.GameObjects.Container;
  private currentSeedCrop: CropId | null = 'radish';
  private settings = loadSettings();
  private resizeTimer?: Phaser.Time.TimerEvent;
  /** 画布内部分辨率 / CSS 像素（= dpr，封顶 2）：HUD 排版用 CSS 像素算，落点到画布要乘它 */
  private uiDpr = 1;

  constructor() {
    super('ui');
  }

  create(): void {
    this.gameScene = this.scene.get('game') as GameScene;
    // UI 场景用「CSS 像素」作单位：相机 zoom 按 dpr 反向缩放，HUD 就能用 390/844 这种数字排版
    this.setupUiCamera();
    this.joy = new Joystick(this);
    this.buildHud();
    this.buildButtons();

    // 导入存档用的隐藏 file input（复用同一个）
    this.ensureFileInput();

    // 转屏 / 地址栏收缩：整棵 UI 重建（对象不多，比逐项改坐标可靠）
    this.scale.on('resize', this.onResize, this);
    this.events.once('shutdown', () => this.scale.off('resize', this.onResize, this));

    // CameraManager 会在 scale RESIZE 时把所有相机 setSize(baseSize)（画布尺寸），
    // 这会覆盖掉 setupUiCamera 设的「可见世界尺寸」。
    // 监听器顺序不保证，所以下一帧再补一次（幂等，代价极小）。
    this.time.delayedCall(0, () => this.setupUiCamera());
  }

  private onResize(): void {
    // 一次转屏可能连发多个 resize，合并到下一帧统一重建，避免闪烁
    if (this.resizeTimer) this.resizeTimer.remove();
    this.resizeTimer = this.time.delayedCall(60, () => {
      const wasPanelOpen = this.panelOpen;
      this.closeTopPanel();
      this.children.removeAll(true);
      this.setupUiCamera();
      this.joy = new Joystick(this);
      this.buildHud();
      this.buildButtons();
      this.syncHud();
      if (wasPanelOpen) this.openSystem();
    });
  }

  /**
   * 每帧守住安全区。只做一件事：**数值变了才重建**。
   *
   * 为什么不能只在 resize 里读：转屏时 resize 事件可能早于 env() 更新，
   * 那一帧读到 0 就再也不管了，HUD 会永久贴在屏幕顶上被灵动岛吃掉。
   */
  override update(): void {
    const ins = this.computeUiInsets();
    const s = this.safe;
    if (ins.top === s.top && ins.bottom === s.bottom && ins.left === s.left && ins.right === s.right) return;
    // resize 已经排了重建就别重复，交给它统一处理（它内部会重读安全区）
    if (this.resizeTimer) return;
    this.safe = ins;
    this.rebuildChrome();
  }

  /** 只重建「贴着屏幕边」的那几块（HUD / 按钮 / 摇杆），面板与提示保持不动 */
  private rebuildChrome(): void {
    for (const o of [...this.children.list]) {
      const d = (o as Phaser.GameObjects.GameObject & { depth: number }).depth;
      // hud / buttons / joystick 三层重画；面板(1000+)、提示(1100) 原样留着
      if (d <= UI_DEPTH.joystick) o.destroy();
    }
    this.joy = new Joystick(this);
    this.buildHud();
    this.buildButtons();
    this.syncHud();
    // 面板遮罩是按旧视口尺寸铺的，尺寸变了可能盖不满 → 跟着重铺
    const panel = this.activePanel;
    if (panel) {
      const cy = this.panelCenterY(panel.h);
      panel.root.setPosition(this.vw / 2, cy);
      panel.resizeShade?.(this.vw, this.vh, cy);
    }
  }

  /**
   * UI 单位 = **画布像素**（= CSS 像素 × dpr）。
   *
   * 这是唯一能让「渲染 / 裁剪 / 输入」三者同时正确、且不自相矛盾的设定：
   *
   *   WebGLRenderer.preRenderCamera → pushScissor(cam.x, cam.y, cam.width, cam.height)
   *     ⇒ cam.width/height 必须是整块画布，否则只画出左上角 1/dpr 一块
   *   Camera.preRender → matrix = ITRS(w*originX, ..., zoom) · translate(-w*originX, ...)
   *     ⇒ 平移项 e = w*originX*(1-zoom)，zoom≠1 就会把画面推走；只有 origin=0 且 zoom=1 才稳
   *   InputManager → pointer.worldX = cam.getWorldPoint(screenX).x
   *     ⇒ 用负 scroll 硬拗偏移会让输入反向算错（实测点 (422,334) 解出 -703）
   *
   * 结论：cam 必须「尺寸=画布、zoom=1、origin=0、scroll=0」。
   * 于是排版也放在画布坐标里做 —— 但**尺寸常量仍按 CSS 像素书写**（390/844 好读），
   * 由 DP() 在落点时乘 uiDpr 换算。换算只发生在 buildHud / buildButtons 内部。
   */
  private get units(): number {
    return this.scale.width;
  }

  /** 可见宽度（画布像素） */
  private get vw(): number {
    return this.units;
  }

  /** 可见高度（画布像素） */
  private get vh(): number {
    return this.scale.height;
  }

  /** CSS 像素 → 画布像素。buildHud / buildButtons 里所有尺寸常量都过这一道。 */
  private get DP(): number {
    return this.uiDpr;
  }

  /**
   * HUD 高度（CSS 像素），由 buildHud 按内容实算后写回。
   * 别在外面按屏宽再猜一个 —— 猜的那份和真实排版一旦不一致，☰ 与 toast 就会错位。
   */
  private hudHCss = 0;

  /**
   * 面板 / 对话框的垂直中心（画布像素）。
   *
   * 用户要求「更新提示框、对话框都垂直居中」。纯几何中心在竖屏时视觉偏上：
   * HUD 占掉顶部一条（含安全区），面板上沿一抬头就顶到 HUD 下沿。
   * 这里改为「HUD 之下的可用区」居中，上下留一样的边距。
   */
  private panelCenterY(panelCssH: number): number {
    return modalCenterY(this, panelCssH, this.hudHCss, this.safe.top, this.safe.bottom);
  }

  /** 把刚建好的面板摆到居中位置（makePanel 建时先按几何中心，这里再校准） */
  private placePanel(panel: Panel): void {
    panel.root.setPosition(this.vw / 2, this.panelCenterY(panel.h));
  }

  /**
   * 安全区域：刘海 / 灵动岛 / Home 指示条占掉的边距。
   * 每帧现读，转屏后数值会变（横屏 top 归零、左右各 ~44px）—— 转屏到底先来 resize
   * 还是先让 env() 生效，浏览器之间没有保证，所以不缓存，代价只是一次 getComputedStyle。
   */
  private safe: SafeInsets = NO_INSETS;
  private readInsets(): SafeInsets {
    // 测试可注入 window.__valeSafeInsets 覆盖：headless 里 env() 恒为 0
    return currentSafeInsets();
  }

  /**
   * 当前该给 UI 让多少（CSS 像素）。
   *
   * 每帧都算：转屏 / 地址栏伸缩会同时改 env 与画布高度，只在 setupUiCamera 里判一次的话，
   * 转屏后会退回到错的那一档。
   *
   * 注意用的是 uiInsets 而不是 contentInsets —— top **不**归零。
   * 归零的后果是 HUD 底色盖不住状态栏（build 17 真机："顶部状态栏看都看不到了"），
   * 详见 src/layout.ts 的 hudBandTop 注释。
   */
  private computeUiInsets(): SafeInsets {
    const raw = this.readInsets();
    const h = window.screen?.height || 0;
    if (!h) return raw;
    // 用画布 CSS 高度而不是 innerHeight：画布才是真正被看见的那块，
    // 且它已经被 --app-h / 100dvh 校准过，比 innerHeight 可信。
    return uiInsets(raw, this.scale.height / this.DP, h);
  }

  /** 安全区下沿（画布像素），底部按钮要用 */
  private get safeBottomPx(): number {
    return this.safe.bottom * this.DP;
  }

  private setupUiCamera(): void {
    // 画布内部分辨率 / CSS 像素 —— 唯一一处定义（widgets 里同源复用 uiScale()）
    this.uiDpr = uiScale(this);
    this.safe = this.computeUiInsets();
    const cam = this.cameras.main;
    cam.setOrigin(0, 0);
    cam.setZoom(1);
    cam.setScroll(0, 0);
    cam.setViewport(0, 0, this.scale.width, this.scale.height);
  }

  // ------------------------------------------------------------- HUD

  /**
   * 顶部信息条：一条通栏底 + 四组内容。
   * 宽度按真实屏幕算，窄屏（竖屏）时自动压缩字号与间距，不换行、不溢出。
   *
   * 两层避让，别混为一谈：
   *   1. **安全区**：整条 HUD 从 `safe.top` 起画。画布 viewport-fit=cover 铺满全屏，
   *      不从这起画会被灵动岛整条吃掉（0.4.1 用户实拍）。
   *   2. **内容自身的内边距**：就算躲过安全区，`env()` 在 iOS 上也常比真实遮挡少几像素
   *      （状态栏 translucent 层叠），文字贴着上沿画 → "能点但看不清"（0.4.2 用户实拍）。
   *      所以 HUD 高度由**内容高度 + 上下内边距**反推，而不是写死 34/40。
   */
  private buildHud(): void {
    const W = this.vw;
    const S = this.DP; // CSS → 画布像素
    // 竖屏横向只有 ~390 CSS px，字号要小一档，否则一组数据就占满
    const compact = W / S < 640;
    const fs = compact ? 13 : 17;
    const sub = compact ? 11 : 15;
    // 竖屏两行（日期 / 时间）叠着排，横屏一行放完
    const lineH = compact ? fs + 3 : fs + 4;
    const lines = compact ? 2 : 1;
    // 上下各留 9px：这是"文字不贴遮挡边"的实体保证，比盯 env() 数值可靠
    const padY = 9;
    const HUD_H_CSS = Math.round(lines * lineH + padY * 2);

    const pad = (compact ? 10 : 14) * S;
    // 安全区（CSS 像素）与设计值同量纲，乘 S 后即为画布偏移
    const topPx = this.safe.top * S;
    const hudH = HUD_H_CSS * S;
    this.hudHCss = HUD_H_CSS;

    // 安全区那一条与 HUD 一起铺满，不留缝：两块同色同透明度，看起来是一条整体
    const bandH = topPx + hudH;
    this.add.rectangle(W / 2, bandH / 2, W, bandH, 0x121a11, 0.86)
      .setScrollFactor(0).setDepth(UI_DEPTH.hud);
    // HUD 下沿一条细分隔线：告诉玩家"这条是 UI，下面才是世界"
    this.add.rectangle(W / 2, bandH - S, W, S, 0xc9a06b, 0.28)
      .setScrollFactor(0).setDepth(UI_DEPTH.hud + 1);

    // 内容区垂直居中：锚点用 top，落点从 topPx + padY 起算 —— 不再用 font-size 猜偏移
    const ty = topPx + padY * S;

    // 文字锚点统一 origin(0,0)（左上）：只给 y 起点，垂直位置由 padY 保证，
    // 不再用 fontSize 的倍数去猜（那种猜法在字号一变就会顶到遮挡边）。
    this.dayText = this.add.text(pad, ty, '', {
      fontSize: `${fs * S}px`, color: '#f4ead8', fontFamily: 'sans-serif',
    }).setScrollFactor(0).setDepth(UI_DEPTH.hud + 1);

    // 竖屏时时间另起一行（在日期下面），横屏时靠右排在同一行
    this.timeText = this.add.text(compact ? pad : 150 * S, compact ? ty + lineH * S : ty, '', {
      fontSize: `${(compact ? sub : fs) * S}px`,
      color: compact ? '#c9a06b' : '#f4ead8', fontFamily: 'sans-serif',
    }).setScrollFactor(0).setDepth(UI_DEPTH.hud + 1);

    // 天气 + 金币：贴在右侧体力条左边，按可用宽度反推位置
    const barW = compact ? W * 0.24 : 160 * S;
    const energyX = W - pad - barW - (compact ? 34 * S : 52 * S);
    const coinX = energyX - (compact ? 74 * S : 118 * S);
    // 图标与文字视觉中线对齐：文字从 ty 起、行高 lineH
    const midY = ty + (lineH * S) / 2;

    this.weatherIcon = this.add.image(coinX - (compact ? 18 * S : 26 * S), midY, 'ui', UI.sun)
      .setScrollFactor(0).setDepth(UI_DEPTH.hud + 1).setScale((compact ? 0.6 : 0.85) * S);
    this.add.image(coinX, midY, 'ui', UI.coin)
      .setScrollFactor(0).setDepth(UI_DEPTH.hud + 1).setScale((compact ? 0.6 : 0.85) * S).setName('hud-coin');
    this.goldText = this.add.text(coinX + (compact ? 10 * S : 16 * S), ty, '0', {
      fontSize: `${fs * S}px`, color: '#f2e06a', fontFamily: 'sans-serif',
    }).setScrollFactor(0).setDepth(UI_DEPTH.hud + 1);

    // 体力条（垂直居中到文字行）
    if (!compact) {
      this.add.text(energyX - 22 * S, ty, '体', { fontSize: `${sub * S}px`, color: '#e8e4dc', fontFamily: 'sans-serif' })
        .setScrollFactor(0).setDepth(UI_DEPTH.hud + 1);
    }
    this.add.rectangle(energyX, midY, barW, (compact ? 12 : 16) * S, 0x000000, 0.5)
      .setScrollFactor(0).setDepth(UI_DEPTH.hud + 1).setOrigin(0, 0.5);
    this.energyBar = this.add.rectangle(energyX + S, midY, barW - 2 * S, (compact ? 8 : 12) * S, 0x6cbf4a)
      .setScrollFactor(0).setDepth(UI_DEPTH.hud + 2).setOrigin(0, 0.5);
    this.energyBarMaxW = barW - 2 * S;
    this.energyText = this.add.text(energyX + barW / 2, midY, '', {
      fontSize: `${(compact ? 10 : 13) * S}px`, color: '#ffffff', fontFamily: 'sans-serif',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(UI_DEPTH.hud + 3);
  }

  syncHud(): void {
    if (!this.dayText) return;
    const w = this.gameScene.world;
    const season = seasonOf(w.day);
    this.dayText.setText(`第${w.day}天  ${SEASON_NAMES[season]}季 ${dayOfSeason(w.day)}/${SEASON_DAYS}`);
    this.timeText.setText(clockText(w.minute));
    this.goldText.setText(String(w.gold));
    this.weatherIcon.setFrame(w.weather === 'rain' ? UI.rain : UI.sun);
    const ratio = Phaser.Math.Clamp(w.energy / w.maxEnergy, 0, 1);
    this.energyBar.width = Math.max(0, this.energyBarMaxW * ratio);
    this.energyBar.fillColor = ratio < 0.3 ? 0xd9534f : ratio < 0.6 ? 0xf2c53d : 0x6cbf4a;
    this.energyText.setText(`${Math.ceil(w.energy)}/${w.maxEnergy}`);
    this.syncSeedBtn();
  }

  private syncSeedBtn(): void {
    if (!this.seedIcon) return;
    const w = this.gameScene.world;
    // 当前选中种子没货了 → 自动切到有货的
    if (this.currentSeedCrop && countItem(w.inventory, 'seed:' + this.currentSeedCrop) <= 0) {
      const owned = CROP_ORDER.find((c) => countItem(w.inventory, 'seed:' + c) > 0);
      this.currentSeedCrop = owned ?? null;
    }
    if (this.currentSeedCrop) {
      this.seedIcon.setVisible(true).setFrame((UI as Record<string, number>)[CROPS[this.currentSeedCrop].uiFrame]);
      this.seedText.setText(`×${countItem(w.inventory, 'seed:' + this.currentSeedCrop)}`);
    } else {
      this.seedIcon.setVisible(false);
      this.seedText.setText('空');
    }
  }

  // ------------------------------------------------------------- 按钮

  /**
   * 触控层布局：摇杆固定左下、动作键固定右下、种子槽一排居中。
   * 所有尺寸按「屏幕短边」算，保证任何比例下拇指都够得着、按钮之间不重叠。
   *   短边 390 → 动作键半径 40、摇杆半径 46
   *   短边 844（竖屏横过来看）→ 动作键半径 58、摇杆半径 66
   */
  private buildButtons(): void {
    const W = this.vw;
    const H = this.vh;
    // 所有尺寸先按「CSS 像素」算（390 / 844 这种真实数字，好读也好调），
    // 最后乘 S 落到画布坐标。S = dpr，见 DP 注释。
    const S = this.DP;
    const shortCss = Math.min(W, H) / S;
    const pad = Math.max(10, Math.min(24, shortCss * 0.045)) * S;
    // 底部安全区（iPhone 小白条 / 手势区）：按短边封顶 22
    const safeBottom = Math.min(22, shortCss * 0.06) * S;
    // 系统安全区（Home 指示条 / 手势条）比自己估的还大时要按它来，
    // 否则按钮会压在指示条上 —— iOS 会把上滑手势抢走，按了没反应
    const bottom = Math.max(pad, safeBottom, this.safeBottomPx + pad * 0.5);
    const actR = Phaser.Math.Clamp(shortCss * 0.105, 30, 58) * S;
    const actX = W - pad - actR;
    // 底部对齐：按钮下沿离屏幕底 = bottom，和摇杆的视觉基线一致
    const baseY = H - bottom;
    const actY = baseY - actR;
    // 摇杆半径按短边算，但必须给底盘光圈（1.5r）留出边距 ——
    // 否则 iPad 上 r=67，光圈左边缘会跑到屏幕外 -21px，看着像贴边糊了一块。
    const joyR = Math.min(actR * 1.15, shortCss * 0.14 * S);
    // 光圈半径 = 1.5r。让「光圈外缘」而不是圆心对齐到 pad 内边
    const joyRing = joyR * 1.5;
    const joyX = Math.max(pad + joyRing, joyRing + 4 * S);
    // 底部对齐：光圈外缘也在 baseY 上，和动作键同一基线
    const joyY = baseY - joyRing;

    // 动作键：图标必须和底图同层（靠 displayList 顺序压在上面）。
    // 之前图标用 buttons+1，和 ☰ 的命中区在右上角重叠，结果"点菜单变成做动作"。
    const actBg = this.add.circle(actX, actY, actR, 0x3f7d5a, 0.92)
      .setStrokeStyle(3 * S, 0xffffff, 0.5).setScrollFactor(0).setDepth(UI_DEPTH.buttons);
    this.add.image(actX, actY, 'ui', UI.hoe_up)
      .setScrollFactor(0).setDepth(UI_DEPTH.buttons).setScale((actR / 52) * 1.5);
    this.add.text(actX, actY + actR * 0.62, '互动', {
      fontSize: `${Math.round(actR * 0.34)}px`, color: '#ffffff', fontFamily: 'sans-serif',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(UI_DEPTH.buttons);
    // 命中区比视觉大一圈（手指粗），但不越过屏幕右边
    const actZone = this.add.circle(actX, actY, actR * 1.12, 0xffffff, 0.001)
      .setScrollFactor(0).setDepth(UI_DEPTH.buttons).setInteractive();
    actZone.on('pointerdown', () => {
      SFX.ui();
      actBg.setScale(0.92);
      this.gameScene.doAction();
    });
    this.input.on('pointerup', () => actBg.setScale(1));

    // 种子槽：动作键左侧一排（参考图的物品栏位置），点按切换
    const slot = Phaser.Math.Clamp(actR * 1.24, 44 * S, 74 * S);
    const slotY = actY + (actR - slot / 2) * 0.35;
    const slotX = actX - actR - 12 * S - slot / 2;
    this.seedBtn = this.add.container(slotX, slotY).setScrollFactor(0).setDepth(UI_DEPTH.buttons);
    const sbBg = this.add.rectangle(0, 0, slot, slot, 0x1a2218, 0.82)
      .setStrokeStyle(2 * S, 0xc9a06b, 0.85);
    this.seedIcon = this.add.image(-slot * 0.12, -slot * 0.04, 'ui', UI.radish).setScale(slot / 64);
    this.seedText = this.add.text(slot * 0.22, slot * 0.16, '', {
      fontSize: `${Math.round(slot * 0.28)}px`, color: '#f4ead8', fontFamily: 'sans-serif',
    }).setOrigin(0.5);
    const hint = this.add.text(0, -slot / 2 - 9 * S, '种子', {
      fontSize: `${Math.round(slot * 0.2)}px`, color: '#c9a06b', fontFamily: 'sans-serif',
    }).setOrigin(0.5);
    this.seedBtn.add([sbBg, this.seedIcon, this.seedText, hint]);
    this.seedBtn.setInteractive(
      new Phaser.Geom.Rectangle(-slot / 2, -slot / 2, slot, slot), Phaser.Geom.Rectangle.Contains,
    );
    this.seedBtn.on('pointerup', () => {
      const w = this.gameScene.world;
      const owned = CROP_ORDER.filter((c) => countItem(w.inventory, 'seed:' + c) > 0);
      if (owned.length === 0) { this.toast('没有种子，去商店买吧'); return; }
      const idx = this.currentSeedCrop ? owned.indexOf(this.currentSeedCrop) : -1;
      this.currentSeedCrop = owned[(idx + 1) % owned.length];
      SFX.ui();
    });

    // 系统按钮（右上角）：必须高于 HUD 背景条，否则事件被 HUD 吃掉。
    // 竖屏 HUD 只有 34 高，按钮也跟着缩，别顶出屏幕。
    // 注意：textButton 收的是 **CSS 像素**、内部自己乘 dpr，这里不能再乘 S。
    //
    // y 要落在「安全区下沿 + HUD 中线」：HUD 已经整体下移，☰ 却按 0 起算会跑到
    // 灵动岛里被吞掉（而且它比 HUD 更靠上，压得比 HUD 还狠）。
    // ☰ 的高度跟着 HUD 走（占满内容区高度，留 4px 上下缝），而不是另算一套尺寸：
    // 两套尺寸一旦对不上，按钮就会贴顶或贴底，看起来像"没对齐的补丁"。
    const hudH = this.hudHCss || 52;
    const midY = this.safe.top + hudH / 2;
    const sysH = Math.max(28, hudH - 8);
    const sysW = Phaser.Math.Clamp(sysH * 1.25, 40, 64);
    const sysBtn = textButton(
      this,
      (W - 6 * S - sysW * S / 2) / S, midY,
      sysW, sysH, '☰',
      () => this.openSystem(), { bg: 0x5b5044, fontSize: Math.round(sysH * 0.5) },
    );
    sysBtn.setScrollFactor(0).setDepth(UI_DEPTH.buttons + 2);

    // 摇杆固定左下：把圆心告诉摇杆，"按哪里都从圆心开始算方向"。
    // 圆心用上面算好的 joyX/joyY —— 底盘光圈（1.5r）完整落在屏幕内，不被裁。
    this.joy.setHome(joyX, joyY, joyR);
  }

  getMoveVector(): Phaser.Math.Vector2 {
    return this.joy ? this.joy.vector : new Phaser.Math.Vector2();
  }

  currentSeed(): CropId | null {
    return this.currentSeedCrop;
  }

  setCurrentSeed(c: CropId): void {
    this.currentSeedCrop = c;
  }

  // ------------------------------------------------------------- 提示

  /**
   * 「面板已经开着」这类**需要用户读一眼再处理**的提示，改成屏幕中央的对话框。
   *
   * 以前贴在右上角（☰ 下方 56px）：竖屏时那条位置正好被 HUD + 灵动岛吃掉，
   * 用户只看到"点了没反应"。居中后离两条安全区都远，且带一个明确的「知道了」。
   */
  private showTip(text: string): void {
    this.dismissTip();
    const S = this.DP;
    const W = this.vw;
    const boxW = Math.min(W - 40 * S, 300 * S);
    const boxH = 124 * S;
    const cx = W / 2;
    // 垂直居中（用户要求）：按 HUD 之下的可用区居中，而不是整块画布的几何中心
    const cy = this.panelCenterY(boxH / S);
    const holder = this.add.container(0, 0).setScrollFactor(0).setDepth(UI_DEPTH.toast + 2);
    // 四周压一层很淡的遮罩：只为"点面板外也能关"，不抢游戏观感
    const backdrop = this.add.rectangle(cx, cy, W * 2, this.vh * 2, 0x000000, 0.35).setInteractive();
    const box = this.add.rectangle(cx, cy, boxW, boxH, 0x2a241c, 0.98)
      .setStrokeStyle(3 * S, 0xc9a06b, 1).setInteractive();
    box.on('pointerup', () => { /* 吞掉点击，别穿透到下面的按钮 */ });
    const msg = this.add.text(cx, cy - 18 * S, text, {
      fontSize: `${15 * S}px`, color: '#f4ead8', fontFamily: 'sans-serif',
      align: 'center', wordWrap: { width: boxW - 32 * S },
    }).setOrigin(0.5);
    // 按钮**手工建**，不用 textButton：那个返回的 Container 位置在 add 进另一个
    // Container 时会被重算，落点会跑到左上角（截图踩过）。
    const btnW = 120 * S;
    const btnH = 40 * S;
    const btnY = cy + boxH / 2 - 26 * S;
    const btnBg = this.add.rectangle(cx, btnY, btnW, btnH, 0x3f7d5a)
      .setStrokeStyle(2 * S, 0xffffff, 0.35).setInteractive();
    const btnTxt = this.add.text(cx, btnY, '知道了', {
      fontSize: `${16 * S}px`, color: '#ffffff', fontFamily: 'sans-serif',
    }).setOrigin(0.5);
    const close = () => this.dismissTip();
    btnBg.on('pointerdown', close);
    backdrop.on('pointerup', close);
    holder.add([backdrop, box, msg, btnBg, btnTxt]);
    this.tipObj = holder;
    // 不自动淡出：用户没看见就等于没提示
  }

  private dismissTip(): void {
    this.tipObj?.destroy();
    this.tipObj = undefined;
  }

  toast(text: string): void {
    this.toastObj?.destroy();
    this.toastTimer?.remove();
    const S = this.DP;
    // 垂直居中（用户要求）：以前贴 HUD 下沿，竖屏两行 HUD 一占，提示会挤在屏幕上半截，
    // 还容易被灵动岛那条深色带看着像"压在 HUD 里"。居中后离上下两边都远。
    // 用 (origin 0.5, 0.5) + vh/2：多行文本也能以自身中心对齐屏幕中心。
    const t = this.add.text(this.vw / 2, this.vh / 2, text, {
      fontSize: `${18 * S}px`, color: '#ffffff', fontFamily: 'sans-serif',
      backgroundColor: '#000000aa', padding: { x: 14 * S, y: 9 * S },
      align: 'center', wordWrap: { width: Math.min(560, (this.vw / S) - 48) * S },
    }).setOrigin(0.5).setScrollFactor(0).setDepth(UI_DEPTH.toast);
    this.toastObj = t;
    this.toastTimer = this.time.delayedCall(1800, () => {
      t.destroy();
      if (this.toastObj === t) this.toastObj = undefined;
    });
  }

  // ------------------------------------------------------------- 面板

  private pauseGame(v: boolean): void {
    this.gameScene.timePaused = v;
    // 面板打开时摇杆必须让位，否则手指在面板上划也会拖动摇杆（并吞掉按钮点击）
    if (this.joy) {
      this.joy.locked = v;
      if (v) this.joy.release();
    }
  }

  /** 关闭当前面板并解除暂停（供系统返回键与 e2e 使用） */
  closeTopPanel(): void {
    this.tipObj?.destroy();
    this.tipObj = undefined;
    if (this.activePanel) {
      this.activePanel.close();
      this.activePanel = null;
      this.panelOpen = false;
      this.pauseGame(false);
    }
  }

  openShop(openTab: 'seed' | 'sell' | 'tool' = 'seed'): void {
    if (this.panelOpen) return;
    this.panelOpen = true;
    this.pauseGame(true);
    let tab: 'seed' | 'sell' | 'tool' = openTab;
    const panel = makePanel(this, '杂货铺', () => {
      this.panelOpen = false; this.pauseGame(false); this.activePanel = null;
    });
    this.activePanel = panel;
    this.placePanel(panel);
    const render = () => {
      panel.body.removeAll(true);
      const w = this.gameScene.world;
      const tabs = textButton(this, -180, 8, 100, 34, '买种子', () => { tab = 'seed'; render(); }, { bg: tab === 'seed' ? 0x3f7d5a : 0x5b5044, fontSize: 15 });
      const tabs2 = textButton(this, -60, 8, 100, 34, '出售', () => { tab = 'sell'; render(); }, { bg: tab === 'sell' ? 0x3f7d5a : 0x5b5044, fontSize: 15 });
      const tabs3 = textButton(this, 60, 8, 100, 34, '工具', () => { tab = 'tool'; render(); }, { bg: tab === 'tool' ? 0x3f7d5a : 0x5b5044, fontSize: 15 });
      panel.body.add([tabs, tabs2, tabs3]);
      if (tab === 'seed') this.renderSeedTab(panel, w, render);
      else if (tab === 'sell') this.renderSellTab(panel, w, render);
      else this.renderToolTab(panel, w, render);
    };
    render();
  }

  private renderSeedTab(panel: Panel, w: World, render: () => void): void {
    let y = 44;
    const seeds = seasonSeeds(w.season);
    if (seeds.length === 0) {
      panel.body.add(label(this, -260, y + 30, '这个季节没有种子出售。'));
    }
    for (const c of seeds) {
      const def = CROPS[c];
      const days = def.stageThresholds.reduce((a, b) => a + b, 0);
      panel.body.add(label(this, -270, y + 20, `${def.name}  ${def.seedPrice}G · 约${days}天成熟 · 卖${def.baseSell}G`));
      const b1 = textButton(this, 150, y + 24, 80, 34, '买 1', () => {
        const r = buySeed(w, c, 1);
        this.toast(r.text); if (r.ok) SFX.coin();
        render();
      }, { fontSize: 15 });
      const b5 = textButton(this, 244, y + 24, 80, 34, '买 5', () => {
        const r = buySeed(w, c, 5);
        this.toast(r.text); if (r.ok) SFX.coin();
        render();
      }, { fontSize: 15 });
      panel.body.add([b1, b5]);
      y += 46;
    }
    panel.body.add(label(this, -270, y + 20, `当前金币：${w.gold}G`, { color: '#f2e06a' }));
  }

  private renderSellTab(panel: Panel, w: World, render: () => void): void {
    const entries = cropEntries(w.inventory);
    let y = 44;
    if (entries.length === 0) {
      panel.body.add(label(this, -260, y + 30, '背包里没有可出售的作物。先去田里收获一些吧。'));
    }
    for (const e of entries.slice(0, 5)) {
      const qName = QUALITY[e.quality].name;
      panel.body.add(label(this, -270, y + 20, `${CROPS[e.crop].name}（${qName}）× ${e.n}   单价 ${e.unit}G`));
      const b1 = textButton(this, 170, y + 24, 70, 34, '卖 1', () => {
        const r = sellCrop(w, e.crop, e.quality, 1);
        this.toast(r.text); if (r.ok) SFX.coin();
        render();
      }, { fontSize: 15 });
      const ball = textButton(this, 254, y + 24, 70, 34, '全卖', () => {
        const r = sellCrop(w, e.crop, e.quality, e.n);
        this.toast(r.text); if (r.ok) SFX.coin();
        render();
      }, { fontSize: 15 });
      panel.body.add([b1, ball]);
      y += 46;
    }
    if (entries.length > 0) {
      const ball = textButton(this, 0, y + 40, 220, 40, `全部卖出`, () => {
        const r = sellAllCrops(w);
        this.toast(`卖出 ${r.count} 份作物，+${r.gold}G`);
        if (r.gold > 0) SFX.coin();
        render();
      }, { bg: 0x8a6a2a, fontSize: 17 });
      panel.body.add(ball);
    }
  }

  private renderToolTab(panel: Panel, w: World, render: () => void): void {
    let y = 60;
    panel.body.add(label(this, -270, y - 20, '已拥有：', { color: '#c9a06b' }));
    panel.body.add(label(this, -180, y - 20, `${w.toolCan === 2 ? '铜洒水壶（3 格浇水）' : '旧洒水壶'}   ${w.toolHoe === 2 ? '铜锄头（2 格开垦）' : '旧锄头'}`));
    y += 16;
    for (const t of TOOL_UPGRADES) {
      const owned = (t.id === 'tool:can2' && w.toolCan === 2) || (t.id === 'tool:hoe2' && w.toolHoe === 2);
      panel.body.add(label(this, -270, y + 20, `${t.name}  ${t.price}G\n${t.desc}`, { size: 16 }));
      const b = textButton(this, 180, y + 30, 120, 38, owned ? '已拥有' : '购买', () => {
        if (owned) return;
        const r = buyToolUpgrade(w, t.id);
        this.toast(r.text); if (r.ok) SFX.coin();
        render();
      }, { bg: owned ? 0x555f55 : 0x3f7d5a, fontSize: 15 });
      panel.body.add(b);
      y += 92;
    }
    panel.body.add(label(this, -270, y + 10, `当前金币：${w.gold}G`, { color: '#f2e06a' }));
  }

  openSellBin(): void {
    // 出货箱 = 商店的出售页（随时随地卖，方便手机操作）
    this.openShop('sell');
  }

  openDialog(npcId: string): void {
    if (this.panelOpen) return;
    this.panelOpen = true;
    this.pauseGame(true);
    const w = this.gameScene.world;
    const def = npcDef(npcId);
    const panel = makePanel(this, `${def.name} · ${tierName(tierOf(w.npcs[npcId].friendship))}`, () => {
      this.panelOpen = false; this.pauseGame(false); this.activePanel = null;
    });
    this.activePanel = panel;
    this.placePanel(panel);
    const r = talk(w, npcId);
    let y = 30;
    for (const line of r.lines) {
      panel.body.add(label(this, -270, y, `「${line}」`, { size: 18 }));
      y += 44;
    }
    if (r.rewardLine) {
      panel.body.add(label(this, -270, y, `★ ${r.rewardLine}`, { color: '#f2e06a' }));
      y += 44;
    }
    if (r.friendUp > 0) {
      panel.body.add(label(this, -270, y, `好感度 +${r.friendUp}`, { color: '#e05252', size: 15 }));
      y += 30;
    }
    panel.body.add(label(this, -270, y + 8, `好感度：${Math.floor(w.npcs[npcId].friendship)}（${tierName(tierOf(w.npcs[npcId].friendship))}）· 最爱：${CROPS[def.lovedGift].name}`, { size: 14, color: '#c9a06b' }));

    const giftBtn = textButton(this, -160, 280, 150, 42, w.npcs[npcId].giftedToday ? '今天已送礼' : '送 礼', () => {
      if (w.npcs[npcId].giftedToday) return;
      this.openGiftPicker(npcId);
    }, { bg: w.npcs[npcId].giftedToday ? 0x555f55 : 0x8a6a2a });
    panel.body.add(giftBtn);
  }

  private openGiftPicker(npcId: string): void {
    const w = this.gameScene.world;
    const entries = cropEntries(w.inventory);
    const panel = makePanel(this, '送什么好呢？');
    this.activePanel = panel;
    this.placePanel(panel);
    let y = 40;
    if (entries.length === 0) {
      panel.body.add(label(this, -260, y + 20, '背包里没有可以送的东西。'));
    }
    for (const e of entries.slice(0, 5)) {
      const b = textButton(this, 0, y + 24, 500, 40,
        `${CROPS[e.crop].name}（${QUALITY[e.quality].name}）× ${e.n}`, () => {
          const r = giveGift(w, npcId, `crop:${e.crop}:${e.quality}`);
          if (!r.ok) { this.toast(r.text); return; }
          SFX.harvest();
          this.toast(r.text + (r.rewardLine ? ` ★${r.rewardLine}` : ''));
          panel.close();
        }, { fontSize: 16, bg: 0x5b5044 });
      panel.body.add(b);
      y += 50;
    }
  }

  openSleepConfirm(): void {
    if (this.panelOpen) return;
    this.panelOpen = true;
    this.pauseGame(true);
    const panel = makePanel(this, '睡觉', () => { this.panelOpen = false; this.pauseGame(false); this.activePanel = null; });
    this.activePanel = panel;
    this.placePanel(panel);
    panel.body.add(label(this, -240, 60, '今天到此为止？睡觉会结算作物生长，', { size: 18 }));
    panel.body.add(label(this, -240, 88, '未浇水的作物会停滞一天。', { size: 18 }));
    const yes = textButton(this, -110, 210, 160, 46, '睡觉', () => {
      panel.close();
      this.panelOpen = false;
      this.pauseGame(false);
      this.gameScene.sleep(false);
    }, { bg: 0x3f7d5a, fontSize: 19 });
    const no = textButton(this, 110, 210, 160, 46, '再转一会儿', () => {
      panel.close();
      this.panelOpen = false;
      this.pauseGame(false);
    }, { bg: 0x5b5044, fontSize: 19 });
    panel.body.add([yes, no]);
  }

  showDayReport(lines: string[]): void {
    if (this.panelOpen) return;
    this.panelOpen = true;
    this.pauseGame(true);
    const w = this.gameScene.world;
    const season = seasonOf(w.day);
    const panel = makePanel(this, `第 ${w.day} 天 · ${SEASON_NAMES[season]}季 ${dayOfSeason(w.day)}/${SEASON_DAYS}`, () => {
      this.panelOpen = false; this.pauseGame(false); this.activePanel = null;
    });
    this.activePanel = panel;
    this.placePanel(panel);
    let y = 40;
    for (const l of lines) {
      panel.body.add(label(this, -270, y, `· ${l}`, { size: 17 }));
      y += 34;
    }
    // 竖屏本来就能玩，这个按钮只是「顺便帮你转横屏」：文案要和提示卡片保持一致
    const go = textButton(this, 0, y + 60, 220, 46, '横屏全屏', () => {
      // 必须在用户手势里同步发起全屏/锁屏请求：这是 iOS 之外所有浏览器唯一的放行时机。
      // 放在 panel.close() 之前，避免任何异步等待把"用户手势"上下文丢掉。
      window.__valeEnterLandscape?.();
      panel.close();
      this.panelOpen = false;
      this.pauseGame(false);
    }, { fontSize: 18 });
    panel.body.add(go);
  }

  onGameReady(): void {
    const w = this.gameScene.world;
    if (w.day === 1 && w.stats.harvested === 0 && w.stats.earned === 0) {
      this.showDayReport([
        '欢迎来到微光农庄！',
        '左下拖动移动，右下按钮做动作（自动识别锄地/播种/浇水/收获）。',
        '先清理杂草石头，锄地、播种、浇水，作物第二天就会生长。',
        '去右上的商店买种子，收成的作物可以在农场门口的出货箱直接卖掉。',
        '晚上记得回家睡觉（走到小屋前按动作键），凌晨 2 点会撑不住的。',
      ]);
    } else {
      this.showDayReport(w.collapsedLastNight
        ? ['你昏倒被抬回了床上…记得按时休息。']
        : ['新的一天开始了，作物们等着你浇水。']);
    }
  }

  // ------------------------------------------------------------- 系统菜单

  private fileInput?: HTMLInputElement;

  private ensureFileInput(): void {
    if (this.fileInput) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.style.display = 'none';
    input.addEventListener('change', async () => {
      const f = input.files?.[0];
      input.value = '';
      if (!f) return;
      try {
        const text = await f.text();
        const world = importSave(text);
        if (!world) { this.toast('存档文件无法识别'); return; }
        this.gameScene.world = world;
        this.scene.get('game').scene.restart({ world });
        this.toast('存档已导入');
      } catch {
        this.toast('读取文件失败');
      }
    });
    document.body.appendChild(input);
    this.fileInput = input;
  }

  openSystem(): void {
    if (this.panelOpen) { this.showTip('面板已经打开啦，先关掉它'); return; }
    this.panelOpen = true;
    this.pauseGame(true);
    const panel = makePanel(this, '系统', () => { this.panelOpen = false; this.pauseGame(false); this.activePanel = null; });
    this.activePanel = panel;
    this.placePanel(panel);
    const w = this.gameScene.world;

    const exp = textButton(this, -170, 60, 260, 46, '导出存档（下载 JSON）', () => {
      const data = exportSave(w);
      const blob = new Blob([data], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `vale-farm-save-day${w.day}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 3000);
      this.toast('存档已导出');
    }, { fontSize: 17 });

    const imp = textButton(this, 170, 60, 260, 46, '导入存档（选择文件）', () => {
      this.fileInput?.click();
    }, { bg: 0x5b5044, fontSize: 17 });

    const sfxToggle = textButton(this, -170, 130, 260, 46,
      `音效：${this.settings.sfx ? '开' : '关'}`, () => {
        this.settings.sfx = !this.settings.sfx;
        setSfxEnabled(this.settings.sfx);
        saveSettings(this.settings);
        SFX.ui();
        // 重建面板刷新按钮文案
        panel.close();
        this.panelOpen = false;
        this.pauseGame(false);
        this.openSystem();
      }, { bg: 0x5b5044, fontSize: 17 });

    const help = textButton(this, 170, 130, 260, 46, '操作说明', () => {
      this.toast('左下拖动移动 / 右下按钮做动作 / 种子槽点按切换 / 走到商店、出货箱、小屋前按动作键');
    }, { bg: 0x5b5044, fontSize: 17 });

    // 按钮文案里直接带当前模式：不点进诊断也能一眼确认「这是 PWA 还是标签页」
    const env = textButton(this, 0, 190, 545, 46,
      `环境诊断（当前：${isStandaloneApp() ? 'PWA 独立模式' : '标签页模式'}）`, () => {
        panel.close();
        this.panelOpen = false;
        this.pauseGame(false);
        this.activePanel = null;
        this.openEnvDiag();
      }, { bg: 0x5b5044, fontSize: 17 });

    const stats = label(this, -270, 244,
      `已收获 ${w.stats.harvested} 份作物 · 累计收入 ${w.stats.earned}G · 昏倒 ${w.stats.collapsedCount} 次`, { size: 14, color: '#c9a06b' });
    panel.body.add([exp, imp, sfxToggle, help, env, stats]);
  }

  /**
   * 环境诊断面板。
   *
   * 为什么这个必须做在游戏里：iOS PWA 独立窗口**没有地址栏**，用户没法打开
   * public/diag.html 那种「给个 URL」的诊断页 —— 那条路在 PWA 里根本走不通。
   *
   * 面板同时给出两件事，缺一不可：
   *   - 浏览器报什么（inner / vv / env / dpr）
   *   - 游戏**最后按什么排版**（最终 safe、HUD 高度、首行文字顶边）
   * env() 因故失效时会是全 0，那不代表没遮挡；真正决定画面的是后者。
   */
  private openEnvDiag(): void {
    this.panelOpen = true;
    this.pauseGame(true);
    const panel = makePanel(this, '环境诊断', () => {
      this.panelOpen = false; this.pauseGame(false); this.activePanel = null;
    });
    this.activePanel = panel;
    this.placePanel(panel);
    const S = this.DP;

    const d = collectEnvDiag({
      safe: this.safe,
      hudHCss: this.hudHCss,
      textTopCss: this.dayText.y / S,
      renderScale: S,
    });

    // 取消 body 的「640 基准等比缩放」：那一套是为了让按横屏设计的按钮在竖屏不溢出，
    // 诊断面板是窄排版的文本，缩到 0.58 就小得读不了了。
    panel.body.setScale(1);

    // 行数不固定（UA 那行会按屏宽换行），字号必须自适应，否则最后几行会被面板底边切掉。
    // text.height 在创建后才算得准，所以先建后缩：12px 起，塞不下就每档 0.5px 往下调。
    const availCss = panel.h - 44 - 8; // 44 = 标题栏占位
    let fs = 12;
    const body = this.add.text(-panel.w / 2 * S + 14 * S, 0, d.summary, {
      fontSize: `${fs * S}px`, color: '#d8d2c4',
      fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
      lineSpacing: 3 * S,
      wordWrap: { width: (panel.w - 28) * S },
    });
    while (fs > 7 && body.height > availCss * S) {
      fs -= 0.5;
      body.setFontSize(Math.round(fs * S));
      body.setLineSpacing(Math.round(fs / 4 * S));
    }
    panel.body.add([body]);

    // 复制按钮做标题栏里的一个图标位，不放正文底部 ——
    // 正文行数不确定（UA 会换行），放底部迟早和最后一行叠上。
    // 注意坐标系：✕ 是挂在 root 上（原点=面板中心），这里挂在 body 上
    // （原点=标题栏下沿，即面板顶下 44px 处），所以标题栏行在 body 内是 y=-22。
    const copy = textButton(this, panel.w / 2 - 80, -22, 44, 44, '⧉', () => {
      void copyText(d.summary).then((ok) => {
        this.toast(ok ? '已复制，粘贴发给开发者就行' : '复制失败，请直接截图发来');
      });
    }, { bg: 0x5b5044 });
    panel.body.add([copy]);
  }

  floatText(fx: number, fy: number, text: string): void {
    // 交由 GameScene 在世界坐标里生成飘字
    this.gameScene.spawnFloatText(fx, fy, text);
  }
}
