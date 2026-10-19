// 虚拟摇杆：固定在左下角的一个「底盘 + 摇杆头」。
//
// 与旧实现的区别（旧版是"左半屏任意按下即把摇杆搬过去"）：
//   1. **底盘位置固定**（左下角，由 UIScene 通过 setHome 传入），手机上一眼就能看到摇杆在哪
//   2. 触摸可以从底盘附近任意位置开始（不用精确按在圆心上），方向以**底盘圆心**为基准算
//   3. 竖屏、横屏、超宽屏都不用改摇杆逻辑，只改圆心坐标
//
// 面板打开时必须"让位"—— 否则面板后面的摇杆会跟着手指动，点击也会被吞。

import Phaser from 'phaser';

export class Joystick {
  private base: Phaser.GameObjects.Arc;
  private ring: Phaser.GameObjects.Arc;
  private stick: Phaser.GameObjects.Arc;
  private activePointer: number | null = null;
  private home = new Phaser.Math.Vector2();
  private vec = new Phaser.Math.Vector2();
  private radius = 56;

  /** 由 UI 场景在打开/关闭面板时切换；true 时摇杆完全不响应 */
  locked = false;

  constructor(scene: Phaser.Scene) {
    this.ring = scene.add.circle(0, 0, 56, 0x000000, 0.12)
      .setStrokeStyle(2, 0xffffff, 0.14).setScrollFactor(0).setDepth(900);
    this.base = scene.add.circle(0, 0, 56, 0x000000, 0.3)
      .setStrokeStyle(2, 0xffffff, 0.45).setScrollFactor(0).setDepth(901);
    this.stick = scene.add.circle(0, 0, 26, 0xffffff, 0.6)
      .setScrollFactor(0).setDepth(902);

    scene.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (this.locked) return; // 面板打开时不抢触摸
      if (this.activePointer !== null) return;
      // 只认左下角附近的按下：右半屏留给动作键 / 种子槽 / 面板
      const dx = p.x - this.home.x;
      const dy = p.y - this.home.y;
      if (Math.hypot(dx, dy) > this.radius * 1.9) return;
      if (p.x > scene.scale.width * 0.55) return;
      this.activePointer = p.id;
      this.track(p);
    });
    scene.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (p.id !== this.activePointer) return;
      this.track(p);
    });
    const up = (p: Phaser.Input.Pointer) => {
      if (p.id !== this.activePointer) return;
      this.release();
    };
    scene.input.on('pointerup', up);
    scene.input.on('pointerupoutside', up);
  }

  /** 设置底盘圆心与半径（UIScene 布局时调用，转屏后会重新调用） */
  setHome(x: number, y: number, radius: number): void {
    this.home.set(x, y);
    this.radius = radius;
    this.ring.setPosition(x, y).setRadius(radius * 1.5);
    this.base.setPosition(x, y).setRadius(radius);
    // 摇杆头静止时也留在圆心：手机上一眼能看出摇杆在哪，而不是"随便按哪里都算"
    this.stick.setRadius(Math.max(12, radius * 0.45)).setPosition(x, y);
    this.vec.set(0, 0);
    this.applyAlpha(0.62);
  }

  private applyAlpha(a: number): void {
    this.ring.setAlpha(a * 0.6);
    this.base.setAlpha(a);
    this.stick.setAlpha(Math.min(1, a + 0.3));
  }

  private track(p: Phaser.Input.Pointer): void {
    const dx = p.x - this.home.x;
    const dy = p.y - this.home.y;
    const len = Math.hypot(dx, dy);
    const max = this.radius;
    const cl = Math.min(len, max);
    const nx = len > 0 ? dx / len : 0;
    const ny = len > 0 ? dy / len : 0;
    this.stick.setPosition(this.home.x + nx * cl, this.home.y + ny * cl);
    this.applyAlpha(1);
    // 死区 0.22，输出归一化向量（斜向不会超速：GameScene 里还会再归一一次）
    const mag = cl / max;
    this.vec.set(mag < 0.22 ? 0 : nx * mag, mag < 0.22 ? 0 : ny * mag);
  }

  /** 强制归位（松手、面板弹出时调用） */
  release(): void {
    this.activePointer = null;
    this.vec.set(0, 0);
    this.stick.setPosition(this.home.x, this.home.y);
    this.applyAlpha(0.62);
  }

  get vector(): Phaser.Math.Vector2 {
    if (this.locked) this.vec.set(0, 0);
    return this.vec;
  }
}
