// UI 场景：HUD、虚拟摇杆、动作键、全部面板（商店/对话/睡觉/晨报/系统）。
// 与 GameScene 单向依赖：只调用其公开方法，不直接改地块。

import Phaser from 'phaser';
import { UI_FONT } from '../ui/font';
import { SEASON_NAMES, SEASON_DAYS, FOREST_X } from '../core/config';
import { CROPS, CROP_ORDER, DECORS, RECIPES } from '../core/data';
import { countItem, craft } from '../core/economy';
import { importSave } from '../core/save';
import { loadSettings } from '../core/storage';
import { SFX, setSfxEnabled } from '../core/audio';
import { clockText, dayOfSeason, seasonOf } from '../core/world';
import { UI } from '../core/generated/ui.frames';
import { TILE } from '../core/generated/tiles.frames';
import { Joystick } from '../ui/joystick';
import { UI_DEPTH, label, makePanel, modalCenterY, textButton, uiScale, type Panel } from '../ui/widgets';
import { buildEnvDiagPanel } from '../ui/panels/envDiagPanel';
import { buildInventoryPanel } from '../ui/panels/inventoryPanel';
import { buildQuickbarPanel } from '../ui/panels/quickbarPanel';
import { buildShopPanel, type ShopTab } from '../ui/panels/shopPanel';
import { buildDayReportPanel, buildSleepConfirmPanel } from '../ui/panels/dayPanels';
import { buildDialogPanel, buildGiftPickerPanel } from '../ui/panels/dialogPanels';
import { buildSystemPanel } from '../ui/panels/systemPanel';
import { currentSafeInsets, NO_INSETS, uiInsets, type SafeInsets } from '../layout';
import type { CropId } from '../core/types';
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
  /** 当前动作键底图，供只注册一次的 pointerup 复位使用 */
  private actBg?: Phaser.GameObjects.Arc;
  private toastObj?: Phaser.GameObjects.Text;
  private toastTimer?: Phaser.Time.TimerEvent;
  private panelOpen = false;
  private activePanel: Panel | null = null;
  /** 面板存在时的轻提示（☰ 与面板同层，点开后按钮仍可点，需要给个"已打开"的反馈） */
  private tipObj?: Phaser.GameObjects.Container;
  private currentSeedCrop: CropId | null = 'radish';
  /** 快捷栏当前物品：seed:<crop> / wood / tool:* */
  private currentQuickItem: string | null = 'seed:radish';
  private settings = loadSettings();
  private resizeTimer?: Phaser.Time.TimerEvent;
  /** 画布内部分辨率 / CSS 像素（= dpr，封顶 2）：HUD 排版用 CSS 像素算，落点到画布要乘它 */
  private uiDpr = 1;

  constructor() {
    super('ui');
  }

  create(): void {
    this.gameScene = this.scene.get('game') as GameScene;
    // 音效开关在启动时就要生效（audio 模块默认开启）
    setSfxEnabled(this.settings.sfx);
    // UI 场景用「CSS 像素」作单位：相机 zoom 按 dpr 反向缩放，HUD 就能用 390/844 这种数字排版
    this.setupUiCamera();
    this.joy = new Joystick(this);
    // 只注册一次：重建按钮时只换 actBg，不再往 input 上叠加监听器
    this.input.on('pointerup', () => this.actBg?.setScale(1));
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
      // 定时器执行完必须清掉：否则 update() 里的 `if (this.resizeTimer) return;`
      // 会永久跳过安全区检测，转屏后 env() 晚到就再也纠正不了。
      this.resizeTimer = undefined;
      const wasPanelOpen = this.panelOpen;
      this.closeTopPanel();
      this.joy?.destroy();
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
    this.joy?.destroy();
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
      panel.resizeShade(this.vw, this.vh, this.panelCenterY(panel.h), this.hudBottomCss * this.DP);
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
  /** HUD 实际下沿（CSS 像素）：遮罩顶边绑定它，避免面板打开那一帧 safe/hud 还是旧值 */
  private hudBottomCss = 0;

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
    // 遮罩只盖 HUD 以下：顶部状态栏/HUD 保持明亮，☰ 仍可点。
    // 用 buildHud 缓存的 hudBottomCss，不在打开面板时重新读 safe：
    // PWA 冷启动/转屏时 safe 可能短暂回 0，用实时值会把遮罩顶到 HUD 中间。
    const cy = this.panelCenterY(panel.h);
    panel.resizeShade(this.vw, this.vh, cy, this.hudBottomCss * this.DP);
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

  /** 安全区左右（画布像素），横屏的灵动岛/圆角要用 */
  private get safeLeftPx(): number {
    return this.safe.left * this.DP;
  }

  private get safeRightPx(): number {
    return this.safe.right * this.DP;
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
    // 安全区（CSS 像素）与设计值同量纲，乘 S 后即为画布偏移。
    // 横屏时 left/right 是灵动岛/圆角，HUD 内容不能压进去（top/bottom 只解决上下）。
    const leftPx = this.safeLeftPx;
    const rightPx = this.safeRightPx;
    const topPx = this.safe.top * S;
    const hudH = HUD_H_CSS * S;
    this.hudHCss = HUD_H_CSS;
    this.hudBottomCss = this.safe.top + HUD_H_CSS;

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
    this.dayText = this.add.text(leftPx + pad, ty, '', {
      fontSize: `${fs * S}px`, color: '#fff8e8', fontFamily: UI_FONT, fontStyle: 'bold',
    }).setScrollFactor(0).setDepth(UI_DEPTH.hud + 1)
      .setShadow(0, 1 * S, '#000000', 2 * S, true, true);

    // 竖屏时时间另起一行（在日期下面），横屏时靠右排在同一行
    this.timeText = this.add.text(
      compact ? leftPx + pad : leftPx + 150 * S,
      compact ? ty + lineH * S : ty,
      '',
      {
        fontSize: `${(compact ? sub : fs) * S}px`,
        color: compact ? '#c9a06b' : '#f4ead8', fontFamily: UI_FONT,
      },
    ).setScrollFactor(0).setDepth(UI_DEPTH.hud + 1);

    // 天气 + 金币：贴在右侧体力条左边，按可用宽度反推位置；右侧同样要让开安全区。
    // 竖屏要为右上 ☰ 留位：按钮宽 ~52.5 + 右边距 6，所以体力条右端再左收 60。
    const barW = compact ? W * 0.24 : 160 * S;
    const energyX = W - rightPx - pad - barW - (compact ? 60 * S : 52 * S);
    const coinX = energyX - (compact ? 74 * S : 118 * S);
    // 图标与文字视觉中线对齐：文字从 ty 起、行高 lineH
    const midY = ty + (lineH * S) / 2;
    // 窄于 380 CSS px（折叠屏外屏等）时隐藏天气图标：右侧已经被 ☰ 和体力条占满，
    // 再画图标会和左侧加粗后的日期文字叠上；iPhone 15 Pro（393）不受影响。
    const showWeather = W / S >= 380;

    this.weatherIcon = this.add.image(coinX - (compact ? 18 * S : 26 * S), midY, 'ui', UI.sun)
      .setScrollFactor(0).setDepth(UI_DEPTH.hud + 1).setScale((compact ? 0.6 : 0.85) * S)
      .setVisible(showWeather);
    this.add.image(coinX, midY, 'ui', UI.coin)
      .setScrollFactor(0).setDepth(UI_DEPTH.hud + 1).setScale((compact ? 0.6 : 0.85) * S).setName('hud-coin');
    this.goldText = this.add.text(coinX + (compact ? 10 * S : 16 * S), ty, '0', {
      fontSize: `${fs * S}px`, color: '#f2e06a', fontFamily: UI_FONT,
    }).setScrollFactor(0).setDepth(UI_DEPTH.hud + 1);

    // 体力条（垂直居中到文字行）
    if (!compact) {
      this.add.text(energyX - 22 * S, ty, '体', { fontSize: `${sub * S}px`, color: '#e8e4dc', fontFamily: UI_FONT })
        .setScrollFactor(0).setDepth(UI_DEPTH.hud + 1);
    }
    this.add.rectangle(energyX, midY, barW, (compact ? 12 : 16) * S, 0x000000, 0.5)
      .setScrollFactor(0).setDepth(UI_DEPTH.hud + 1).setOrigin(0, 0.5);
    this.energyBar = this.add.rectangle(energyX + S, midY, barW - 2 * S, (compact ? 8 : 12) * S, 0x6cbf4a)
      .setScrollFactor(0).setDepth(UI_DEPTH.hud + 2).setOrigin(0, 0.5);
    this.energyBarMaxW = barW - 2 * S;
    this.energyText = this.add.text(energyX + barW / 2, midY, '', {
      fontSize: `${(compact ? 10 : 13) * S}px`, color: '#ffffff', fontFamily: UI_FONT,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(UI_DEPTH.hud + 3);
  }

  syncHud(): void {
    if (!this.dayText) return;
    const w = this.gameScene.world;
    const season = seasonOf(w.day);
    this.dayText.setText(`第${w.day}天  ${SEASON_NAMES[season]}季 ${dayOfSeason(w.day)}/${SEASON_DAYS}`);
    // 调试/定位：地图名在坐标左边；x>=FOREST_X 即林区
    const mapName = w.playerX >= FOREST_X ? '林区' : '村庄';
    this.timeText.setText(`${clockText(w.minute)}  ${mapName}  坐标 (${w.playerX},${w.playerY})`);
    this.goldText.setText(String(w.gold));
    this.weatherIcon.setFrame(w.weather === 'rain' ? UI.rain : UI.sun);
    const ratio = Phaser.Math.Clamp(w.energy / w.maxEnergy, 0, 1);
    // Shape 的渲染走 geom/pathData：直接改 .width 不会重算，必须 setSize
    this.energyBar.setSize(Math.max(0, this.energyBarMaxW * ratio), this.energyBar.height);
    this.energyBar.fillColor = ratio < 0.3 ? 0xd9534f : ratio < 0.6 ? 0xf2c53d : 0x6cbf4a;
    this.energyText.setText(`${Math.ceil(w.energy)}/${w.maxEnergy}`);
    this.syncSeedBtn();
  }

  private syncSeedBtn(): void {
    if (!this.seedIcon) return;
    const w = this.gameScene.world;
    let item = this.currentQuickItem;
    let qty = item ? countItem(w.inventory, item) : 0;
    // 当前快捷物品没货了 → 自动切到有货的种子
    if (!item || qty <= 0) {
      const owned = CROP_ORDER.find((c) => countItem(w.inventory, 'seed:' + c) > 0);
      item = owned ? `seed:${owned}` : null;
      qty = owned ? countItem(w.inventory, `seed:${owned}`) : 0;
      this.currentQuickItem = item;
    }
    this.currentSeedCrop = item?.startsWith('seed:') ? item.slice(5) as CropId : null;
    if (item && qty > 0) {
      this.setQuickVisual(item);
      this.seedIcon.setVisible(true);
      this.seedText.setText(`×${qty}`);
    } else {
      this.seedIcon.setVisible(false);
      this.seedText.setText('空');
    }
  }

  /** 装饰用 tiles 图集，其余用 ui 图集；两个图集不能混着 setFrame，所以统一从这里换贴图 */
  private setQuickVisual(item: string): void {
    if (item.startsWith('decor:')) {
      const key = DECORS.find((d) => d.id === item)?.tile ?? '';
      this.seedIcon.setTexture('tiles', (TILE as Record<string, number>)[key] ?? TILE.weed);
      return;
    }
    this.seedIcon.setTexture('ui', this.quickFrame(item));
  }

  private quickFrame(item: string): number {
    if (item.startsWith('seed:')) {
      const crop = item.slice(5) as CropId;
      return (UI as Record<string, number>)[CROPS[crop].uiFrame] ?? UI.basket;
    }
    if (item === 'wood') return UI.basket;
    if (item === 'tool:can2') return UI.can;
    if (item === 'tool:hoe2') return UI.hoe_up;
    if (item === 'tool:pickaxe') return UI.hoe;
    return UI.basket;
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
    // 横屏时安全区在左右（灵动岛 / 圆角），按钮不能压进去
    const leftPx = this.safeLeftPx;
    const rightPx = this.safeRightPx;
    // 底部安全区（iPhone 小白条 / 手势区）：按短边封顶 22
    const safeBottom = Math.min(22, shortCss * 0.06) * S;
    // 系统安全区（Home 指示条 / 手势条）比自己估的还大时要按它来，
    // 否则按钮会压在指示条上 —— iOS 会把上滑手势抢走，按了没反应
    const bottom = Math.max(pad, safeBottom, this.safeBottomPx + pad * 0.5);
    const actR = Phaser.Math.Clamp(shortCss * 0.105, 30, 58) * S;
    const actX = W - rightPx - pad - actR;
    // 底部对齐：按钮下沿离屏幕底 = bottom，和摇杆的视觉基线一致
    const baseY = H - bottom;
    const actY = baseY - actR;
    // 摇杆半径按短边算，但必须给底盘光圈（1.5r）留出边距 ——
    // 否则 iPad 上 r=67，光圈左边缘会跑到屏幕外 -21px，看着像贴边糊了一块。
    const joyR = Math.min(actR * 1.15, shortCss * 0.14 * S);
    // 光圈半径 = 1.5r。让「光圈外缘」而不是圆心对齐到 pad 内边
    const joyRing = joyR * 1.5;
    const joyX = Math.max(leftPx + pad + joyRing, joyRing + 4 * S);
    // 底部对齐：光圈外缘也在 baseY 上，和动作键同一基线
    const joyY = baseY - joyRing;

    // 动作键：图标必须和底图同层（靠 displayList 顺序压在上面）。
    // 之前图标用 buttons+1，和 ☰ 的命中区在右上角重叠，结果"点菜单变成做动作"。
    const actBg = this.add.circle(actX, actY, actR, 0x3f7d5a, 0.92)
      .setStrokeStyle(3 * S, 0xffffff, 0.5).setScrollFactor(0).setDepth(UI_DEPTH.buttons);
    this.actBg = actBg;
    this.add.image(actX, actY, 'ui', UI.hoe_up)
      .setScrollFactor(0).setDepth(UI_DEPTH.buttons).setScale((actR / 52) * 1.5);
    this.add.text(actX, actY + actR * 0.62, '互动', {
      fontSize: `${Math.round(actR * 0.34)}px`, color: '#ffffff', fontFamily: UI_FONT,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(UI_DEPTH.buttons);
    // 命中区比视觉大一圈（手指粗），但不越过屏幕右边
    const actZone = this.add.circle(actX, actY, actR * 1.12, 0xffffff, 0.001)
      .setScrollFactor(0).setDepth(UI_DEPTH.buttons).setInteractive();
    actZone.on('pointerdown', () => {
      SFX.ui();
      actBg.setScale(0.92);
      this.gameScene.doAction();
    });

    // 种子槽：动作键左侧一排（参考图的物品栏位置），点按切换
    const slot = Phaser.Math.Clamp(actR * 1.24, 44 * S, 74 * S);
    const slotY = actY + (actR - slot / 2) * 0.35;
    const slotX = actX - actR - 12 * S - slot / 2;
    this.seedBtn = this.add.container(slotX, slotY).setScrollFactor(0).setDepth(UI_DEPTH.buttons);
    const sbBg = this.add.rectangle(0, 0, slot, slot, 0x1a2218, 0.82)
      .setStrokeStyle(2 * S, 0xc9a06b, 0.85);
    this.seedIcon = this.add.image(-slot * 0.12, -slot * 0.04, 'ui', UI.radish).setScale(slot / 64);
    this.seedText = this.add.text(slot * 0.22, slot * 0.16, '', {
      fontSize: `${Math.round(slot * 0.28)}px`, color: '#f4ead8', fontFamily: UI_FONT,
    }).setOrigin(0.5);
    const hint = this.add.text(0, -slot / 2 - 9 * S, '快捷', {
      fontSize: `${Math.round(slot * 0.2)}px`, color: '#c9a06b', fontFamily: UI_FONT,
    }).setOrigin(0.5);
    this.seedBtn.add([sbBg, this.seedIcon, this.seedText, hint]);
    this.seedBtn.setInteractive(
      new Phaser.Geom.Rectangle(-slot / 2, -slot / 2, slot, slot), Phaser.Geom.Rectangle.Contains,
    );
    this.seedBtn.on('pointerup', () => {
      SFX.ui();
      this.openQuickbar();
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
      (W - rightPx - 6 * S - sysW * S / 2) / S, midY,
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

  /** 快捷栏当前选中的物品 id（种子 / 木头 / 工具 / 装饰），GameScene 摆放装饰要用 */
  currentQuickItemId(): string | null {
    return this.currentQuickItem;
  }

  setCurrentSeed(c: CropId): void {
    this.currentSeedCrop = c;
    this.currentQuickItem = `seed:${c}`;
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
    // 和 makePanel 一样：记录提示创建时已按下的指针，避免「点 ☰ → 提示弹出 → 抬手」
    // 被 backdrop 当成点外部而立刻关掉。
    const preDown = new Set<Phaser.Input.Pointer>();
    for (const p of this.input.manager.pointers) if (p.isDown) preDown.add(p);
    // 四周压一层很淡的遮罩：只为"点面板外也能关"，不抢游戏观感
    const backdrop = this.add.rectangle(cx, cy, W * 2, this.vh * 2, 0x000000, 0.35).setInteractive();
    const box = this.add.rectangle(cx, cy, boxW, boxH, 0x2a241c, 0.98)
      .setStrokeStyle(3 * S, 0xc9a06b, 1).setInteractive();
    box.on('pointerup', () => { /* 吞掉点击，别穿透到下面的按钮 */ });
    const msg = this.add.text(cx, cy - 18 * S, text, {
      fontSize: `${15 * S}px`, color: '#f4ead8', fontFamily: UI_FONT,
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
      fontSize: `${16 * S}px`, color: '#ffffff', fontFamily: UI_FONT,
    }).setOrigin(0.5);
    const close = () => this.dismissTip();
    btnBg.on('pointerdown', close);
    backdrop.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (preDown.has(p)) { preDown.delete(p); return; }
      close();
    });
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
      fontSize: `${18 * S}px`, color: '#ffffff', fontFamily: UI_FONT,
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

  /** 杂货铺（面板本体在 ui/panels/shopPanel.ts；出货箱复用这里的「出售」页） */
  /** 杂货铺（面板本体在 ui/panels/shopPanel.ts） */
  openShop(openTab: ShopTab = 'seed'): void {
    if (this.panelOpen) return;
    this.panelOpen = true;
    this.pauseGame(true);
    const panel = buildShopPanel({
      scene: this,
      world: this.gameScene.world,
      initialTab: openTab,
      toast: (t) => this.toast(t),
      onClose: () => { this.panelOpen = false; this.pauseGame(false); this.activePanel = null; },
    });
    this.activePanel = panel;
    this.placePanel(panel);
  }

  /** 快捷栏选择器（面板本体在 ui/panels/quickbarPanel.ts） */
  private openQuickbar(): void {
    if (this.panelOpen) return;
    this.panelOpen = true;
    this.pauseGame(true);
    const panel = buildQuickbarPanel({
      scene: this,
      world: this.gameScene.world,
      currentItem: this.currentQuickItem,
      onSelect: (id) => this.applyQuickItem(id),
      onClose: () => { this.panelOpen = false; this.pauseGame(false); this.activePanel = null; },
    });
    this.activePanel = panel;
    this.placePanel(panel);
  }

  /** 把选中的快捷物品落到场景状态上（种子决定播种；装饰决定"摆什么"） */
  private applyQuickItem(id: string): void {
    this.currentQuickItem = id;
    this.currentSeedCrop = id.startsWith('seed:') ? id.slice(5) as CropId : null;
    this.syncSeedBtn();
    SFX.ui();
  }

  /** 物品栏（面板本体在 ui/panels/inventoryPanel.ts） */
  private openInventory(): void {
    if (this.panelOpen) return;
    this.panelOpen = true;
    this.pauseGame(true);
    const panel = buildInventoryPanel({
      scene: this,
      world: this.gameScene.world,
      onClose: () => { this.panelOpen = false; this.pauseGame(false); this.activePanel = null; },
    });
    this.activePanel = panel;
    this.placePanel(panel);
  }

  /** 制作台：木镐子 → 林区北侧岩壁挖矿脉 */
  private openCrafting(): void {
    if (this.panelOpen) return;
    this.panelOpen = true;
    this.pauseGame(true);
    const panel = makePanel(this, '制作台', () => {
      this.panelOpen = false; this.pauseGame(false); this.activePanel = null;
    });
    this.activePanel = panel;
    this.placePanel(panel);
    const render = () => {
      panel.body.removeAll(true);
      const w = this.gameScene.world;
      const wood = countItem(w.inventory, 'wood');
      panel.body.add(label(this, -270, 24, `木头：${wood}`, { size: 16, color: '#f2e06a' }));
      let y = 70;
      for (const recipe of RECIPES) {
        const owned = recipe.result.startsWith('tool:') && countItem(w.inventory, recipe.result) > 0;
        const enough = Object.entries(recipe.cost).every(([id, n]) => countItem(w.inventory, id) >= n);
        panel.body.add(label(this, -270, y, `${recipe.name}`, { size: 18, color: '#f4ead8' }));
        panel.body.add(label(this, -270, y + 26, `${recipe.desc} · 木头 ${countItem(w.inventory, 'wood')} / ${recipe.cost.wood ?? 0}`, { size: 14, color: '#c9a06b' }));
        const btn = textButton(this, 180, y + 24, 150, 40,
          owned ? '已拥有' : enough ? '制作' : '材料不足', () => {
            if (owned) return;
            const r = craft(w, recipe.id);
            this.toast(r.text);
            if (r.ok) SFX.coin(); else SFX.fail();
            render();
          }, { bg: owned ? 0x555f55 : enough ? 0x3f7d5a : 0x5b5044, fontSize: 16 });
        panel.body.add(btn);
        y += 92;
      }
      panel.body.add(label(this, -270, y + 20, '砍树得木头；做好木镐后去林区北侧岩壁挖矿脉（每处 3 下，每天刷新）。', { size: 13, color: '#c9a06b' }));
    };
    render();
  }

  openSellBin(): void {
    // 出货箱 = 商店的出售页（随时随地卖，方便手机操作）
    this.openShop('sell');
  }

  /** NPC 对话（面板本体在 ui/panels/dialogPanels.ts） */
  /** NPC 对话（面板本体在 ui/panels/dialogPanels.ts） */
  openDialog(npcId: string): void {
    if (this.panelOpen) return;
    this.panelOpen = true;
    this.pauseGame(true);
    const panel = buildDialogPanel({
      scene: this,
      world: this.gameScene.world,
      npcId,
      onGift: () => this.openGiftPicker(npcId),
      onClose: () => { this.panelOpen = false; this.pauseGame(false); this.activePanel = null; },
    });
    this.activePanel = panel;
    this.placePanel(panel);
  }

  /** 送礼选择器；先关掉对话面板，避免两个 modal 叠加后 activePanel 指向已销毁的容器 */
  private openGiftPicker(npcId: string): void {
    this.activePanel?.close();
    this.panelOpen = true;
    this.pauseGame(true);
    const panel = buildGiftPickerPanel({
      scene: this,
      world: this.gameScene.world,
      npcId,
      toast: (t) => this.toast(t),
      onClose: () => { this.panelOpen = false; this.pauseGame(false); this.activePanel = null; },
    });
    this.activePanel = panel;
    this.placePanel(panel);
  }

  /** 睡觉确认（面板本体在 ui/panels/dayPanels.ts） */
  /** 睡觉确认（面板本体在 ui/panels/dayPanels.ts） */
  openSleepConfirm(): void {
    if (this.panelOpen) return;
    this.panelOpen = true;
    this.pauseGame(true);
    const panel = buildSleepConfirmPanel({
      scene: this,
      onSleep: () => { this.panelOpen = false; this.pauseGame(false); this.gameScene.sleep(false); },
      onCancel: () => { this.panelOpen = false; this.pauseGame(false); this.activePanel = null; },
    });
    this.activePanel = panel;
    this.placePanel(panel);
  }

  /** 晨报（面板本体在 ui/panels/dayPanels.ts） */
  showDayReport(lines: string[]): void {
    if (this.panelOpen) return;
    this.panelOpen = true;
    this.pauseGame(true);
    const panel = buildDayReportPanel({
      scene: this,
      world: this.gameScene.world,
      lines,
      onClose: () => { this.panelOpen = false; this.pauseGame(false); this.activePanel = null; },
    });
    this.activePanel = panel;
    this.placePanel(panel);
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

  /** 系统菜单（面板本体在 ui/panels/systemPanel.ts） */
  openSystem(): void {
    if (this.panelOpen) { this.showTip('面板已经打开啦，先关掉它'); return; }
    this.panelOpen = true;
    this.pauseGame(true);
    const panel = buildSystemPanel({
      scene: this,
      world: this.gameScene.world,
      settings: this.settings,
      toast: (t) => this.toast(t),
      onClose: () => { this.panelOpen = false; this.pauseGame(false); this.activePanel = null; },
      onReopen: () => this.openSystem(),
      onInventory: () => this.openInventory(),
      onCrafting: () => this.openCrafting(),
      onEnvDiag: () => this.openEnvDiag(),
      onImportClick: () => this.fileInput?.click(),
    });
    this.activePanel = panel;
    this.placePanel(panel);
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
  /**
   * 环境诊断面板。
   *
   * 面板本体已抽到 ui/panels/envDiagPanel.ts（UIScene 拆分第一步）：
   * 这里只负责「置位/复位面板状态 + 把 UI 的实测数值交给它」。
   */
  private openEnvDiag(): void {
    this.panelOpen = true;
    this.pauseGame(true);
    const panel = buildEnvDiagPanel({
      scene: this,
      dpr: this.DP,
      safe: this.safe,
      hudHCss: this.hudHCss,
      textTopCss: this.dayText.y / this.DP,
      toast: (t) => this.toast(t),
      onClose: () => { this.panelOpen = false; this.pauseGame(false); this.activePanel = null; },
    });
    this.activePanel = panel;
    this.placePanel(panel);
  }

  floatText(fx: number, fy: number, text: string): void {
    // 交由 GameScene 在世界坐标里生成飘字
    this.gameScene.spawnFloatText(fx, fy, text);
  }
}
