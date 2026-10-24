import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';

// 只用于诊断显示：版本 / 构建号来自唯一数据源 public/version.json；
// 构建时间是本次 dev server 启动或 build 的时间（每次重启 / 构建都会变）。
const versionMeta = JSON.parse(
  readFileSync(new URL('./public/version.json', import.meta.url), 'utf8'),
) as { ver: string; build: string };

/**
 * 构建时注入 git 信息，供游戏内「环境诊断」显示。
 *   __GIT_SHA__  短 sha（本地有未提交改动时带 -dirty）
 *   __GIT_REF__  CI 里是 tag / 分支名，本地是当前分支
 *
 * 为什么优先读环境变量：GitHub Actions 默认就提供 GITHUB_SHA / GITHUB_REF_NAME，
 * 不必在 runner 上再跑 git（checkout 深度、submodule 之类的问题都能绕开）。
 * 取不到就写 unknown —— 这件事绝不能把构建搞挂。
 */
function gitInfo(): { sha: string; ref: string } {
  const envSha = process.env.GITHUB_SHA ? process.env.GITHUB_SHA.slice(0, 7) : '';
  const envRef = process.env.GITHUB_REF_NAME ?? '';
  const run = (cmd: string): string => {
    try {
      return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    } catch {
      return '';
    }
  };
  let sha = envSha || run('git rev-parse --short=7 HEAD');
  const ref = envRef || run('git rev-parse --abbrev-ref HEAD');
  // 本地有未提交改动时标出来：否则「诊断里的 sha 和实际跑的不一致」要查半天
  if (sha && !envSha && run('git status --porcelain')) sha += '-dirty';
  return { sha: sha || 'unknown', ref: ref || 'unknown' };
}

const git = gitInfo();

// base: './' —— 全部产物相对路径，子目录部署（GitHub Pages 等）天然可用
export default defineConfig({
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(versionMeta.ver),
    __APP_BUILD__: JSON.stringify(versionMeta.build),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    __GIT_SHA__: JSON.stringify(git.sha),
    __GIT_REF__: JSON.stringify(git.ref),
  },
  build: {
    target: 'es2021',
    assetsInlineLimit: 0,
    // phaser 体积大，单独分包并提示体积
    chunkSizeWarningLimit: 1600,
    // 把 Phaser 切到独立 chunk：
    //   1) 改游戏逻辑时 index-*.js 会换 hash，但 phaser-*.js 不变 —— 老玩家只重下小包
    //   2) 首屏两个 chunk 并行下载，比单块 1.5MB 更容易压住白屏时间
    // 注意：tools/postbuild.js 是扫 docs/assets/*.js 注入预缓存清单的，多分片不需要改它。
    rollupOptions: {
      output: {
        manualChunks: {
          phaser: ['phaser'],
        },
      },
    },
    // 产物落在 docs/：**本地产物目录**（已 .gitignore，不入库），
    // 线上由 GitHub Actions 构建后用 actions/deploy-pages 直接部署。
    // 本地拿它跑 preview / test:e2e / package。
    //
    // docs/ 是纯产物目录，人写的文档都在 dev-docs/，两者不混。
    // 因此这里可以让 vite 直接清空产物目录（emptyOutDir: true，默认行为），
    // 由 tools/build.mjs 在 build 前再整目录清一次，保证不会残留上一次的 hash 资源。
    outDir: 'docs',
  },
  server: {
    host: true,
    port: 5173,
  },
  preview: {
    host: true,
    port: 4173,
  },
});
