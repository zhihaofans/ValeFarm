# 部署到 GitHub Pages

本项目**源码与可部署产物在同一个仓库里**，产物直接构建到 `docs/`。
所以不需要 `gh-pages` 分支、不需要 GitHub Actions、也不需要手动拷贝文件。

## 一次性配置

1. 把仓库推到 GitHub（`main` 分支要包含 `docs/` 目录）
2. 仓库 → **Settings** → 左侧 **Pages**
3. **Source** 选 `Deploy from a branch`
4. **Branch** 选 `main`，**目录选 `/docs`**，点 Save
5. 等 1~2 分钟，访问 `https://<用户名>.github.io/<仓库名>/`

> 项目页会挂在 `/<仓库名>/` 子路径下。产物全部用相对路径（`vite.config.ts` 的 `base: './'`），
> 子路径**开箱可用**，不用改任何配置。e2e 里有一条「深层子路径 0 条 404」的用例专门守这个。

## 每次更新

```bash
npm run build          # 产物 → docs/
git add docs           # 连同源码一起提交
git commit -m "..."
git push
```

Pages 会在推送后自动重建，产物里的缓存指纹（`CACHE_TAG`）变了，Service Worker
会清旧缓存、提示用户刷新。

## 三个容易踩的点

| 现象 | 原因 | 处理 |
|---|---|---|
| 页面 404 / 白屏 | Pages 源目录没选 `/docs`，或 `docs/index.html` 没提交 | 确认 `docs/index.html` 在仓库里；Settings 里源目录选 `/docs` |
| 静态资源 404 | 用了绝对路径 `/assets/...` | 保持 `base: './'`。已有一条深层子路径的 e2e 用例守着 |
| PWA 装不上 / SW 不注册 | Pages 是 https，本身没问题；多半是访问路径带端口或用了 `file://` | 用 Pages 域名访问；`file://` 能玩但不注册 SW |

## 为什么有 `.nojekyll`

`docs/.nojekyll` 是空文件，作用只有一个：让 Pages **跳过 Jekyll**。
没有它，Jekyll 会忽略所有以 `_` / `.` 开头的文件与目录，还可能改写部分文件的处理方式。
本项目是纯静态产物，直接原样发布即可。

同时 `.nojekyll` 也保证了 `docs/version.json`、`docs/manifest.json` 这些文件按原样可访问。

> 注意：手写文档不在 `docs/` 里，而在仓库根目录的 [`dev-docs/`](../dev-docs/)，不会被发布到网站上。

## 自定义域名（可选）

1. 在 `public/CNAME` 里写一行域名（构建时会拷进 `docs/`；`tools/build.mjs` 的白名单已放行）
2. 域名服务商加一条 `CNAME` 记录指向 `<用户名>.github.io`
3. Pages 设置里填自定义域名并开启 HTTPS

## 本地验证 Pages 效果

```bash
# 模拟子路径部署（最接近 Pages 项目页）
mkdir -p /tmp/site/my-repo && cp -r docs/* /tmp/site/my-repo/
python3 -m http.server 8322 --directory /tmp/site
# 打开 http://127.0.0.1:8322/my-repo/
```
