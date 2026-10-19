// 屏幕适配回归：这一层的 bug 都是"肉眼可见但代码看着没问题"的类型
// （黑边、人物变胖、按钮跑到屏幕外），所以用纯函数把不变量钉死。
import { describe, expect, it } from 'vitest';
import { BASE_H, BASE_W, computeFor, gameZoom } from '../../src/layout';

describe('computeFor：铺满 + 不变形', () => {
  const VPS = [
    [844, 390, 3], // iPhone 13 横
    [390, 844, 3], // iPhone 13 竖
    [667, 375, 2], // iPhone SE 横
    [344, 882, 3], // 折叠屏外屏竖
    [1024, 768, 2], // iPad 横
    [768, 1024, 2], // iPad 竖
    [1920, 1080, 1], // 桌面
  ] as const;

  it('画布内部分辨率严格等于 CSS × dpr（否则 CSS 拉伸会糊/露黑）', () => {
    for (const [w, h, dpr] of VPS) {
      const l = computeFor(w, h, dpr);
      expect(l.renderW).toBe(w * dpr);
      expect(l.renderH).toBe(h * dpr);
    }
  });

  it('dpr 不封顶：3x 屏就是 3 倍像素', () => {
    const l = computeFor(390, 844, 3);
    expect(l.renderW).toBe(1170);
    expect(l.renderH).toBe(2532);
    expect(l.dpr).toBe(3);
  });

  it('可见世界宽高比 == 屏幕宽高比（地块永远方形）', () => {
    for (const [w, h, dpr] of VPS) {
      const l = computeFor(w, h, dpr);
      expect(l.viewW / l.viewH).toBeCloseTo(w / h, 6);
    }
  });

  it('横屏：以 450 高打底，超宽屏按宽补齐（取大者）', () => {
    expect(computeFor(800, 450).zoom).toBeCloseTo(1, 6);
    // 16:9 宽屏：高/450 = 1.2，宽/800 = 1.2 → 1.2（像素不变形，只是看得更多）
    expect(computeFor(960, 540).zoom).toBeCloseTo(1.2, 6);
    // 超宽（21:9）：宽/800 主导
    expect(computeFor(1200, 500).zoom).toBeCloseTo(1200 / BASE_W, 6);
    // 比 16:9 更宽的怪比例（10:3）：仍是宽主导
    expect(computeFor(1200, 360).zoom).toBeCloseTo(1200 / BASE_W, 6);
    // 取的是 max，不是 min —— 取 min 会让世界比屏幕小、露出底色
    for (const [w, h] of [[1200, 360], [844, 390], [667, 375], [1024, 768]] as const) {
      const l = computeFor(w, h);
      expect(l.zoom).toBe(Math.max(h / BASE_H, w / BASE_W));
      // 反证：世界必须铺满屏幕（viewW ≥ w/zoom 恒成立即等价于 zoom 取 max）
      expect(l.viewW * l.zoom).toBeCloseTo(w, 6);
      expect(l.viewH * l.zoom).toBeCloseTo(h, 6);
    }
  });

  it('竖屏：以 844 高打底，横向按同比例收窄（只看得少，不压扁）', () => {
    const l = computeFor(390, 844, 3);
    expect(l.portrait).toBe(true);
    expect(l.zoom).toBeCloseTo(1, 6);
    expect(l.viewW).toBeCloseTo(390, 6);
    expect(l.viewH).toBeCloseTo(844, 6);
    // 更高的竖屏：像素密度跟着涨，横向视野反而收窄 —— 这是有意的，
    // 竖屏 HUD 已按 compact 排版，宁可少看两列也不要地块被缩成芝麻
    const tall = computeFor(344, 882);
    expect(tall.viewW).toBeCloseTo(344 / (882 / 844), 6);
    expect(tall.viewW).toBeGreaterThan(300);
  });

  it('横竖判定用「高 > 宽」，正方形算横屏', () => {
    expect(computeFor(500, 500).portrait).toBe(false);
    expect(computeFor(501, 500).portrait).toBe(false);
    expect(computeFor(500, 501).portrait).toBe(true);
  });

  it('异常输入不产生 0 / NaN（0 宽高、dpr<1 都兜住）', () => {
    const l = computeFor(0, 0, 0);
    expect(l.renderW).toBeGreaterThan(0);
    expect(l.renderH).toBeGreaterThan(0);
    expect(Number.isFinite(l.zoom)).toBe(true);
    expect(l.zoom).toBeGreaterThan(0);
    expect(l.dpr).toBe(1);
  });
});

describe('gameZoom：world px → 画布像素', () => {
  it('画布像素 = CSS×dpr 时，zoom = dpr × 布局 zoom', () => {
    for (const [w, h, dpr] of [[844, 390, 3], [390, 844, 3], [1024, 768, 2]] as const) {
      const l = computeFor(w, h, dpr);
      const z = gameZoom(l.renderW, l.renderH, w, h);
      expect(z).toBeCloseTo(l.zoom * dpr, 6);
    }
  });

  it('任意缩放下 1 world px 在屏幕上的 CSS 尺寸恒定 = layout.zoom', () => {
    // 这是"地块不变形"的等价表述：cssPerWorld 与 dpr 无关
    for (const [w, h, dpr] of [[844, 390, 1], [844, 390, 2], [844, 390, 3]] as const) {
      const l = computeFor(w, h, dpr);
      const canvasPerWorld = gameZoom(l.renderW, l.renderH, w, h);
      // 画布像素 per world px 必须正好等于 zoom × dpr
      expect(canvasPerWorld).toBeCloseTo(l.zoom * dpr, 6);
      // 折算成 CSS 像素后与 dpr 无关
      expect(canvasPerWorld / dpr).toBeCloseTo(l.zoom, 6);
    }
  });

  it('画布尺寸异常时也不返回 0 / NaN（否则世界会消失）', () => {
    // 画布宽度为 0（布局尚未完成）时 zoom 会是 0，调用方需要跳过 setZoom。
    // 这里锁住「不抛错、不 NaN」，把兜底责任明确留在场景层。
    expect(Number.isNaN(gameZoom(0, 0, 800, 450))).toBe(false);
    expect(Number.isFinite(gameZoom(0, 0, 800, 450))).toBe(true);
    expect(Number.isNaN(gameZoom(800, 450, 0, 0))).toBe(false);
    expect(gameZoom(1, 1, 800, 450)).toBeGreaterThan(0);
  });
});
