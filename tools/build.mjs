// 构建入口：清空产物目录 → vite build → 注入 SW 预缓存清单。
//
// 目录分工（从 build 19 之后彻底分开，不再混用）：
//   docs/      纯构建产物，GitHub Pages 的发布源（Pages 只认 / 或 /docs，不能改）
//   dev-docs/  人写的文档（游戏设定、开发交接、部署说明），构建不会碰
//
// 因为产物目录里已经没有手写文件，这里可以放心地整目录清空 —— 不需要
// 「按清单精细删除」那套逻辑了（vite build 19 及之前在用，见 git 历史）。
// 这样也不会再出现「旧 hash 资源堆积」的问题：每次构建都是干净的一份。
//
// 用法：node tools/build.mjs   （package.json 的 build 脚本会调它）

import { rmSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'docs');

// 手写文档的目录：万一有人把文档错放进 docs/，构建前给个明确提示，别默默删掉
const DOC_DIR = 'dev-docs';

// ---- 1. 清空产物目录 ----
if (existsSync(OUT)) {
  rmSync(OUT, { recursive: true, force: true });
  console.log(`已清空产物目录 docs/（手写文档在 ${DOC_DIR}/，不受影响）`);
}

// ---- 2. vite build ----
// 走 npx 而不是直接 import('vite')：保持与命令行完全一致的插件解析与日志格式
const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

run('npx', ['vite', 'build']);

// ---- 3. 注入 SW 预缓存清单 + 缓存指纹 ----
run('node', ['tools/postbuild.js']);
