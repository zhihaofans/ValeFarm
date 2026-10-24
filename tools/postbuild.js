// 构建后处理（两件事，都不可省）：
//  1. 把 vite 产出的带 hash 的 JS/CSS 注入 sw.js 的预缓存清单。
//     没有这一步，离线时 bundle 不在缓存里 → 断网白屏（"缓存名存在 ≠ 断网能打开"）。
//  2. 把缓存名里的 CACHE_TAG 换成「构建产物内容哈希」。
//     没有第二步，同一版本号内多次构建时缓存名不变 → 手机上一直是旧页面（0.4.1 踩过）。

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

// 产物目录；可用 VALE_OUT 覆盖（e2e / 临时验证指到别的目录时用）
const DIST = process.env.VALE_OUT
  ? resolve(process.env.VALE_OUT)
  : resolve(dirname(fileURLToPath(import.meta.url)), '..', 'docs');
const swPath = resolve(DIST, 'sw.js');

const assets = readdirSync(resolve(DIST, 'assets')).filter((f) => /\.(js|css)$/.test(f)).sort();
// 字体也必须在预缓存里：断网时字体没缓存 → 首屏退回系统字体（观感直接不一样）
const fontDir = resolve(DIST, 'fonts');
const fonts = (() => {
  try {
    return readdirSync(fontDir).filter((f) => /\.(woff2?|otf|ttf)$/.test(f)).sort();
  } catch {
    return [];
  }
})();
const extra = [
  ...assets.map((f) => `  './assets/${f}',`),
  ...fonts.map((f) => `  './fonts/${f}',`),
];

let sw = readFileSync(swPath, 'utf-8');
if (!sw.includes('const ASSETS = [')) {
  console.error('sw.js 结构不符合预期，中止');
  process.exit(1);
}
sw = sw.replace('const ASSETS = [', `const ASSETS = [\n${extra.join('\n')}`);
writeFileSync(swPath, sw);

// 内容哈希：JS/CSS 文件名本身带 hash，再叠上 index.html / version.json / manifest
const h = createHash('sha1');
for (const f of assets) h.update(readFileSync(resolve(DIST, 'assets', f)));
for (const f of fonts) h.update(readFileSync(resolve(fontDir, f)));
for (const f of ['index.html', 'version.json', 'manifest.json']) {
  try { h.update(readFileSync(resolve(DIST, f))); } catch { /* 缺文件跳过 */ }
}
const tag = h.digest('hex').slice(0, 8);

if (!/const CACHE_TAG = '[^']*';/.test(sw)) {
  console.error('sw.js 缺少 CACHE_TAG 占位，中止');
  process.exit(1);
}
sw = sw.replace(/const CACHE_TAG = '[^']*';/, `const CACHE_TAG = '${tag}';`);
writeFileSync(swPath, sw);

console.log(`sw.js 预缓存清单注入 ${extra.length} 项（assets ${assets.length} + fonts ${fonts.length}） · CACHE_TAG=${tag}`);
