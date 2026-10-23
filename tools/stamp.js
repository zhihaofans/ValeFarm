// 版本发布脚本：四处一次写齐 + 回读校验。
// 版本信息唯一数据源是 version.json —— 其余位置都从这里写入，绝无第二处手工同步。
//
// 用法：node tools/stamp.js --bump [major|minor|patch] --note "这次改了什么"
//       node tools/stamp.js --set 1.2.3 --note "..."
//       node tools/stamp.js --build          # 只递增构建号（重发同一版本）

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const verFile = resolve(ROOT, 'public/version.json');
const swFile = resolve(ROOT, 'public/sw.js');

const args = process.argv.slice(2);
function argOf(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] ?? null : null;
}

const meta = JSON.parse(readFileSync(verFile, 'utf-8'));
let build = parseInt(meta.build ?? '0', 10) || 0;

// 分支优先级：--set > --bump > --build。
// 早期版本先判 --build，导致 `--set 0.4.1 --build` 只提了构建号、版本号纹丝不动（踩过）。
const set = argOf('--set');
const doBump = args.includes('--bump');
const doBuild = args.includes('--build');

if (!set && !doBump && !doBuild) {
  console.error('用法：--bump [major|minor|patch] | --set X.Y.Z | --build，均可带 --note');
  process.exit(1);
}

if (set) {
  if (!/^\d+\.\d+\.\d+$/.test(set)) {
    console.error(`--set 需要 X.Y.Z 形式，收到 ${set}`);
    process.exit(1);
  }
  meta.ver = set;
} else if (doBump) {
  const kind = argOf('--bump') ?? 'patch';
  const [ma, mi, pa] = String(meta.ver).split('.').map((n) => parseInt(n, 10) || 0);
  meta.ver = kind === 'major' ? `${ma + 1}.0.0`
    : kind === 'minor' ? `${ma}.${mi + 1}.0`
    : `${ma}.${mi}.${pa + 1}`;
}

// 只要带了 --note 就一定写进去（含只提构建号的情况）：
// 只提构建号但不改说明，会让 version.json 里躺着一句上个版本的描述（踩过）
const note = argOf('--note');
if (note) meta.note = note;

build += 1;
meta.build = String(build);
writeFileSync(verFile, JSON.stringify(meta, null, 2) + '\n');

// sw.js 只注入 BUILD 一处（拼接式，不发版不变化时 SW 字节不变的问题由 version.json 比对兜底）
let sw = readFileSync(swFile, 'utf-8');
sw = sw.replace(/const BUILD = '[^']*';/, `const BUILD = '${meta.build}';`);
writeFileSync(swFile, sw);

// ---- 同步 package.json / package-lock.json 的 version ----
// 展示版本唯一数据源仍是 public/version.json；这里同步只是为了消掉 CI 日志里
// `vale-farm@0.1.0 build` 这种和实际版本对不上的噪音（排查时会误导）。
const pkgFile = resolve(ROOT, 'package.json');
const lockFile = resolve(ROOT, 'package-lock.json');
const pkg = JSON.parse(readFileSync(pkgFile, 'utf-8'));
if (pkg.version !== meta.ver) {
  pkg.version = meta.ver;
  writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + '\n');
}
if (existsSync(lockFile)) {
  const lock = JSON.parse(readFileSync(lockFile, 'utf-8'));
  let touched = false;
  if (lock.version !== meta.ver) { lock.version = meta.ver; touched = true; }
  if (lock.packages && lock.packages[''] && lock.packages[''].version !== meta.ver) {
    lock.packages[''].version = meta.ver; touched = true;
  }
  if (touched) writeFileSync(lockFile, JSON.stringify(lock, null, 2) + '\n');
}

// ---- 回读校验：校验「语义」，不是「字符串」----
const swBack = readFileSync(swFile, 'utf-8');
const chkBuild = /const BUILD = '(\d+)';/.exec(swBack)?.[1];
// 缓存名 = 'vale-farm-' + BUILD + '-' + CACHE_TAG（CACHE_TAG 由 tools/postbuild.js 按构建产物
// 内容哈希注入）。BUILD 只随发版变；同一版本内多次构建靠 CACHE_TAG 换新缓存，见 public/sw.js。
const chkCacheForm = /const CACHE = 'vale-farm-' \+ BUILD \+ '-' \+ CACHE_TAG;/.test(swBack);
const metaBack = JSON.parse(readFileSync(verFile, 'utf-8'));
const ok = chkBuild === metaBack.build && chkCacheForm;
console.log(`version.json → v${metaBack.ver} build ${metaBack.build}`);
console.log(`sw.js        → BUILD ${chkBuild} / CACHE 拼接式 ${chkCacheForm ? 'OK' : 'MISS'}`);
if (!ok) {
  console.error('校验失败，发布中止');
  process.exit(1);
}
