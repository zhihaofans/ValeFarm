import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { GameScene } from './scenes/GameScene';
import { UIScene } from './scenes/UIScene';
import { initOrientation } from './orientation';
import { computeLayout, watchViewport } from './layout';
import { waitPixelFont } from './ui/font';

// 画布不写死 16:9：内部分辨率直接等于视口×dpr，由各场景的相机 zoom 反补。
// 这样任何比例（16:9 / 19.5:9 / 4:3 / 竖屏）都铺满，且地块不变形 —— 见 src/layout.ts。
const L = computeLayout();
// 调试出口：e2e 需要读"一屏能看到多少 world 单位"来判断有没有变形
(window as unknown as { __valeLayout?: unknown }).__valeLayout = L;

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game',
  width: L.renderW,
  height: L.renderH,
  backgroundColor: '#1a2218',
  pixelArt: true,
  roundPixels: true,
  scale: {
    // NONE：画布像素尺寸固定，CSS 由 index.html 撑满 100%×100%（FIT 会留黑边）
    mode: Phaser.Scale.NONE,
    zoom: 1,
    width: L.renderW,
    height: L.renderH,
  },
  physics: { default: 'arcade' },
  render: { antialias: false },
  fps: { target: 60, min: 30 },
  scene: [BootScene, GameScene, UIScene],
};

// 横屏策略统一收在 orientation.ts：手势里请求全屏 + 锁屏；竖屏不再拦截，遮罩只做"建议"。
initOrientation();

/**
 * 视口高度兜底：把实测可视高度写进 CSS 变量 --app-h。
 *
 * 为什么需要：iOS Safari 的 height:100% / 100vh 都是 layout viewport，地址栏一收放
 * 就和真实可视区差 40~80px，画布底部会露出一条背景色（用户实拍截图里的黑带）。
 * 所以按实测值写死一个高度，而不是交给 vh。
 *
 * ⚠️ 用 innerHeight，**不要用 visualViewport.height**（build 17 的坑）。
 * 真机实测（iPhone 393×852，iOS PWA）：
 *
 *   innerHeight          = 793   （852 - 59，系统已扣掉状态栏）
 *   visualViewport.height = 793
 *   但 html 仍按 852 高排版（--app-h=793 只改了 html 的高度写死值，body/#game 却还是 793，
 *   819 以下到 852 这段露出 html 的背景色，看起来就是"底布一片空白"）
 *
 * 结果就是截图里那两条：画面只画到 793，下面 59px 是背景色。
 * 正确的做法是让页面**铺满整个屏幕**（852），由画布内部的 HUD 去盖住状态栏那 59px，
 * 由相机取景负责避让。这样 CSS 高度、画布内部分辨率、屏幕三者严格相等，
 * 不存在"多出来的 59px"可以露出来。
 *
 * innerHeight 已经是被系统扣过状态栏的"可视区"，比 screen.height 更合适：
 * 它和 visualViewport 在 PWA 下通常一致，而在 Safari 标签页里还能跟着地址栏走。
 * （isStandalone 见 src/layout.ts 的 isStandaloneApp —— 这里不再重复定义。）
 */

/**
 * 量可视高度的「确定值」。
 *
 * 为什么不能只读一次：iOS 的 PWA 冷启动时 innerHeight / visualViewport 往往还是旧值
 * （甚至 0），几十毫秒后才稳定下来；如果第一次就读到 0 / 旧值并写进 --app-h，
 * 页面就定格在错的高度。所以这里返回 null 表示"还没量准，继续等"，由重试循环负责。
 */
function measureAppHeight(): number | null {
  const h = Math.round(window.innerHeight || 0);
  return h > 0 ? h : null;
}

/** 写 --app-h 并强制回流；返回值表示"尺寸是否真的变了"（调用方据此决定要不要重设画布） */
function applyAppHeight(h: number): boolean {
  const prev = document.documentElement.style.getPropertyValue('--app-h');
  const next = `${h}px`;
  if (prev === next) return false;
  document.documentElement.style.setProperty('--app-h', next);
  // 读一次布局属性强制回流：否则紧接着的 computeLayout 可能读到改高度之前的尺寸
  void document.documentElement.offsetHeight;
  return true;
}

function syncAppHeight(): void {
  const h = measureAppHeight();
  if (h === null) return;
  applyAppHeight(h);
}
syncAppHeight();

/**
 * PWA 冷启动补测：独立窗口里 visualViewport 会晚 1~3 帧才稳定，甚至给出中间值。
 * 早先只写一次 --app-h，用户实拍就是「顶部多一条深色带 + 底部一条黑带」——
 * 那不是 CSS 错，而是量到一个偏小的旧高度后页面就再也没重新量过。
 * 这里在前 1.2 秒内逐帧比对，量到变化就重排一次；之后交给 resize 事件。
 */
let settleFrames = 0;
function settleAppHeight(): void {
  syncCanvasSize();
  if (++settleFrames > 72) return; // ~1.2s 后停手，避免空转
  requestAnimationFrame(settleAppHeight);
}

/** 画布随视口变化重设内部分辨率；各场景在 resize 事件里自己重排 UI */
function syncCanvasSize(): void {
  syncAppHeight();
  const l = computeLayout();
  const game = window.__game;
  if (!game) return;
  if (game.scale.width === l.renderW && game.scale.height === l.renderH) return;
  game.scale.setGameSize(l.renderW, l.renderH);
}

window.addEventListener('load', () => {
  // 先等像素字体就绪再开局：Phaser 的 Text 是"建对象时定字体"，
  // 字体没到就会拿回退字体画首屏，之后再换得重建所有文本对象。
  // waitPixelFont 自带 1.5s 超时，等不到就直接用回退字体开局 —— 字体绝不能卡住首屏。
  void (async () => {
    await waitPixelFont();
    window.__game = new Phaser.Game(config);
    // 游戏起来之后再补测几帧：此时 #game 已生成，computeLayout 才量得到真实尺寸
    settleAppHeight();
  })();
});
watchViewport(syncCanvasSize);

declare global {
  interface Window {
    __game?: Phaser.Game;
  }
}
