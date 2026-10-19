// 打包：一个 zip 里同时装「源码」和「可直接部署的产物」。
//
// 为什么合并成一个包：
//   以前是源码 zip + dist zip 两个文件，下载后还得自己对版本、对不上就白折腾。
//   GitHub Pages 要的是 docs/，改代码要的是 src/，两种需求本来就是同一个仓库的两面
//   —— 干脆一个包把仓库原样装进去，解压即是一份能 build 也能直接发布的完整项目。
//
// 包内结构（与仓库一致，GitHub Pages 可直接把 /docs 设为发布源）：
//   README.md / package.json / index.html / vite.config.ts ...
//   src/ tests/ tools/ public/     ← 源码与工程配置
//   docs/                          ← 构建产物（GitHub Pages 发布源，纯产物）
//   dev-docs/                      ← 人写的文档（交接手册 / 游戏设定 / 部署说明）
//
// 用法：node tools/package.mjs [输出目录]
//       默认输出到仓库上一级（就是 /workspace），文件名带版本与构建号。

import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, statSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = resolve(process.argv[2] ?? join(ROOT, '..'));

const ver = JSON.parse(readFileSync(resolve(ROOT, 'public/version.json'), 'utf-8'));
const name = `微光农庄-v${ver.ver}-build${ver.build}.zip`;
const target = join(OUT_DIR, name);

// 必须先把当前版本的产物构建出来，否则包里躺的是上一次的 docs/
if (!existsSync(resolve(ROOT, 'docs/index.html'))) {
  console.error('docs/index.html 不存在，先跑 npm run build');
  process.exit(1);
}
const built = JSON.parse(readFileSync(resolve(ROOT, 'docs/version.json'), 'utf-8'));
if (built.build !== ver.build) {
  console.error(`docs/ 里的产物是 build ${built.build}，源码是 build ${ver.build} —— 先跑 npm run build`);
  process.exit(1);
}
if (!existsSync(resolve(ROOT, 'docs/.nojekyll'))) {
  console.error('docs/.nojekyll 缺失：GitHub Pages 会走 Jekyll，产物可能被忽略');
  process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });
rmSync(target, { force: true });

// -x 排除的都是「装进去没用、还特别占地方」的东西：
//   node_modules（一个多 G，别人 npm install 就有）、.git（几百 M 历史）、
//   测试临时产物、本地预览缓存。
const EXCLUDES = [
  'node_modules/*', '.git/*', 'test-results/*', 'playwright-report/*',
  '*.log', '.DS_Store', '**/.DS_Store',
];

execFileSync('zip', [
  '-qr', target, '.',
  ...EXCLUDES.flatMap((e) => ['-x', e]),
], { cwd: ROOT, stdio: 'inherit' });

const size = statSync(target).size;
console.log(`\n打包完成：${target}`);
console.log(`  ${name}  ${(size / 1024 / 1024).toFixed(2)} MB`);
console.log('  内容：源码（src/ tests/ tools/ public/）+ 可部署产物（docs/）+ 开发文档（dev-docs/）');
console.log('  接手开发请先读 dev-docs/DEV_HANDOVER.md');
