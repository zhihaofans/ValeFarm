// 主场景：地图渲染、玩家移动、农田交互、日循环驱动。
// 表现层只调用 core 的纯逻辑函数 —— 状态机/经济/结算都在 core 里可单测。

import Phaser from 'phaser';
import { fs, UI_FONT } from '../ui/font';
import {
  FARM_H, FARM_OX, FARM_OY, FARM_W,
  MAP_H, MAP_W, TILE_PX,
  MS_PER_GAME_MINUTE, FORCE_SLEEP_MINUTE,
  SHOP_OPEN_MINUTE, SHOP_CLOSE_MINUTE,
} from '../core/config';
import { CROP_ORDER, DECORS, DIR_ROW, NPCS } from '../core/data';
import { gameZoom } from '../layout';
import {
  doClear, doHarvest, doHoe, doPlant, doWater,
} from '../core/actions';
import { chopTree, treeAt } from '../core/forest';
import { canMine, mineOre, oreAt } from '../core/mine';
import { decorAt, decorBlocks, isDecorId, placeDecor, removeDecor } from '../core/decor';
import { endDay } from '../core/daycycle';
import { seasonSeeds } from '../core/economy';
import { serialize } from '../core/save';
import { writeSaveJson } from '../core/storage';
import { SFX, unlockAudio } from '../core/audio';
import { TILE } from '../core/generated/tiles.frames';
import {
  farmCoord, inMap, plotAt, seasonOf, dayOfSeason,
} from '../core/world';
import type { CropId, Facing, OreState, PlacedDecor, TreeState, World } from '../core/types';
import type { UIScene } from './UIScene';

const SPEED = 110; // px/s
/** 脚底相对角色中心的偏移；碰撞、HUD 坐标、存档统一用脚底格 */
const FOOT_OFFSET = 10;

export class GameScene extends Phaser.Scene {
  world!: World;
  timePaused = false;

  private groundSprites: Phaser.GameObjects.Image[] = [];
  private plotSprites: Phaser.GameObjects.Image[] = [];
  private treeSprites = new Map<string, Phaser.GameObjects.Image>();
  private oreSprites = new Map<string, Phaser.GameObjects.Image>();
  private decorSprites = new Map<string, Phaser.GameObjects.Image>();
  private activeCrops = new Map<number, Phaser.GameObjects.Sprite>();
  private cropFree: Phaser.GameObjects.Sprite[] = [];
  private player!: Phaser.GameObjects.Sprite;
  private npcSprites = new Map<string, Phaser.GameObjects.Sprite>();
  private facingCursor!: Phaser.GameObjects.Rectangle;
  private nightOverlay!: Phaser.GameObjects.Rectangle;
  private rainDrops: Phaser.GameObjects.Rectangle[] = [];
  private minuteAcc = 0;
  private autoSaveAcc = 0;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private keyAct!: Phaser.Input.Keyboard.Key;
  private busy = false;

  constructor() {
    super('game');
  }

  create(data: { world: World }): void {
    this.world = data.world;
    this.buildMap();
    this.buildActors();
    this.ensurePlayerWalkable();
    this.buildFx();
    this.refreshAllPlots();
    this.applyWeather();

    this.applyCameraZoom();
    this.applyCameraBounds();
    // 一屏能看到多少 world 单位：e2e / 调试用，也是"地块是否方"的唯一判据
    window.__valeView = this.viewSize();
    this.cameras.main.startFollow(this.player, true, 0.12, 0.12);
    // 转屏/地址栏收缩：画布尺寸变了，zoom 与取景范围都要重算，否则世界会被非等比拉伸
    this.scale.on('resize', () => { this.applyCameraZoom(); this.applyCameraBounds(); });

    this.cursors = this.input.keyboard!.createCursorKeys();
    this.keyAct = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.keyAct.on('down', () => this.doAction());

    // 触摸解锁音频
    this.input.on('pointerdown', unlockAudio);

    // 切后台 / 页面被系统回收前补一次存档（README 承诺过「切后台自动存档」）
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') void this.save();
    };
    const onPageHide = (): void => { void this.save(); };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    this.events.once('shutdown', () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
    });

    // 全部画面渲染完毕后，通知 UI 显示晨报
    this.time.delayedCall(100, () => {
      (this.scene.get('ui') as UIScene).onGameReady();
    });

    window.__vale = { scene: this, world: this.world };
  }

  // ------------------------------------------------------------- 地图

  private isBlockedTile(tx: number, ty: number): boolean {
    if (!inMap(tx, ty)) return true;
    // 特殊建筑 / 水面 / 栅栏
    if (tx === 2 && ty === 2) return true;   // 小屋
    if (tx === 19 && ty === 2) return true;  // 商店
    if (tx === 15 && ty === 4) return true;  // 出货箱（移到路南，避免道路空气墙）
    if (tx === 23 && ty === 1) return true;  // 村庄第二栋小屋
    if (tx === 21 && ty === 5) return true;  // 水井
    if ((tx === 17 || tx === 20) && ty === 6) return true; // 长椅
    if ((tx === 16 || tx === 23) && ty === 4) return true; // 路灯
    if (tx === 16 && ty === 5) return true;  // 村庄木牌
    if (tx >= 20 && tx <= 23 && ty >= 13) return true;   // 水塘
    if (ty === 4 && tx >= 3 && tx <= 14 && tx !== 8 && tx !== 9) return true; // 栅栏
    if (ty === 15 && tx >= 3 && tx <= 14) return true;
    // 林区树木（hp=0 已砍倒，不再阻挡）
    if (treeAt(this.world, tx, ty)) return true;
    // 林区矿脉（挖空当天不再阻挡，次日恢复）
    if (oreAt(this.world, tx, ty)) return true;
    // 已摆放的装饰（野餐布 blocks=false，可以踩过去）
    if (decorBlocks(this.world, tx, ty)) return true;
    // 农田内的障碍
    const fc = farmCoord(tx, ty);
    if (fc) {
      const p = plotAt(this.world, fc.x, fc.y);
      if (p && p.obstacle) return true;
    }
    // NPC 占位
    for (const [, s] of this.npcSprites) {
      const nx = Math.floor(s.x / TILE_PX);
      const ny = Math.floor(s.y / TILE_PX);
      if (nx === tx && ny === ty) return true;
    }
    return false;
  }

  private drawTree(tree: TreeState): void {
    const img = this.add.image(tree.x * TILE_PX + 16, tree.y * TILE_PX + 16, 'tiles', TILE.tree)
      .setDepth(8);
    img.setVisible(tree.hp > 0);
    this.treeSprites.set(`${tree.x},${tree.y}`, img);
  }

  private refreshTree(tree: TreeState): void {
    this.treeSprites.get(`${tree.x},${tree.y}`)?.setVisible(tree.hp > 0);
  }

  private drawOre(ore: OreState): void {
    const img = this.add.image(ore.x * TILE_PX + 16, ore.y * TILE_PX + 16, 'tiles', TILE.ore)
      .setDepth(8);
    img.setVisible(ore.hp > 0);
    this.oreSprites.set(`${ore.x},${ore.y}`, img);
  }

  private refreshOre(ore: OreState): void {
    this.oreSprites.get(`${ore.x},${ore.y}`)?.setVisible(ore.hp > 0);
  }

  /** 清晨刷矿：所有矿脉重新露头 */
  private refreshAllOres(): void {
    for (const ore of this.world.ores) this.refreshOre(ore);
  }

  // ------------------------------------------------------------- 装饰

  /** DECORS.tile 名字 → tiles 图集帧号；查不到退回杂草帧，绝不抛错 */
  private decorFrame(id: string): number {
    const key = DECORS.find((d) => d.id === id)?.tile ?? '';
    return (TILE as Record<string, number>)[key] ?? TILE.weed;
  }

  /** 挡路的装饰压角色下面一层（6）；野餐布这类贴地（5） */
  private decorDepth(id: string): number {
    return (DECORS.find((d) => d.id === id)?.blocks ?? true) ? 6 : 5;
  }

  private drawDecor(d: PlacedDecor): void {
    const key = `${d.x},${d.y}`;
    this.decorSprites.get(key)?.destroy();
    const img = this.add.image(d.x * TILE_PX + 16, d.y * TILE_PX + 16, 'tiles', this.decorFrame(d.id))
      .setDepth(this.decorDepth(d.id));
    this.decorSprites.set(key, img);
  }

  private destroyDecorSprite(x: number, y: number): void {
    const key = `${x},${y}`;
    this.decorSprites.get(key)?.destroy();
    this.decorSprites.delete(key);
  }

  private refreshAllDecor(): void {
    for (const d of this.world.decor) this.drawDecor(d);
  }

  private buildMap(): void {
    const rnd = new Phaser.Math.RandomDataGenerator(['vale-farm-ground']);
    // 外圈多铺 8 格草地（只画不参与碰撞）：竖屏一屏比地图还高，
    // 不铺的话地图边缘外会露出纯背景色，看起来像黑边。多铺一层最省事也最安全。
    const PAD = 8;
    for (let y = -PAD; y < MAP_H + PAD; y++) {
      for (let x = -PAD; x < MAP_W + PAD; x++) {
        const img = this.add.image(x * TILE_PX + 16, y * TILE_PX + 16, 'tiles', TILE.grass_a);
        // 地表随机化 + 稀疏花丛
        const r = rnd.between(0, 9);
        img.setFrame(r === 0 ? TILE.grass_b : r === 1 ? TILE.grass_c : TILE.grass_a);
        img.setDepth(-10);
        this.groundSprites.push(img);
      }
    }
    const putTile = (tx: number, ty: number, frame: number) => {
      const img = this.add.image(tx * TILE_PX + 16, ty * TILE_PX + 16, 'tiles', frame);
      img.setDepth(-9);
      this.groundSprites.push(img);
      return img;
    };
    const putProp = (tx: number, ty: number, frame: number, depth = 6) => {
      this.add.image(tx * TILE_PX + 16, ty * TILE_PX + 16, 'tiles', frame).setDepth(depth);
    };
    // 小屋 / 商店 / 出货箱 / 床图标位
    putTile(2, 2, TILE.house);
    putTile(19, 2, TILE.shop);
    putTile(15, 4, TILE.bin);
    // 道路
    for (let x = 2; x <= 27; x++) putTile(x, 3, TILE.path);
    putTile(8, 4, TILE.path); putTile(9, 4, TILE.path);
    // 村庄广场：商店/NPC 东侧的小广场，接第二栋小屋
    for (let y = 4; y <= 7; y++) for (let x = 16; x <= 23; x++) putTile(x, y, TILE.path);
    for (let x = 20; x <= 23; x++) putTile(x, 2, TILE.path);
    // 栅栏
    for (let x = 3; x <= 14; x++) {
      if (x !== 8 && x !== 9) putTile(x, 4, TILE.fence);
      putTile(x, 15, TILE.fence);
    }
    // 水塘（只保留农场东侧的小水塘，林区从 x=24 开始）
    for (let y = 13; y <= 15; y++) for (let x = 20; x <= 23; x++) putTile(x, y, TILE.water);
    // 角落树桩装饰
    putTile(0, 0, TILE.stump); putTile(23, 0, TILE.stump);
    putTile(0, 15, TILE.stump);
    // 广场花圃
    for (const [x, y] of [[15, 5], [15, 6], [24, 5], [24, 6]] as Array<[number, number]>) {
      putTile(x, y, (x + y) % 2 ? TILE.grass_b : TILE.grass_c);
    }

    // 村庄装饰（实心，部分可互动）
    putProp(23, 1, TILE.house);
    putProp(21, 5, TILE.well);
    putProp(17, 6, TILE.bench);
    putProp(20, 6, TILE.bench);
    putProp(16, 4, TILE.lamp);
    putProp(23, 4, TILE.lamp);
    putProp(16, 5, TILE.sign);

    // 林区树木
    for (const tree of this.world.trees) this.drawTree(tree);
    // 林区矿脉
    for (const ore of this.world.ores) this.drawOre(ore);
    // 已摆放的装饰
    this.refreshAllDecor();

    // 农田地块（动态帧：wild / tilled_dry / tilled_wet）
    for (let i = 0; i < FARM_W * FARM_H; i++) {
      const x = FARM_OX + (i % FARM_W);
      const y = FARM_OY + Math.floor(i / FARM_W);
      const img = this.add.image(x * TILE_PX + 16, y * TILE_PX + 16, 'tiles', TILE.wild);
      img.setDepth(-8);
      this.plotSprites.push(img);
    }

    // 面朝格光标
    this.facingCursor = this.add.rectangle(0, 0, TILE_PX - 4, TILE_PX - 4)
      // 必须高于树(8)/作物(9)/角色(10)，否则砍树时选中框会被树干盖住
      .setStrokeStyle(2, 0xffffff, 0.9).setDepth(12);

    // 夜色遮罩（随时间加深）
    // 夜色遮罩铺满整屏（scrollFactor 0）：以前按地图大小铺，屏幕比地图大时会漏出一角不暗
    this.nightOverlay = this.add.rectangle(
      this.scale.width / 2, this.scale.height / 2,
      this.scale.width * 2, this.scale.height * 2,
      0x0a1030, 0,
    ).setScrollFactor(0).setDepth(50);
  }

  private buildActors(): void {
    // 动画：4 方向 × [站, 左步, 站, 右步]
    for (const [name, row] of Object.entries(DIR_ROW)) {
      const base = row * 4;
      const mk = (key: string, actor: string) => {
        if (this.anims.exists(key)) return;
        this.anims.create({
          key,
          frames: this.anims.generateFrameNumbers(actor, { frames: [base, base + 1, base + 2, base + 3] }),
          frameRate: 7,
          repeat: -1,
        });
      };
      mk('walk-' + name, 'player');
      mk('npc-walk-' + name, 'npc');
    }

    this.player = this.add.sprite(
      this.world.playerX * TILE_PX + 16, this.world.playerY * TILE_PX + 16, 'player', 0,
    ).setDepth(10);

    for (const def of NPCS) {
      const s = this.add.sprite(def.home.x * TILE_PX + 16, def.home.y * TILE_PX + 16, 'npc', 0).setDepth(10);
      this.npcSprites.set(def.id, s);
    }
  }

  private buildFx(): void {
    if (this.world.weather === 'rain') this.ensureRainDrops();
  }

  /** 雨的视觉对象是池化的：第一次下雨时创建，晴天隐藏，之后再下雨直接复用 */
  private ensureRainDrops(): void {
    if (this.rainDrops.length > 0) return;
    for (let i = 0; i < 60; i++) {
      const d = this.add.rectangle(Phaser.Math.Between(0, MAP_W * TILE_PX), Phaser.Math.Between(0, MAP_H * TILE_PX), 2, 10, 0xa8d4f5, 0.5);
      d.setDepth(40);
      this.rainDrops.push(d);
    }
  }

  private applyWeather(): void {
    if (this.world.weather === 'rain') this.ensureRainDrops();
    for (const d of this.rainDrops) d.setVisible(this.world.weather === 'rain');
  }

  // ------------------------------------------------------------- 农田视觉

  private refreshAllPlots(): void {
    for (let i = 0; i < FARM_W * FARM_H; i++) this.refreshPlot(i);
  }

  private refreshPlot(i: number): void {
    const p = this.world.plots[i];
    const img = this.plotSprites[i];
    if (p.state === 'watered') img.setFrame(TILE.tilled_wet);
    else if (p.state === 'tilled') img.setFrame(TILE.tilled_dry);
    else img.setFrame(TILE.wild);
    if (p.obstacle) {
      img.setFrame(p.obstacle === 'weed' ? TILE.weed : p.obstacle === 'stone' ? TILE.stone : TILE.stump);
    }

    // 作物 sprite（对象池）
    const existing = this.activeCrops.get(i);
    if (p.crop) {
      const frame = CROP_ORDER.indexOf(p.crop.type) * 5 + (p.crop.withered ? 4 : p.crop.stage);
      const x = FARM_OX + (i % FARM_W);
      const y = FARM_OY + Math.floor(i / FARM_W);
      let s = existing;
      if (!s) {
        s = this.cropFree.pop() ?? this.add.sprite(0, 0, 'crops', 0);
        this.activeCrops.set(i, s);
      }
      s.setFrame(frame);
      s.setPosition(x * TILE_PX + 16, y * TILE_PX + 14);
      // 作物是矮作物，统一压在角色下面；以前用 5+y，y>=6 时会飘到角色上层
      s.setDepth(9);
      s.setVisible(true);
    } else if (existing) {
      existing.setVisible(false);
      this.activeCrops.delete(i);
      this.cropFree.push(existing);
    }
  }

  // ------------------------------------------------------------- 主循环

  override update(_time: number, delta: number): void {
    const dt = delta / 1000;
    this.movePlayer(dt);

    if (!this.timePaused && !this.busy) {
      this.minuteAcc += delta;
      while (this.minuteAcc >= MS_PER_GAME_MINUTE) {
        this.minuteAcc -= MS_PER_GAME_MINUTE;
        this.world.minute += 1;
        if (this.world.minute >= FORCE_SLEEP_MINUTE) {
          this.forceSleep();
          break;
        }
      }
      // 体力耗尽 → 昏倒
      if (this.world.energy <= 0 && !this.world.collapsedLastNight) {
        this.collapse();
      }
      // 自动存档（每 20s）
      this.autoSaveAcc += delta;
      if (this.autoSaveAcc > 20000) {
        this.autoSaveAcc = 0;
        void this.save();
      }
    }

    this.updateFacingCursor();
    this.updateNightTint();
    this.updateRain(dt);
    (this.scene.get('ui') as UIScene).syncHud();
  }

  private updateRain(dt: number): void {
    if (this.world.weather !== 'rain') return;
    for (const d of this.rainDrops) {
      d.y += 260 * dt;
      d.x -= 40 * dt;
      if (d.y > MAP_H * TILE_PX) {
        d.y = -10;
        d.x = Phaser.Math.Between(0, MAP_W * TILE_PX);
      }
    }
  }

  private updateNightTint(): void {
    const m = this.world.minute;
    // 18:00 起渐暗，22 点后维持深蓝夜色
    let alpha = 0;
    if (m >= 18 * 60) alpha = Math.min(0.45, (m - 18 * 60) / (4 * 60) * 0.45);
    if (m >= 24 * 60) alpha = Math.min(0.45, 0.3 + (m - 24 * 60) / 120 * 0.15);
    this.nightOverlay.fillColor = 0x0a1030;
    this.nightOverlay.setAlpha(alpha);
  }

  /**
   * 相机 zoom = 屏幕物理尺寸 / 设计基准（见 layout.ts）。
   * 注意 Phaser 的 zoom 是「放大倍数」，与 displayScale 相乘后才是最终像素比；
   * 这样任何屏幕比例下地块都是正方形，只是能看到的范围不同。
   */
  private applyCameraZoom(): void {
    // scale.width 已是画布内部分辨率（CSS×dpr）。Scale.NONE 下 displayScale 恒为 1，
    // 所以只需按 dpr 折算，让 1 world px 正好占 1 CSS 像素乘上 layout 给的密度。
    // 相机内部单位 = 画布像素；屏幕上又被 CSS 拉伸，所以两个比例都要算进去
    const cam = this.cameras.main;
    // 用画布自身的 CSS 显示尺寸，别用 window.inner* —— 两者可能不一致（见 layout.computeLayout）
    const r = document.getElementById('game')?.getBoundingClientRect();
    const cssW = r && r.width > 0 ? r.width : window.innerWidth;
    const cssH = r && r.height > 0 ? r.height : window.innerHeight;
    cam.setZoom(gameZoom(this.scale.width, this.scale.height, cssW, cssH));
    // 相机取景 = 整块画布：世界可以落到灵动岛/圆角下面，由硬件自然遮挡；
    // UI 自己用 uiInsets() 躲开。按安全区裁 viewport 会在横屏左右/底部露黑边，
    // 和「任何比例都铺满」的目标冲突。
    cam.setViewport(0, 0, this.scale.width, this.scale.height);
    this.syncViewSize();
  }

  /** 供调试 / e2e：相机取景范围（整块画布） */
  private syncViewSize(): void {
    const cam = this.cameras.main;
    window.__valeView = { w: cam.width / cam.zoom, h: cam.height / cam.zoom };
  }

  /**
   * 相机取景范围：地图只有 24×16 格（768×512 world px），竖屏一屏要看到 844 world px 高，
   * 比地图还高 —— 直接 setBounds 会在地图下方露出背景色（看起来像黑边）。
   * 这里把范围向两侧各扩半屏，保证相机永远有「地图 + 背景」可画，且人物不会被推到边上。
   */
  private applyCameraBounds(): void {
    const cam = this.cameras.main;
    const mw = MAP_W * TILE_PX;
    const mh = MAP_H * TILE_PX;
    const vw = cam.width / cam.zoom;
    const vh = cam.height / cam.zoom;
    const padX = Math.max(0, (vw - mw) / 2) + 64;
    const padY = Math.max(0, (vh - mh) / 2) + 48;
    cam.setBounds(-padX, -padY, mw + padX * 2, mh + padY * 2);
  }

  /** 当前一屏可见的 world 宽高（含相机 zoom） */
  viewSize(): { w: number; h: number } {
    const cam = this.cameras.main;
    return { w: cam.width / cam.zoom, h: cam.height / cam.zoom };
  }

  private playerTile(): { x: number; y: number } {
    return {
      x: Math.floor(this.player.x / TILE_PX),
      // 与碰撞盒一致：用脚底格，而不是角色中心格。
      // 否则角色站在地图上沿时中心格可能是 -1，存档后重开会卡在越界格。
      y: Math.floor((this.player.y + FOOT_OFFSET) / TILE_PX),
    };
  }

  /** 读档位置如果越界/落在实心格，找最近可行走格，绝不把玩家丢在空气墙里 */
  private ensurePlayerWalkable(): void {
    const start = this.playerTile();
    const set = (x: number, y: number) => {
      this.player.setPosition(x * TILE_PX + 16, y * TILE_PX + 16);
      this.world.playerX = x;
      this.world.playerY = y;
    };
    if (!this.isBlockedTile(start.x, start.y)) {
      this.world.playerX = start.x;
      this.world.playerY = start.y;
      return;
    }
    for (let r = 1; r <= 10; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = start.x + dx;
          const y = start.y + dy;
          if (!this.isBlockedTile(x, y)) { set(x, y); return; }
        }
      }
    }
    set(FARM_OX + 1, FARM_OY - 2); // 最后兜底：出生点
  }

  private facingTile(): { x: number; y: number } {
    const t = this.playerTile();
    const d: Record<Facing, [number, number]> = { down: [0, 1], up: [0, -1], left: [-1, 0], right: [1, 0] };
    const [dx, dy] = d[this.world.facing];
    return { x: t.x + dx, y: t.y + dy };
  }

  private setFacing(f: Facing): void {
    if (this.world.facing === f) return;
    this.world.facing = f;
    this.player.anims.stop();
    this.player.setFrame(DIR_ROW[f] * 4);
  }

  private movePlayer(dt: number): void {
    const ui = this.scene.get('ui') as UIScene;
    if (this.timePaused || this.busy) {
      this.player.anims.stop();
      return;
    }
    const joy = ui.getMoveVector();
    let vx = joy.x;
    let vy = joy.y;
    // 桌面调试键
    if (this.cursors) {
      if (this.cursors.left.isDown) vx = -1;
      if (this.cursors.right.isDown) vx = 1;
      if (this.cursors.up.isDown) vy = -1;
      if (this.cursors.down.isDown) vy = 1;
    }
    const len = Math.hypot(vx, vy);
    if (len < 0.25) {
      this.player.anims.stop();
      this.player.setFrame(DIR_ROW[this.world.facing] * 4);
      return;
    }
    vx /= Math.max(1, len);
    vy /= Math.max(1, len);

    if (Math.abs(vx) > Math.abs(vy)) this.setFacing(vx > 0 ? 'right' : 'left');
    else this.setFacing(vy > 0 ? 'down' : 'up');

    // 逐轴移动 + 脚部碰撞（脚部小碰撞盒，手感顺滑）
    const foot = (x: number, y: number) => this.isBlockedTile(Math.floor(x / TILE_PX), Math.floor((y + FOOT_OFFSET) / TILE_PX));
    const nx = this.player.x + vx * SPEED * dt;
    if (!foot(nx, this.player.y)) this.player.x = nx;
    const ny = this.player.y + vy * SPEED * dt;
    if (!foot(this.player.x, ny)) this.player.y = ny;

    this.player.play('walk-' + this.world.facing, true);
    this.world.playerX = this.playerTile().x;
    this.world.playerY = this.playerTile().y;
  }

  private updateFacingCursor(): void {
    const t = this.facingTile();
    this.facingCursor.setPosition(t.x * TILE_PX + 16, t.y * TILE_PX + 16);
    // 对着实心/障碍格时变橙：杂草这种贴地贴图不再看起来像空气墙
    const blocked = this.isBlockedTile(t.x, t.y);
    this.facingCursor.setStrokeStyle(2, blocked ? 0xffb347 : 0xffffff, 0.9);
  }

  // ------------------------------------------------------------- 动作

  /** 智能动作键：按面朝对象自动选择 锄/种/浇/收/清/对话/商店/睡觉 */
  doAction(): void {
    if (this.busy || this.timePaused) return;
    const t = this.facingTile();
    const pt = this.playerTile();

    // NPC 就在面前（含相邻）
    for (const [id, s] of this.npcSprites) {
      const nx = Math.floor(s.x / TILE_PX);
      const ny = Math.floor(s.y / TILE_PX);
      if ((nx === t.x && ny === t.y) || Math.abs(nx - pt.x) + Math.abs(ny - pt.y) === 1) {
        (this.scene.get('ui') as UIScene).openDialog(id);
        return;
      }
    }

    if (t.x === 19 && t.y === 2) { this.tryOpenShop(); return; }
    if (t.x === 15 && t.y === 4) { (this.scene.get('ui') as UIScene).openSellBin(); return; }
    if (t.x === 2 && t.y === 2) { (this.scene.get('ui') as UIScene).openSleepConfirm(); return; }
    if (t.x === 16 && t.y === 5) {
      (this.scene.get('ui') as UIScene).toast('微光村：西边是农场，东边是林区。');
      SFX.ui();
      return;
    }
    // 村庄第二栋小屋 (23,1)：实心装饰，给它一句台词，别让玩家按了毫无反应
    if (t.x === 23 && t.y === 1) {
      (this.scene.get('ui') as UIScene).toast('窗帘拉着，屋里没亮灯 —— 好像还没人搬进来。');
      SFX.ui();
      return;
    }
    if (t.x === 23 && t.y === 1) {
      // 第二栋小屋：实心装饰，但长得像能进 —— 给一句反馈，别让玩家以为点了没反应
      (this.scene.get('ui') as UIScene).toast('窗帘拉着，屋里没亮灯 —— 好像暂时没人住。');
      SFX.ui();
      return;
    }
    if (t.x === 21 && t.y === 5) {
      (this.scene.get('ui') as UIScene).toast('井水清凉，倒映着今天的云。');
      SFX.ui();
      return;
    }

    // 已摆放的装饰：再按一次互动 = 收回（回到背包，随时可以改主意）
    if (decorAt(this.world, t.x, t.y)) {
      const r = removeDecor(this.world, t.x, t.y);
      if (r.ok) {
        SFX.ui();
        this.destroyDecorSprite(t.x, t.y);
      }
      this.afterAction(r.text, r.ok, 0);
      return;
    }

    // 手上选中了装饰：互动 = 摆到面朝格
    const selItem = (this.scene.get('ui') as UIScene).currentQuickItemId();
    if (selItem && isDecorId(selItem)) {
      if (this.isBlockedTile(t.x, t.y)) {
        (this.scene.get('ui') as UIScene).toast('这里放不下');
        SFX.fail();
        return;
      }
      const r = placeDecor(this.world, selItem, t.x, t.y);
      if (r.ok) {
        SFX.plant();
        this.drawDecor({ id: selItem, x: t.x, y: t.y });
      }
      this.afterAction(r.text, r.ok, 0);
      return;
    }

    // 林区矿脉（要木镐；挖空当天不再有产出）
    const ore = oreAt(this.world, t.x, t.y);
    if (ore) {
      const ui = this.scene.get('ui') as UIScene;
      // 先过「有镐 / 拿在手上 / 还有耐久」三道门，失败原因各不相同
      const gate = canMine(this.world, ui.currentQuickItemId());
      if (!gate.ok) {
        ui.toast(gate.text);
        SFX.fail();
        return;
      }
      const r = mineOre(this.world, t.x, t.y);
      if (r.ok) SFX.mine();
      this.afterAction(r.text, r.ok, r.energy);
      this.refreshOre(ore);
      return;
    }

    // 林区砍树
    const tree = treeAt(this.world, t.x, t.y);
    if (tree) {
      const r = chopTree(this.world, t.x, t.y);
      if (r.ok) SFX.till();
      this.afterAction(r.text, r.ok, r.energy);
      this.refreshTree(tree);
      return;
    }

    const fc = farmCoord(t.x, t.y);
    if (!fc) { (this.scene.get('ui') as UIScene).toast('这里没什么可做的'); return; }
    this.farmAction(fc.x, fc.y);
  }

  private farmAction(fx: number, fy: number): void {
    const ui = this.scene.get('ui') as UIScene;
    const p = plotAt(this.world, fx, fy);
    if (!p) return;

    // 1. 需要清理（枯萎作物优先）
    if ((p.crop && p.crop.withered) || p.obstacle) {
      const r = doClear(this.world, fx, fy);
      SFX.till();
      this.afterAction(r.text, r.ok, r.energy);
      this.refreshPlot(fy * FARM_W + fx);
      return;
    }
    // 2. 收获
    if (p.crop && p.crop.stage >= 3) {
      const r = doHarvest(this.world, fx, fy);
      SFX.harvest();
      this.afterAction(r.text, r.ok, r.energy);
      this.refreshPlot(fy * FARM_W + fx);
      if (r.ok) (this.scene.get('ui') as UIScene).floatText(fx, fy, r.text);
      return;
    }
    // 3. 浇水（升级水壶一次 3 格：垂直于行走方向）
    if (p.crop && !p.crop.withered && p.state !== 'watered') {
      const targets: Array<[number, number]> = [[fx, fy]];
      if (this.world.toolCan === 2) {
        const horiz = this.world.facing === 'left' || this.world.facing === 'right';
        if (horiz) { targets.push([fx, fy - 1], [fx, fy + 1]); }
        else { targets.push([fx - 1, fy], [fx + 1, fy]); }
      }
      let did = 0;
      for (const [x, y] of targets) {
        const r = doWater(this.world, x, y);
        if (r.ok) {
          did++;
          this.refreshPlot(y * FARM_W + x);
        }
      }
      if (did > 0) {
        SFX.water();
        this.afterAction(did > 1 ? `浇了 ${did} 格水` : '浇了水', true, 2 * did);
      } else {
        ui.toast('浇不了水');
        SFX.fail();
      }
      return;
    }
    if (p.crop) { ui.toast('已经浇过水了'); SFX.ui(); return; }
    // 4. 锄地（升级锄头顺带下一格）
    if (p.state === 'wild' && !p.obstacle) {
      const targets: Array<[number, number]> = [[fx, fy]];
      if (this.world.toolHoe === 2) {
        const d: Record<Facing, [number, number]> = { down: [0, 1], up: [0, -1], left: [-1, 0], right: [1, 0] };
        const [dx, dy] = d[this.world.facing];
        const nx2 = fx + dx, ny2 = fy + dy;
        const p2 = plotAt(this.world, nx2, ny2);
        if (p2 && p2.state === 'wild' && !p2.obstacle) targets.push([nx2, ny2]);
      }
      let did = 0;
      for (const [x, y] of targets) {
        const r = doHoe(this.world, x, y);
        if (r.ok) {
          did++;
          this.refreshPlot(y * FARM_W + x);
        }
      }
      if (did > 0) {
        SFX.till();
        this.afterAction(did > 1 ? `翻好了 ${did} 格地` : '翻好了土地', true, 4 * did);
      } else {
        ui.toast('体力不够了…');
        SFX.fail();
      }
      return;
    }
    // 5. 播种
    if (p.state !== 'wild' && !p.crop) {
      const seed = ui.currentSeed();
      if (!seed) {
        // 找一把有货的种子
        const owned = CROP_ORDER.find((c) => (this.world.inventory['seed:' + c] || 0) > 0);
        if (!owned) { ui.toast('没有种子，去商店买吧'); SFX.fail(); return; }
        ui.setCurrentSeed(owned);
        this.doPlantAt(ui, fx, fy, owned);
        return;
      }
      this.doPlantAt(ui, fx, fy, seed);
      return;
    }
    ui.toast('这里不能耕作');
  }

  private doPlantAt(ui: UIScene, fx: number, fy: number, crop: CropId): void {
    const r = doPlant(this.world, fx, fy, crop);
    if (r.ok) SFX.plant(); else SFX.fail();
    this.afterAction(r.text, r.ok, r.energy);
    this.refreshPlot(fy * FARM_W + fx);
  }

  private afterAction(text: string, ok: boolean, _energy: number): void {
    (this.scene.get('ui') as UIScene).toast(text);
    if (!ok) SFX.fail();
    if (this.world.energy <= 0 && ok) this.collapse();
  }

  /** 收获飘字（世界坐标，随相机移动后上浮消失） */
  spawnFloatText(fx: number, fy: number, text: string): void {
    const x = (FARM_OX + fx) * TILE_PX + 16;
    const y = (FARM_OY + fy) * TILE_PX;
    const t = this.add.text(x, y, text, {
      fontSize: `${fs(16)}px`, color: '#ffe08a', fontFamily: UI_FONT,
      stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5).setDepth(100);
    this.tweens.add({
      targets: t, y: y - 40, alpha: 0, duration: 1200, ease: 'Quad.Out',
      onComplete: () => t.destroy(),
    });
  }

  // ------------------------------------------------------------- 日循环

  private tryOpenShop(): void {
    const m = this.world.minute;
    if (m < SHOP_OPEN_MINUTE || m >= SHOP_CLOSE_MINUTE) {
      const open = `${Math.floor(SHOP_OPEN_MINUTE / 60)}:00`;
      const close = `${Math.floor(SHOP_CLOSE_MINUTE / 60)}:00`;
      (this.scene.get('ui') as UIScene).toast(`商店还没开门（${open} - ${close}）`);
      SFX.fail();
      return;
    }
    (this.scene.get('ui') as UIScene).openShop();
  }

  sleep(fromCollapse = false): void {
    if (this.busy) return;
    this.busy = true;
    SFX.sleep();
    const report = endDay(this.world, fromCollapse);

    // 相机淡出 → 结算 → 淡入
    this.cameras.main.fadeOut(400, 0, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.refreshAllPlots();
      this.refreshAllOres();
      this.applyWeather();
      // 新的一天：玩家回到床边
      this.player.setPosition(2 * TILE_PX + 16, 3 * TILE_PX + 16);
      this.world.playerX = 2;
      this.world.playerY = 3;
      this.cameras.main.fadeIn(400, 0, 0, 0);
      this.busy = false;
      (this.scene.get('ui') as UIScene).showDayReport(report.lines);
      void this.save();
    });
  }

  private forceSleep(): void {
    (this.scene.get('ui') as UIScene).toast('夜深了，你撑不住睡着了…');
    // 撑到 2:00 按 GAME_DESIGN 的「昏倒惩罚」处理：体力减半 + 罚金币
    this.sleep(true);
  }

  private collapse(): void {
    this.world.energy = 0;
    SFX.collapse();
    (this.scene.get('ui') as UIScene).toast('眼前一黑，你昏倒了…');
    this.sleep(true);
  }

  // ------------------------------------------------------------- 存档

  async save(): Promise<void> {
    const ok = await writeSaveJson(serialize(this.world));
    if (!ok) {
      const ui = this.scene.get('ui') as UIScene | undefined;
      ui?.toast('存档失败：浏览器存储不可用');
    }
  }

  getSeasonInfo(): { season: number; dayOfSeason: number } {
    return { season: seasonOf(this.world.day), dayOfSeason: dayOfSeason(this.world.day) };
  }

  currentSeasonSeeds(): CropId[] {
    return seasonSeeds(this.world.season);
  }
}

// 供测试与调试
declare global {
  interface Window {
    /** 当前一屏可见的 world 宽高，e2e 用它判断有没有变形 */
    __valeView?: { w: number; h: number };
    __vale?: { scene: GameScene; world: World };
  }
}
