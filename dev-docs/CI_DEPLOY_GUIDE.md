# 把「产物目录入库 + 分支部署」改成「CI 构建 + Actions 部署」

> 通用迁移手册，适用于任何「纯前端 + GitHub Pages」项目。
> 目标：主分支只留源码，构建产物由 CI 生成并直接部署；本地仍保留产物用于 preview / e2e / 打包。
> 文中的 `docs/` 指产物目录，按项目实际替换（`dist/`、`build/` 同理）。

---

## 0. 迁移后的形态（先看懂再动手）

```
源码 push / 打 tag ──▶ GitHub Actions
                        ├─ build : npm ci → 版本一致性校验 → 单测 → 构建 → 上传 Pages 产物
                        ├─ e2e   : 真实浏览器跑端到端（可选门禁）
                        └─ deploy: actions/deploy-pages（仅 tag / 手动触发）
                                   ↓
                            GitHub Pages（源 = GitHub Actions）
```

三条硬约束：

1. **产物目录不入库**，Pages 的 Source 改成 `GitHub Actions`（不再是 `Deploy from a branch`）。
2. **只有 tag（或手动触发）才部署**；push 到主分支只做构建校验，绝不动线上。
3. **版本一致性校验放在 build 的第一批步骤**，校验不过就不构建、不部署。

---

## 1. 一次性改动（仓库侧）

```bash
# 1) 产物目录加入 .gitignore（本地文件保留，只是不再跟踪）
echo "docs/" >> .gitignore

# 2) 把已跟踪的产物从索引里摘掉（磁盘文件不动，本地 preview/e2e/打包照旧）
git rm -r --cached docs

# 3) 提交
git add -A
git commit -m "chore: 构建产物不再入库，改由 GitHub Actions 部署"
```

> 注意：`git rm -r --cached` 只改索引。工作区文件还在，`npm run preview`、e2e、打包脚本都不受影响。

---

## 2. 一次性改动（GitHub 网页侧）

**Repository → Settings → Pages → Source → 选 `GitHub Actions`**（保存即生效，不需要重新部署）。

- 如果原来选的是 `Deploy from a branch`（branch = main / docs），切过来之后，每次 push 触发的 legacy `pages build and deployment` 就不会再跑了；历史里那几条失败记录可以无视。
- 这一步**只能人工点**，`GITHUB_TOKEN` 没有改 Pages 设置的权限（除非用带 `pages: write` + admin 的个人 token）。

---

## 3. workflow 模板

放到 `.github/workflows/release.yml`。把 `<BUILD_DIR>`、`<VERSION_FILE>`、`<TAG_PREFIX>` 换成自己项目的值。

```yaml
name: release

on:
  push:
    tags: ['v*']          # 发布
    branches: [main]      # 日常检查（只构建校验，不部署）
  workflow_dispatch:       # 手动触发：第一次接入时先干跑一遍

permissions:
  contents: read           # 产物不再提交回仓库，读权限就够
  pages: write
  id-token: write

concurrency:
  group: pages-${{ github.ref }}
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v5
        with: { fetch-depth: 0 }     # 校验 tag 是否在主线上需要历史

      - uses: actions/setup-node@v5
        with: { node-version: '20', cache: npm }

      - run: npm ci

      # ---- 版本一致性：不过就别往下走 ----
      - name: 校验 tag 与版本文件一致（tag 触发时）
        if: startsWith(github.ref, 'refs/tags/')
        run: |
          set -eu
          TAG="${GITHUB_REF_NAME#v}"
          VER="$(node -p "require('./<VERSION_FILE>').ver")"
          echo "tag=$TAG ver=$VER"
          [ "$TAG" = "$VER" ] || { echo "::error::tag 与版本文件不一致"; exit 1; }

      - name: 确认 tag 在主线历史里（tag 触发时）
        if: startsWith(github.ref, 'refs/tags/')
        run: |
          set -eu
          # 坑：tag 检出是 detached HEAD，`git fetch origin main` 只写 FETCH_HEAD，
          # 不会创建 origin/main 引用，`git rev-parse origin/main` 会直接报错把发布干红。
          MAIN_SHA="$(git ls-remote origin refs/heads/main | cut -f1)"
          [ -n "$MAIN_SHA" ] || { echo "::error::取不到主线 sha"; exit 1; }
          git merge-base --is-ancestor HEAD "$MAIN_SHA" \
            || { echo "::error::tag 不在主线历史里"; exit 1; }

      - run: npm test                      # 单测

      - run: npm run build                 # 类型检查 + 构建到 <BUILD_DIR>（含 SW 预缓存注入）

      - uses: actions/upload-pages-artifact@v3
        with: { path: <BUILD_DIR> }

  # 端到端：独立 job。稳定后作为发布门禁；抖动期可以先摘出（见下方说明）
  e2e:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with: { node-version: '20', cache: npm }
      - run: npm ci
      - run: npm run build                 # e2e 跑的是产物，必须先构建
      - run: npx playwright install --with-deps chromium
      - run: npx playwright test --retries=1
      - if: failure()
        uses: actions/upload-artifact@v5
        with: { name: playwright-report, path: playwright-report, if-no-files-found: warn }

  deploy:
    needs: [build, e2e]                    # 想让 e2e 不卡发布：改成 needs: build
    if: startsWith(github.ref, 'refs/tags/') || github.event_name == 'workflow_dispatch'
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

---

## 4. 容易踩的点

| 现象 | 根因 | 处理 |
|---|---|---|
| 发布红在「确认 tag 在主线上」 | tag 是 detached HEAD，`git fetch origin main` 不创建 `origin/main` | 用 `git ls-remote` 取主线 sha，再 `git merge-base --is-ancestor` |
| 打完 tag 又推了一条文档提交，发布失败 | 校验写成了「tag == 主线顶端」 | 改成「tag 在主线历史里」（祖先判定） |
| push 到主线也触发部署 | `deploy` 没加 `if` | 加 `if: startsWith(github.ref,'refs/tags/') \|\| github.event_name=='workflow_dispatch'` |
| 每次发版跑两遍 e2e（主线一次 + tag 一次） | e2e 没加 job 级 `if` | 给 e2e 加同样的 `if`，主线只跑单测+构建 |
| 部署成功但线上还是旧版 | Pages CDN 传播延迟（约 1 分钟）；或旧的 branch 部署缓存 | 等 1 分钟再查；确认 Source 已是 GitHub Actions |
| 断网打不开 | 预缓存清单里没有新产物（分 chunk 后尤其容易漏） | 预缓存由构建脚本扫产物目录生成，必须跑正式 build；**字体/图片也要单独纳入清单** |
| 每次 run 都刷 Node 20 弃用警告 | 部分 action 仍指向 node20 | `checkout` / `setup-node` / `upload-artifact` 升 v5；`upload-pages-artifact`、`deploy-pages` 暂无 v5，可忽略 |
| 想手动验证但不想发版 | 只有 tag 才跑 e2e | 加 `workflow_dispatch`，Actions 页面点「Run workflow」（手机 App 不支持，要用浏览器） |

---

## 5. 日常发布流程（迁移后）

```bash
# 1) 本地自测（产物仍生成本地 docs/）
npm test && npm run build

# 2) 改版本 + 构建号（由项目自己的 stamp 脚本统一写）
node tools/stamp.js --bump patch --note "本次改了什么"

# 3) 提交 + 打 tag（tag 名必须与版本文件一致）
git add -A && git commit -m "发布 vX.Y.Z"
git tag vX.Y.Z && git push && git push origin vX.Y.Z
```

CI 会：校验版本 → 单测 → 构建 → e2e → 部署。任何一步红都不部署，线上保持上一次全绿的产物。

---

## 6. 发布后冒烟清单（不是看 HTTP 200）

- [ ] 线上版本文件是新版本与新构建号
- [ ] 线上 `index.html` 引用的所有 chunk 都 200（**分 chunk 后不止一个 js**）
- [ ] `sw.js` 的预缓存清单含最新产物（含字体等静态资源），缓存名里的构建号已更新
- [ ] PWA：断网 reload 后界面在、存档在、更新提示不误弹
- [ ] 0 条 `pageerror`

---

## 7. 可选：如果仍想保留 e2e 门禁但怕抖动

先把它摘成「并行 job + `needs: build` 才部署」，连续绿几次后，再把 `deploy.needs` 改回 `[build, e2e]` 收回门禁。这样做的好处是：抖动期不卡版本，但 e2e 的失败仍然会在 run 列表里标红、并留下 Playwright 报告，不会被悄悄忽略。
