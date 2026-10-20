import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

// 只用于诊断显示：版本 / 构建号来自唯一数据源 public/version.json；
// 构建时间是本次 dev server 启动或 build 的时间（每次重启 / 构建都会变）。
const versionMeta = JSON.parse(
  readFileSync(new URL('./public/version.json', import.meta.url), 'utf8'),
) as { ver: string; build: string };

// base: './' —— 全部产物相对路径，子目录部署（GitHub Pages 等）天然可用
export default defineConfig({
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(versionMeta.ver),
    __APP_BUILD__: JSON.stringify(versionMeta.build),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  build: {
    target: 'es2021',
    assetsInlineLimit: 0,
    // phaser 体积大，单独分包并提示体积
    chunkSizeWarningLimit: 1600,
    // 产物直接落在 docs/：GitHub Pages 把 /docs 设为发布源即可，仓库里
    // 「源码 + 可部署文件」是一体的，不用另开 gh-pages 分支。
    //
    // docs/ 是**纯产物目录**，人写的文档都在 dev-docs/，两者不混。
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
