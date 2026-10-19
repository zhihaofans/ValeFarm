import { chromium } from 'playwright';
const URL = process.argv[2] ?? 'http://127.0.0.1:3000/';
const browser = await chromium.launch({ channel: 'chrome' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
const page = await ctx.newPage();

// 1) 先人为塞一个「旧版缓存」，模拟用户手机上的现状
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.evaluate(async () => {
  const c = await caches.open('vale-farm-10');           // 旧命名（无 tag）
  await c.put('/', new Response('OLD-STALE-PAGE', { headers: { 'content-type': 'text/html' } }));
});

// 2) 重新加载让新 SW 安装 + activate
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(2500);

const r = await page.evaluate(async () => {
  const keys = await caches.keys();
  const reg = (await navigator.serviceWorker.getRegistrations())[0];
  return {
    cacheKeys: keys,
    swActive: reg?.active?.state,
    swUrl: reg?.active?.scriptURL?.split('/').pop(),
    controlled: !!navigator.serviceWorker.controller,
  };
});
console.log(JSON.stringify(r, null, 1));

const stale = r.cacheKeys.includes('vale-farm-10');
const fresh = r.cacheKeys.some((k) => /^vale-farm-\d+-[0-9a-f]{8}$/.test(k));
console.log(stale ? '❌ 旧缓存仍存在' : '✅ 旧缓存已清理');
console.log(fresh ? '✅ 新缓存名带内容哈希' : '❌ 未生成带哈希的新缓存');
console.log(r.controlled ? '✅ 页面已受新 SW 接管' : '❌ 未被接管');

// 3) 再刷一次：新 SW 已 activated，这次应受控
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(800);
const ctl2 = await page.evaluate(() => !!navigator.serviceWorker.controller);
console.log(ctl2 ? '✅ 第二次加载已受控' : '❌ 第二次仍未受控');

// 4) 确认页面内容不是那段假的旧 HTML
const body = await page.evaluate(() => document.body.innerHTML.length);
console.log(body > 500 ? `✅ 页面是真实内容（${body} 字符）` : `❌ 页面仍是旧缓存（${body} 字符）`);

await browser.close();
process.exit(stale || !fresh ? 1 : 0);
