# 部署到 GitHub Pages

本项目**仓库里只放源码与手写文档**，构建产物 `docs/` 不入库（见 `.gitignore`）：

| | 说明 |
|---|---|
| `docs/` | 构建产物。**只在本地用**：`npm run preview` 预览、`npm run test:e2e` 跑端到端、`npm run package` 打包校验。已加进 `.gitignore` |
| 线上发布 | 由 [`.github/workflows/release.yml`](../.github/workflows/release.yml) 在 GitHub runner 上构建 `docs/`，再用 `actions/deploy-pages` 直接部署 |

> 公开仓库：<https://github.com/zhihaofans/ValeFarm>
>
> 项目页：<https://zhihaofans.github.io/ValeFarm/>

## 一次性配置

1. 仓库 → **Settings** → 左侧 **Pages**
2. **Source** 选 **`GitHub Actions`**（不是 `Deploy from a branch`）
3. 把工作区里已被 git 跟踪的产物移出版本库（保留本地文件，不动磁盘）：
   ```bash
   git rm -r --cached docs
   git commit -m "chore: docs/ 不再入库，改由 GitHub Actions 部署"
   ```
4. 到 **Actions** 页手动跑一次 `release`（`Run workflow`），确认 build + e2e + deploy 全绿
5. 访问 `https://<用户名>.github.io/<仓库名>/`

> 项目页会挂在 `/<仓库名>/` 子路径下。产物全部用相对路径（`vite.config.ts` 的 `base: './'`），
> 子路径**开箱可用**，不用改任何配置。e2e 里有一条「深层子路径 0 条 404」的用例专门守这个。

## 每次发布

```bash
# 1. 本地验证（和以前一样）
npm test
node tools/stamp.js --bump patch --note "这次改了什么"   # 版本号 + 构建号
npm run build
npm run test:e2e
npm run package                                        # 可选，出 zip

# 2. 提交并打 tag（tag 会触发 CI 构建 + 部署）
git add -A && git commit -m "..." && git push
git tag v0.9.0        # 必须与 public/version.json 的 ver 一致
git push origin v0.9.0
```

CI 分三个 job：

| job | 内容 | 是否卡发布 |
|---|---|---|
| `build` | 校验 tag ↔ `version.json`、`npm test`、`npm run build`、上传 `docs/` 作为 Pages artifact | **卡**（红就不部署） |
| `e2e` | 并行重跑一次构建 + Playwright 端到端（`--retries=1`），失败时上传 `playwright-report` | **卡**（v0.9.2 起收回门禁，红就不部署） |
| `deploy` | `actions/deploy-pages` 部署刚构建的 `docs/`；**只在 tag 或手动触发时跑** | — |

推 `master` 也会触发这套流程（只跑 `build` + `e2e`，`deploy` 被 `if` 跳过），
所以每次改动都有一条自动验证，不用等打 tag 才发现 e2e 红了。

> 0.9.1 期间曾把 e2e 从门禁里摘出来（当时 e2e 因「固定等 1.2s 就假设晨报已弹出」而偶发失败）。
> 等待策略修好后连续三次全绿，**v0.9.2 起已收回**：`deploy.needs = [build, e2e]`。

产物里的缓存指纹（`CACHE_TAG`）由构建脚本按内容注入，变了以后 Service Worker 会清旧缓存并提示用户刷新。

## 本地调试

```bash
npm run dev            # :5173 开发服务器
npm run build          # 产物 → docs/（本地目录，不入库）
npm run preview        # :4173 预览 docs/
npm run test:e2e       # 跑 docs/ 的端到端（必须先 build）
```

模拟子目录部署（最接近 Pages 项目页）：

```bash
mkdir -p /tmp/site/my-repo && cp -r docs/* /tmp/site/my-repo/
python3 -m http.server 8322 --directory /tmp/site
# 打开 http://127.0.0.1:8322/my-repo/
```

## 三个容易踩的点

| 现象 | 原因 | 处理 |
|---|---|---|
| 页面 404 / 白屏 | Pages 的 Source 还是 `Deploy from a branch`，或 `release` workflow 没跑成功 | Settings → Pages 改成 **GitHub Actions**；看 Actions 里 `release` 的日志 |
| 静态资源 404 | 用了绝对路径 `/assets/...` | 保持 `base: './'`。已有一条深层子路径的 e2e 用例守着 |
| PWA 装不上 / SW 不注册 | 访问的不是 https；或本地用了 `file://` | 用 Pages 域名或 `http://127.0.0.1:4173`；`file://` 能玩但不注册 SW |
| 本地跑 e2e 报找不到 docs/ | 产物已不入库，新克隆的仓库没有 `docs/` | 先 `npm run build` |

## 关于 `.nojekyll`（已移除）

`public/.nojekyll` 原本是给「分支部署」跳过 Jekyll 用的。改成 GitHub Actions 部署 artifact 后
它已无作用，**v0.9.2 起已删除**（`tools/package.mjs` 里那条「缺 `.nojekyll` 就拒绝打包」的校验同时去掉）。
如果以后又改回「分支部署」，需要把它加回来。

## 自定义域名（可选）

1. 在 `public/CNAME` 里写一行域名（构建时会拷进 `docs/`；`tools/build.mjs` 的白名单已放行）
2. 域名服务商加一条 `CNAME` 记录指向 `<用户名>.github.io`
3. Pages 设置里填自定义域名并开启 HTTPS
