/* 微光农庄 Service Worker
 *
 * 设计要点（踩坑经验）：
 *  - 构建号 BUILD 由发布脚本注入（sed 只改这一处），缓存名随构建变化。
 *  - 预缓存逐个 cache.add + catch：一张图 404 不能连坐整个 install。
 *  - 导航与静态资源一律 cacheFirst：有缓存直接用，后台静默拉新。
 *    （networkFirst 会在弱网冷启动时白屏 1~2 秒——缓存明明有却先等网络。）
 *  - activate 只清理自己前缀的缓存，不误删同域其他应用的。
 *  - 全部相对路径，子目录部署天然可用。
 */

const BUILD = '34';
// CACHE_TAG 由 tools/postbuild.js 按构建产物内容哈希注入。
// 为什么不能只靠 BUILD：BUILD 只在发版时变；若同一版本内多次构建（修 bug 但不升版本），
// 缓存名不变 → cacheFirst 一直吐旧页面，用户在手机上看到的还是旧版（0.4.1 踩过）。
// 用内容哈希后，只要产物变了缓存名必变，activate 会清旧缓存并接管。
const CACHE_TAG = '10';
const CACHE = 'vale-farm-' + BUILD + '-' + CACHE_TAG;
const CACHE_PREFIX = 'vale-farm-';

const ASSETS = [
  './',
  './index.html',
  './diag.html',
  './manifest.json',
  './version.json',
  './assets/tiles.png',
  './assets/crops.png',
  './assets/player.png',
  './assets/npc.png',
  './assets/ui.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon-180.png',
  './icons/favicon-32.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // 逐个缓存：坏一个不连坐，绝不让整个 install reject
    await Promise.all(ASSETS.map(async (url) => {
      try { await cache.add(new Request(url, { cache: 'reload' })); }
      catch (err) { /* 单个资源失败不阻塞安装 */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    // 只清自己前缀的 —— 缓存名前缀是归属声明
    await Promise.all(
      keys.filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE).map((k) => caches.delete(k)),
    );
    await self.clients.claim();
  })());
});

function cacheFirst(e, req) {
  // ignoreVary：预览/静态托管常给 JS 带 Vary: Accept-Encoding，
  // 刷新时的请求头可能与首次不同，严格比较 Vary 会导致缓存明明在却 miss
  return caches.match(req, { ignoreVary: true }).then((hit) => {
    const net = fetch(req).then((resp) => {
      const copy = resp.clone();
      caches.open(CACHE).then((c) => c.put(req, copy));
      return resp;
    }).catch(() => hit);
    return hit || net;
  });
}

/**
 * 诊断页 / 版本清单走 networkFirst。
 *
 * 为什么单独开一口子：这两个页面是「排查线上问题」用的，必须永远是服务端最新的一份。
 * cacheFirst 下它们会被第一次的响应钉死 —— 用户在 PWA 里打开 diag.html 看到的可能是
 * 几个版本前的诊断页，越查越乱。网络失败再退回缓存，断网仍可用。
 */
const NETWORK_FIRST = /\/(diag\.html|version\.json)$/;

function networkFirst(req) {
  return fetch(req).then((resp) => {
    const copy = resp.clone();
    caches.open(CACHE).then((c) => c.put(req, copy));
    return resp;
  }).catch(() => caches.match(req, { ignoreVary: true }));
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (NETWORK_FIRST.test(url.pathname)) {
    e.respondWith(networkFirst(e.request));
    return;
  }
  e.respondWith(cacheFirst(e, e.request));
});
