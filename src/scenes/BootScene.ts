// Boot：加载图集 → 读档（IndexedDB，normalize 校验）→ 进主场景。

import Phaser from 'phaser';
import { loadSaveJson } from '../core/storage';
import { normalizeWorld } from '../core/save';
import type { World } from '../core/types';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('boot');
  }

  preload(): void {
    const { width, height } = this.scale;
    this.add.rectangle(width / 2, height / 2, width, height, 0x1a2218);
    this.add.text(width / 2, height / 2, 'Loading…', {
      fontSize: '20px', color: '#e8e4dc', fontFamily: 'sans-serif',
    }).setOrigin(0.5);

    // 全部本地资源，无外链 —— 断网时只要 SW 缓存了这些文件就能进游戏
    this.load.spritesheet('tiles', 'assets/tiles.png', { frameWidth: 32, frameHeight: 32 });
    this.load.spritesheet('crops', 'assets/crops.png', { frameWidth: 32, frameHeight: 32 });
    this.load.spritesheet('player', 'assets/player.png', { frameWidth: 32, frameHeight: 32 });
    this.load.spritesheet('npc', 'assets/npc.png', { frameWidth: 32, frameHeight: 32 });
    this.load.spritesheet('ui', 'assets/ui.png', { frameWidth: 32, frameHeight: 32 });
  }

  async create(): Promise<void> {
    let world: World;
    try {
      const json = await loadSaveJson();
      world = json ? normalizeWorld(JSON.parse(json)) : normalizeWorld(null);
    } catch {
      world = normalizeWorld(null);
    }
    this.scene.start('game', { world });
    this.scene.launch('ui');
  }
}
