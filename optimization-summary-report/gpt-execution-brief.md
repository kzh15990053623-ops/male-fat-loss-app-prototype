# 稳减 · 私人健康手账 — GPT 执行简报

> **文档用途**：本文档面向接手本仓库后续任务的 AI 执行者（GPT）。请先通读第 1–6 节建立完整上下文，**严格遵守第 3 节红线约束**，然后按第 7 节的任务规格逐项执行，每完成一项对照第 10 节验收清单自检。
> **生成时间**：2026-08-29｜**基线状态**：全部质量门禁绿色（详见第 5 节）

---

## 1. 项目身份卡

| 项 | 内容 |
|----|------|
| 产品 | 稳减 · 私人健康手账（男性减脂 PWA）：体重/腰围趋势、饮食记录、训练计划、数据图表、AI 食物营养识别 |
| 包名 / 版本 | `male-fat-loss-app-prototype` v0.1.0（private） |
| 前端形态 | **无框架、无打包、无运行时依赖**的渐进式 ES Module（ES2024），21 个 `src/*.js` 模块 + 分层 CSS + 自托管字体 |
| 后端形态 | Node 22 原生 `node:http`（`server.mjs` + `server/*.mjs`），零框架 |
| 数据层 | Supabase（Postgres + Auth + RLS）为主，本机账号模式（scrypt）为兜底；状态存 `app_states` 表（`state`/`meals` jsonb） |
| 部署 | Render 单实例（`render.yaml`），HTTPS + HSTS |
| 测试 | Vitest 4（单测）+ Playwright 1.62（E2E/DOM/a11y/视觉回归）+ ESLint 10（flat config）+ Prettier 3（printWidth 140） |
| 开发环境 | Windows + Node 22；仓库内无 git 元数据供查询，命令一律走 npm scripts |

**环境变量**（见 `.env.example`）：`PORT`、`SUPABASE_URL`、`SUPABASE_ANON_KEY`、`SUPABASE_SERVICE_ROLE_KEY`（仅云端注销需要）、`LOCAL_AUTH_ENABLED`、`LOCAL_AUTH_DATA_PATH`、`NUTRITION_AI_ENDPOINT/API_KEY/MODEL`。

**API 面**：`/api/health`、`/api/readiness`、`/api/auth/{signup,login,refresh,logout,user,account}`、`/api/state`（GET/PUT/POST/DELETE）、`/api/ai/nutrition`。

---

## 2. 仓库地图

```
index.html              入口 HTML：modulepreload 清单（与 src 模块集合精确一致）、CSP、字体
sw.js                   Service Worker：APP_SHELL 逐文件清单 + CACHE_NAME（当前 v15）
manifest.webmanifest    PWA 清单
server.mjs              HTTP 服务器入口；URL 解析在异常边界内（非法 request-target → 400）
server/
  config.mjs            环境变量与常量（含 MAX_JSON_BODY_BYTES）
  http.mjs              响应头/CSP/HSTS/Cookie 工具
  api.mjs               全部 API 路由 + readJsonBody（Buffer 累计 + 字节限制）
  data.mjs              normalize/sanitize/stateRevision（乐观并发版本号提取）
  supabase.mjs          Supabase REST 封装；writeAppState 为条件 PATCH（CAS）
  local-auth.mjs        本机账号模式：scrypt（cost 块 + maxmem）、mutateStore 原子写
  rate-limit.mjs        滑动窗口限流（CF-Connecting-IP + 桶容量硬顶）
  static.mjs            静态服务：异步 stat、Brotli（params[BROTLI_PARAM_QUALITY]=5）/gzip、ETag 变体
  nutrition.mjs         AI 营养识别上游调用
src/
  app.js                入口模块
  app-state.js          状态容器 + runtime
  app-data.js           数据模型 / 迁移链 / 按天合并 mergePayloads
  app-storage.js        localStorage 封装
  app-sync.js           同步编排：409 冲突 → 按天合并 → 携新版本号重试一次
  app-logic.js          纯逻辑（热量口径、进度计算）
  app-render.js         外壳 + 弹层 + facade
  render/shared.js      跨页共享组件；render/pages/*.js 五个页面模块
  app-actions.js        入口 + 事件路由层（click/submit/input/change 四张路由表，仅 448 行）
  actions/services.js   跨域 UI 服务（render/showToast/焦点管理/图表/庆祝，render() 在此）
  actions/{meal,auth,settings,training,home}.js  五个业务域
  app-utils.js          工具（escapeHtml 等）
scripts/
  run-gates.mjs         `npm run check` 单入口：语法(自动发现)/validate×5/vitest/eslint/prettier 并行，回归门禁串行
  app-regression-checks.mjs  回归门禁（本地起服，五个检查组，见第 7 节任务 B）
  bump-version.mjs      版本戳一键写入（默认 YYYYMMDD-N 或 --shell <v>）+ 自校验
  validate-*.mjs        五个静态校验脚本
tests/
  unit/                 vitest 4 文件 75 用例
  dom/ e2e/ a11y/       Playwright 非视觉 44 用例
  visual/               Playwright 视觉基线 11 张截图断言
  helpers/app-fixture.mjs  测试夹具（固定时钟、种子状态）
supabase/migrations/    app_states 建表（user_id 外键 ON DELETE CASCADE）
.github/workflows/verify.yml  CI：node-check 与 playwright 双并行 job
docs/                   历史文档（已标注"历史快照"）+ optimization-review-20260825.md（权威进度）
optimization-summary-report/  五批改造总结报告（生成物，不参与 lint）
```

---

## 3. 红线约束（违反 = 门禁失败或线上事故）

**渲染与安全**
1. 所有 HTML 属性插值（`data-*`/`value`/`placeholder` 等）必须经 `escapeHtml()` 转义——回归门禁有状态机扫描 7 个 markup 文件。
2. **禁止任何 `style="..."` 内联样式属性**。CSP `style-src` 无 `'unsafe-inline'`。动态值走"转义后的 `data-*` 属性 → `hydrateDynamicStyles(root)` 写 CSS 自定义属性 → CSS 规则 `calc(var(--x, 0) * 1%)` 消费"。`render()` 每条路径都要调用水合。
3. CSP 响应头不得引入 `unsafe-inline`；HSTS 仅在 `x-forwarded-proto: https` 链路返回。

**服务端**
4. 静态服务只用异步 IO（`fs.promises.stat`），禁止 `statSync/existsSync`。
5. Brotli 质量参数必须走 `params[constants.BROTLI_PARAM_QUALITY]`（顶层 `quality` 是 deflate 系选项，会被静默忽略）；`Accept-Encoding` 协商必须解析 q 值，`br;q=0` 表示拒绝 Brotli。
6. **共享状态写入必须走乐观并发**：`state` JSON 内嵌 `syncRevision`（服务端分配）；Supabase 用条件 PATCH（`state->>syncRevision=eq.<当前值>`，遗留行用 `is.null` 钉住），local-auth 在 `mutateStore` 内校验；版本不符返回 409 `STATE_CONFLICT` 且 `error.conflict` 携带服务端当前 payload，客户端按天合并后重试一次。**禁止退回整包无条件覆盖**。
7. `readJsonBody` 必须累计 Buffer、按网络字节计数限额、末尾统一 UTF-8 解码（逐块字符串拼接会打碎跨块汉字）。
8. 限流取客户端 IP **只信 `CF-Connecting-IP`**（Render 边缘覆盖写入），永不采信 `X-Forwarded-For` 最左值（调用方可伪造）；回退 `request.socket.remoteAddress`。
9. 云端注销**只删 Supabase Auth 用户**，`app_states` 行由 `ON DELETE CASCADE` 原子清除；未配置 service role key 时 fail-fast 503。禁止先删数据后删账号。
10. `new URL(request.url)` 必须在请求异常边界内（`GET http://[ HTTP/1.1` 这类畸形目标要返回 400，不能崩进程）。
11. scrypt 显式参数（N=32768/r=8/p=1 + maxmem≥64MB），新记录存 cost 块，老记录按存储参数回验。
12. 限流为进程内存实现，前提是单实例部署（render.yaml/README 已标注）；横向扩容前必须先迁共享存储。

**前端工程**
13. `index.html` 的 modulepreload 清单必须与 `src/*.js` 模块集合**精确一致**：入口 URL 与 script 标签逐字符相同，依赖模块用无版本 URL；`sw.js` APP_SHELL 同步登记且 CACHE_NAME 递增。**新增 src 模块需四处登记**：index.html、sw.js、`scripts/app-regression-checks.mjs` 的 `frontendFiles`（约 426 行）、（语法检查已自动发现，无需登记）。
14. 版本戳只允许 `npm run bump:version` 修改，**永不手改**（当前 shell 版本 `20260829-1`，CACHE_NAME `v15`）。
15. `render()` 同标签页无弹层的数据变化短路走 `patchCurrentPage()`（基线比对可跳过未变页面的重建，重建时恢复焦点与光标）；结构性变化（切页/弹层/认证分支）走全量 `root.innerHTML = appShell()`。事件委托只在 `initApp()` 绑定一次。
16. 事件路由表项以 `run(control, event)` 调用——**直接引用带默认参数的函数会被元素对象覆盖首参**，必须包 `() => fn()` 或显式箭头。
17. ESLint globals 分治：src/sw 用 browser+serviceworker，server/scripts 用 node，tests 两者都要（`page.evaluate` 回调在浏览器执行）。ESLint/Prettier 忽略清单已含 `optimization-summary-report/`、`docs/`、`supabase/`。

---

## 4. 命令速查

```bash
npm run dev                # 本地起服 http://localhost:5173（node server.mjs，PORT 可覆盖）
npm run check              # 全部门禁（六阶段：语法 58 文件 / validate×5 / vitest / eslint / prettier / 回归门禁）
npm run test:unit          # vitest 75 用例
npm run test:e2e           # Playwright 55 用例（含 11 视觉基线；自动起本地服 + 假 Supabase 配置）
npm run test:e2e:update    # 重新生成视觉基线（须有意为之，改完人工核对 diff）
npm run lint               # eslint .
npm run format             # prettier --write .
npm run bump:version       # 版本发布（或 npm run bump:version -- --shell 20260830-1）
npm run verify             # check + test:e2e 全量验证
```

**run-gates 的实现约束**：所有工具通过 `node_modules` 内 node 入口直跑（vitest.mjs / eslint bin / prettier cjs），**不走 npx、不依赖 shell**——新增脚本必须保持这一写法（Windows 兼容）。

---

## 5. 当前质量基线（2026-08-29 实测）

| 层 | 规模 | 状态 |
|----|------|------|
| vitest 单测 | 75 用例（app-logic 32 / app-sync 32 / server-json-body 4 / server-state-conflict 7） | ✅ 75/75 |
| Playwright 非视觉 | 44 用例（a11y 8 / dom 32 / e2e 4 / pwa 1） | ✅ 44/44 |
| Playwright 视觉基线 | 11 张（9 个 390px 场景 + 320px 首页 + 430px 饮食首屏） | ✅ 全部一致 |
| 语法检查 | 58 个 JS 文件（目录自动发现） | ✅ |
| 静态校验 | 5 个 validate 脚本 | ✅ |
| ESLint / Prettier | 全仓 | ✅ 0 错误 |
| 回归门禁 | 本地起服运行时断言（安全头/压缩/转义/CSP/manifest/raw-socket） | ✅ |
| **合计** | **130 项自动化检查** | **全绿** |

架构现状：`app-actions.js` 从 1892 行收敛到 448 行（入口+路由层），21 个前端模块中非空最大 603 行。

---

## 6. 背景速览（为什么长这样）

本项目经**五批连续改造 + 一轮外部复审修正**达到当前状态：

1. **第一批 安全加固**：属性转义统一 + 门禁、HSTS、CSP 移除 unsafe-inline（data-* + CSSOM 水合）、限流有界清理、scrypt 提参。
2. **第二批 性能**：静态服务异步 IO、Brotli 压缩（带 ETag 变体）、modulepreload 消除模块加载瀑布。
3. **第三批 渲染局部化**：`render()` 按页短路 + 页面基线比对跳过无关重建 + 焦点/光标恢复（keyed diff 经评估刻意不采用）。
4. **第四批 架构拆分**：渲染层按页拆分、四张事件路由表、actions 按域拆分、sync 三分（data/storage/编排）。
5. **第五批 工程化**：ESLint + Prettier、CI 双并行 job + 浏览器缓存、版本一键发布、`check` 收敛单入口、文档口径统一。
6. **复审修正轮**：外部评审退回 9 项（1 P0 + 5 P1 + 3 P2）已全部闭环——并发同步丢数据（乐观并发）、URL 解析崩溃、JSON 分块中文损坏、限流 XFF 伪造、注销顺序、门禁恢复、Brotli 参数与 q=0 协商、CI 工件路径、脚本确定性。

权威文档（冲突时以此为准）：`README.md`（命令/部署/发布/CI）、`docs/optimization-review-20260825.md`（架构决策与实施进度）、`optimization-summary-report/optimization-summary-report.md`（五批+复审总结）。

---

## 7. 待执行任务清单

> 按优先级排序。每个任务独立成批：改完即跑 `npm run check`，收尾跑 `npm run verify`，全绿才算完成。

### 任务 A（高）：vitest 覆盖率接入

**目标**：量化单测盲区，为后续补测提供依据。

**步骤**：
1. `npm install -D @vitest/coverage-v8`（版本须与 vitest ^4.1.11 同大版本）。
2. `package.json` 增加 script：`"test:coverage": "vitest run --coverage"`。
3. `vitest.config.mjs` 增加 coverage 配置：
   - `provider: "v8"`；
   - include 只放**纯逻辑层**：`src/app-logic.js`、`src/app-data.js`、`src/app-storage.js`、`src/app-sync.js`、`server/**/*.mjs`；
   - **不要**把 render/actions 等 DOM 型模块纳入阈值——它们由 Playwright 覆盖，node 环境单测不了；
   - thresholds 先跑一次拿实测基线再定（如 lines 80 起步），不要拍脑袋设 100。
4. README「可用命令」节补充 `test:coverage`。

**验收**：`npm run test:coverage` 产出报告且达标；`npm run check` 全绿；README 已更新。
**禁区**：不许为凑覆盖率改产品代码；不许把 DOM 模块塞进阈值。

### 任务 B（中）：源码模式门禁迁移为 ESLint 规则

**目标**：让"读源码做正则断言"的门禁在 lint 阶段以 file:line 精确报错，替代门禁尾部的聚合输出。

**现状**：`scripts/app-regression-checks.mjs` 有五个检查组——
- `checkStaticSecurity`（运行时：安全头/HSTS/CSP/压缩/raw-socket 畸形请求）→ **不可迁移**
- `checkAttributeEscapingGate`（403 行起：状态机扫描 7 个 markup 文件的未转义属性插值）→ **可迁移**
- `checkFrontendSourceGuards`（425 行起：源码模式断言 + modulepreload/sw manifest 一致性 + CSS 守卫）→ **部分可迁移**
- `checkFrontendModuleRuntime` / `checkServerNormalization`（运行时/归一化）→ **不可迁移**

**步骤**：
1. 在 `eslint.config.mjs` 内用 flat config 直接内联本地规则（无需发 eslint-plugin 包）。优先迁移三条：① 禁 `style="` 内联样式（限 markup 文件）；② 属性插值必须经 `escapeHtml()`（状态机逻辑照搬）；③ 其余纯 `doesNotMatch` 模式断言逐条评估，值得保留的迁为规则。
2. manifest 一致性检查（modulepreload 与 src 集合精确匹配、sw APP_SHELL、CACHE_NAME 格式）**不建议塞进 ESLint**——抽成 `scripts/validate-frontend-manifest.mjs`，登记进 `run-gates.mjs` 的 `validateScripts` 并行池。
3. 从 `app-regression-checks.mjs` 删除已迁移断言，保留全部运行时断言。
4. 自验：在 `src/render/pages/home.js` 临时插一行 `style="color:red"`，确认 `npm run lint` 报错且 file:line 准确，随后还原。

**验收**：注入违规 → lint 失败并给出准确位置；还原 → `npm run check` 全绿；同一规则只有一处生效（无双重执行漂移）。
**禁区**：运行时断言（安全头/压缩协商/raw-socket/CSP 响应头）必须留在回归脚本；不改变 ESLint flat config 的三环境 globals 结构。

### 任务 C（中低）：CI Playwright 浏览器缓存预热

**目标**：避免 main 分支长期无 PR 时 `~/.cache/ms-playwright` 缓存过期，导致冷缓存 PR 变慢。

**步骤**：
1. 新增 `.github/workflows/warm-cache.yml`：`schedule` cron 每周触发（如 `0 20 * * 1` UTC）+ `workflow_dispatch` 手动入口。
2. 缓存配置**完全复用** `verify.yml` 的 key 公式：`${{ runner.os }}-playwright-${{ hashFiles('package-lock.json') }}`（restore-keys 前缀兜底），步骤为 checkout → setup-node → `npm ci` → `npx playwright install --with-deps chromium`，确保 save 发生。
3. 加 `concurrency` 防与 verify 重叠。

**验收**：YAML 合法；推送后 `workflow_dispatch` 可手动跑通一次；不改动 `verify.yml` 既有缓存 key（改公式会一次性全量 miss）。

### 任务 D（低，评估型）：bundle 收益复评

**目标**：用实测数据决定是否引入 esbuild 打包，**只做评估不实施**。

**步骤**：
1. 基线测量：`node server.mjs` 起服后，统计冷加载请求数（HTML + 21 个模块 + CSS + 字体）、各资源 Brotli 后字节数（`curl -H "Accept-Encoding: br"`）、模块 import 链瀑布深度。
2. 原型对比：esbuild 产出单 bundle（独立评估脚本，不接入 serving），对比总字节与请求数；评估 HTTP/2 下多请求的真实开销（modulepreload 已消除瀑布）。
3. 产出 `docs/bundle-evaluation-20260829.md`：实测数字 + 明确建议（保留 no-bundle / 引入打包 / 混合方案）。

**约束提示**：现有门禁大量假设"逐文件"——modulepreload 精确匹配、sw APP_SHELL 逐文件、ETag/压缩按文件、回归 frontendFiles 清单。切换 bundle 是全链路改动，故本任务止步于决策文档。
**验收**：文档含实测数字与明确建议；不改动任何 src/静态服务代码。

---

## 8. 执行工作流约定

- **批次纪律**：一个任务一个批次，全量门禁绿色后才进入下一个；不携带已知缺陷前进。
- **测试先行**：涉及重构的任务，先确认现有 130 项检查覆盖对应行为，再动代码；新增行为必须沉淀为新的自动检查。
- **文档同步**：任务完成后更新 `docs/optimization-review-20260825.md` 的「实施进度」段与 README 相关节；报告类数字必须来自实际运行输出，不得手工推算。
- **提交信息**：中文，聚焦"为什么"而非罗列文件。

---

## 9. 已知坑与环境注意

1. `tests/dom/sync-status.spec.mjs` 时序敏感：700ms PUT 延迟窗口是 4-worker 并行下防 flake 的，**不要删**。
2. 视觉测试新增弹层场景必须钉死入场动画（`el.style.animation = "none"`），settings 基线当初就是这么修的。
3. `app-regression-checks.mjs` 偶发 "Timed out waiting for local server"（6 秒启动窗）：先单独重跑 `node scripts/app-regression-checks.mjs` 再判断是否真故障。
4. Playwright `webServer` 用假 Supabase 配置（`your-project-ref...`），**绝不能指向真实 Supabase 项目**；测试依赖假时钟夹具（`FIXED_NOW = 2026-08-09`）。
5. Windows + PowerShell 环境：脚本内禁止 `&&` 链与 npx 依赖；`run-gates.mjs` 的"spawn node 入口"写法是刻意为之，保持一致。
6. `optimization-summary-report/`、`docs/`、`supabase/` 是生成物/文档/迁移目录，已在 ESLint/Prettier 忽略清单——不要移除这些忽略项。
7. 单实例部署假设贯穿限流与内存缓存设计（render.yaml/README 已标注）；任何多实例化改动前先迁共享存储。

---

## 10. 总验收清单

每个任务完成时逐项自检：

- [ ] `npm run check` 六阶段全绿（语法 58 / validate 5 / vitest / eslint / prettier / 回归门禁）
- [ ] `npm run test:e2e` 55/55（含 11 项视觉基线一致）
- [ ] 视觉基线如被重生成，diff 已人工核对且是有意变更
- [ ] 新增能力已沉淀为对应的自动检查（测试/校验脚本/lint 规则之一）
- [ ] 新增 src 模块已完成四处登记（index.html modulepreload / sw.js APP_SHELL + CACHE_NAME / 回归 frontendFiles）
- [ ] 版本戳仅经 `npm run bump:version` 变更（如任务涉及发布）
- [ ] 文档已同步（README / optimization-review-20260825.md 实施进度）
- [ ] 最终以 `npm run verify` 收尾确认

---

**一句话指令**：按第 7 节顺序执行任务 A→B→C→D；任何改动不得触碰第 3 节红线；每个任务以第 10 节清单自检后才算交付。
