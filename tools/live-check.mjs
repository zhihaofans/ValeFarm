// 线上冒烟：对已部署的地址做「真机口径」检查。
//
// 为什么 e2e 之外还要这个：
//   e2e 跑的是本地 preview，dpr 只在少数用例里显式设过。真机上 dpr=2/3，
//   一旦有尺寸常量忘了乘 dpr，面板与按钮会缩到 1/dpr（0.4.0 线上才发现）。
//   本脚本对每个视口都用 CDP 真触摸走一遍「关晨报 → 点互动键」，
//   并在 dpr 与视口都变化时逐条断言，出问题直接指出是哪一项。
//
// 用法：node tools/live-check.mjs <URL>
//       URL 必须显式传入 —— 仓库不记录任何部署地址。

import { chromium } from 'playwright';
import fs from 'node:fs';

const URL = process.argv[2];
if (!URL) {
  console.error('用法：node tools/live-check.mjs <URL>');
  process.exit(1);
}
const OUT = 'screenshots/live';

const VPS = [
  { name: 'iphone13-竖', width: 390, height: 844, dpr: 3 },
  { name: 'iphone13-横', width: 844, height: 390, dpr: 3 },
  { name: 'iphoneSE-横', width: 667, height: 375, dpr: 2 },
  { name: 'ipad-竖', width: 768, height: 1024, dpr: 2 },
  { name: 'ipad-横', width: 1024, height: 768, dpr: 2 },
  { name: '折叠屏-竖', width: 344, height: 882, dpr: 2.5 },
];

fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
const rows = [];

for (const vp of VPS) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: vp.dpr, isMobile: true, hasTouch: true,
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.__vale, null, { timeout: 20000 });
  await page.waitForTimeout(900);

  const cdp = await ctx.newCDPSession(page);
  const tap = async (pt) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pt.x, y: pt.y }] });
    await page.waitForTimeout(120);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(420);
  };
  const open = () => page.evaluate(() => !!window.__vale.scene.scene.get('ui').panelOpen);

  const geo = () => page.evaluate(() => {
    const u = window.__vale.scene.scene.get('ui');
    const S = u.uiDpr, W = u.scale.width, H = u.scale.height;
    const r = document.querySelector('canvas').getBoundingClientRect();
    const shortCss = Math.min(W, H) / S;
    const actR = Math.max(30, Math.min(58, shortCss * 0.105)) * S;
    const pad = Math.max(10, Math.min(24, shortCss * 0.045)) * S;
    const p = u.activePanel;
    const close = p?.root.list.find((o) => o.depth === 1010);
    return {
      canvas: [Math.round(r.width), Math.round(r.height)],
      attr: [document.querySelector('canvas').width, document.querySelector('canvas').height],
      scroll: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
      panel: p ? { w: p.w, h: p.h } : null,
      close: close ? { x: r.x + (p.root.x + close.x) / S, y: r.y + (p.root.y + close.y) / S } : null,
      act: { x: r.x + (W - pad - actR) / S, y: r.y + (H - pad - actR) / S },
      joy: { x: r.x + u.joy.home.x / S, y: r.y + u.joy.home.y / S, r: u.joy.radius / S },
    };
  });

  await page.evaluate(() => document.querySelector('#rotate-continue')?.click());
  await page.waitForTimeout(200);

  // 1) 晨报开着 → 先量它的尺寸，再点 ✕ 关掉
  let g = await geo();
  const openedAtStart = await open();
  const reportPanel = g.panel; // ← 必须在关掉之前取，关掉后 activePanel 就是 null 了
  if (openedAtStart && g.close) await tap(g.close);
  const closedByX = !(await open());

  // 2) NPC 面前点互动键 → 应弹出对话
  await page.evaluate(() => {
    const v = window.__vale;
    v.scene.player.setPosition(18 * 32 + 16, 5 * 32 + 16);
    v.world.facing = 'up';
  });
  await page.waitForTimeout(250);
  g = await geo();
  await tap(g.act);
  const actOpens = await open();

  // 3) 截图（带面板 / 干净各一张）
  await page.evaluate(() => window.__vale.scene.scene.get('ui').closeTopPanel());
  await page.waitForTimeout(350);
  g = await geo();
  await page.screenshot({ path: `${OUT}/${vp.name}.png` });

  const checks = {
    // 面板按 CSS 尺寸撑开：min(640, 屏宽-24) × min(360, 屏高-40)
    panelCss: !!reportPanel && Math.abs(reportPanel.w - Math.min(640, vp.width - 24)) <= 1
      && Math.abs(reportPanel.h - Math.min(360, vp.height - 40)) <= 1,
    closedByX,
    actOpens,
    noScroll: g.scroll[0] <= vp.width + 1 && g.scroll[1] <= vp.height + 1,
    joyLeftBottom: g.joy.x < vp.width / 2 && g.joy.y > vp.height / 2,
    actRightBottom: g.act.x > vp.width / 2 && g.act.y > vp.height / 2,
    noErrors: errs.length === 0,
  };
  const pass = Object.values(checks).every(Boolean);
  rows.push({ vp: `${vp.width}×${vp.height}@${vp.dpr}`, pass, ...checks, panel: reportPanel, errs: errs.slice(0, 2) });
  await ctx.close();
}

// 4) 运行中旋转（不刷新）
{
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.__vale, null, { timeout: 20000 });
  await page.waitForTimeout(800);
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(900);
  const m = await page.evaluate(() => {
    const v = window.__valeView;
    const u = window.__vale.scene.scene.get('ui');
    const c = document.querySelector('canvas').getBoundingClientRect();
    return {
      css: [Math.round(c.width), Math.round(c.height)],
      ratioOk: Math.abs(v.w / v.h - 844 / 390) < 0.02,
      joy: { x: Math.round(u.joy.home.x / u.uiDpr), y: Math.round(u.joy.home.y / u.uiDpr) },
    };
  });
  await page.screenshot({ path: `${OUT}/旋转后.png` });
  rows.push({ vp: '旋转 390×844→844×390', pass: m.css[0] === 844 && m.css[1] === 390 && m.ratioOk, ...m });
  await ctx.close();
}

await browser.close();
fs.writeFileSync(`${OUT}/report.json`, JSON.stringify(rows, null, 2));
for (const r of rows) console.log(r.pass ? '✅' : '❌', r.vp, JSON.stringify(r));
const bad = rows.filter((r) => !r.pass).length;
console.log(bad ? `\n❌ ${bad} 项未通过` : '\n✅ 线上全部视口通过');
process.exit(bad ? 1 : 0);
