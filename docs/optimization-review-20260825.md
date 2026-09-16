# 项目优化方案（2026-08-25 审阅结论）

> 历史快照：以下状态、数量与 CI 说明仅反映各段注明的历史日期，不代表当前项目。当前使用与验收方式以 [README](../README.md) 和实际命令、对应提交的 CI 结果为准。

> 本文档为审阅结论与优化建议。所有关键结论均已在源码中逐条核实，行号以审阅时工作区为准。
>
> **实施进度**：P0 安全节全部完成——第一批（1.1 属性转义统一 + 门禁、1.2 HSTS）、第二批（2.2 静态服务异步 IO、2.3 Brotli 压缩、2.4 modulepreload）、第三批 2.1 第一步与第二步（按页短路局部渲染 + 页面基线比对跳过无关重建 + 焦点/光标恢复，keyed diff 第三步经评估关闭）、4.1（vitest 单测 64 用例接入 check 链）、1.4（限流单实例标注于 render.yaml/README + 超限清理改为 64 桶有界惰性扫描）、1.5（scrypt 显式提参 N=2^15/r=8/p=1 + maxmem 64MB，实测中位 81ms；新记录存储 cost 块，老记录按 Node 默认参数回验）、1.3（7 处内联 style 改 data-* + `hydrateDynamicStyles()` CSSOM 水合，CSS 规则改用 `calc(var(--x) * 1%)` 取值，CSP `style-src` 移除 `'unsafe-inline'`，门禁新增内联样式/水合接线/CSP 三条断言）。期间定位并修复了 settings 视觉用例的入场动画/截图竞态（预先存在的 flaky）。第四批（3.1-3.4 架构拆分）完成——3.1 渲染层只消费 state；3.2 巨型文件拆分（a. click/submit/input/change 四张事件路由表查表分发；b. render 拆为 `render/shared.js` + `render/pages/` 五页模块，`app-render.js` 收敛为外壳+弹层+facade；c. actions 拆为 `actions/services.js` 跨域 UI 服务 + meal/auth/settings/training/home 五个业务域，`app-actions.js` 收敛为入口+事件路由层，事件绑定改为 `initApp()` 一次性挂载，click 路由表化同时消除了 16 处"函数定义与分支内联体重复"的旧残留——其中 13 个成为路由表处理器，3 个守卫包装因仅一行守卫逻辑直接内联进表项删除）；3.3 重复模式收敛；3.4 `app-sync.js` 拆出 `app-data.js`（数据模型/迁移/合并）与 `app-storage.js`（localStorage 封装），主文件收敛为同步编排。四处清单（index.html modulepreload、sw.js APP_SHELL v13、package.json check、回归门禁 frontendFiles）同步登记；期间修复路由表一处首参误传（`cancelMealNutrition` 收到控件元素覆盖默认 message）。验证：`npm run check` 全绿、e2e 54/54（含 9 项视觉基线，确认像素级等价）。第五批（4.2-4.6 工程化）完成——4.2 ESLint flat config（浏览器/Node/SW 三环境 globals 分治，tests 声明 browser globals 因 evaluate 回调实际在浏览器执行）+ Prettier，存量清零（删 3 处真实未用导入、修 1 处正则转义、`ignoreRestSiblings` 豁免 app-data 解构剔除模式），52 文件全量格式化；4.5 `check` 收敛为 `scripts/run-gates.mjs` 单入口（语法检查按目录自动发现 56 文件，validate 五脚本并行，vitest/eslint/prettier 并行，回归门禁串行收尾），新增 `lint`/`format` scripts；4.4 `scripts/bump-version.mjs` 一键更新全部版本戳（默认日期序号或 `--shell` 指定，CACHE_NAME 递增，写后自动过 validate-version-sync），实测 20260822-1→20260828-1 / v13→v14；4.3 CI 拆双并行 job（node-check 无浏览器 / playwright E2E）+ `~/.cache/ms-playwright` 按 lock 哈希缓存 + 失败上传报告工件；4.6 六份历史文档顶部加"历史快照"标注指向 README 权威口径，README 更新命令/发布/CI 三节。**复审修正轮（2026-08-29）**：五批收官后经独立复审退回，9 项发现全部闭环——P0 并发同步静默丢数据（引入 `syncRevision` 乐观并发：Supabase 条件 PATCH、local-auth mutateStore 内校验、409 携带服务端 payload 客户端按天合并重试）；P1×5（URL 解析移入异常边界 + raw-socket 回归、JSON 改 Buffer 累计按字节限流、限流采信 CF-Connecting-IP、注销只删 Auth 用户依赖级联、eslint/prettier 忽略报告目录恢复全量门禁）；P2×3（Brotli `params[BROTLI_PARAM_QUALITY]` + q=0 协商、CI 工件路径与 HTML reporter、run-gates 结果索引对齐 + bump-version NaN 防护）。新增 11 个单测与 1 个 409 冲突 E2E，最终 130 项自动化检查全绿（vitest 75/75、E2E 55/55 含 11 视觉基线）。

## 2026-08-30 至 08-31 · 后续工程化与同步安全收口（历史口径）

> 本节是截至 2026-08-31 的实施快照，覆盖上方截至 2026-08-29 的“130 项”历史口径；下方原始审阅正文保留用于追溯当时的问题与决策。

- **Phase 0 同步安全**：持久化序列化不再自行制造时间戳；业务数据指纹相同的保存是严格 no-op，只有真实业务变更才推进每日记录时间与本地 mutation token。同步改为单 Promise 串行排空，写入期间发生的新变更必须进入下一轮 PUT。首次真实编辑时把最后确认的服务端快照作为本地 `syncBase` 与工作副本原子持久化；409 以 base/local/remote 做字段级三方合并，日记录与日志按日期、餐次/活动/模板按稳定 ID 合并，删除优先避免复活。缺少可信基线时停止自动覆盖；服务端确认必须同时包含有效 `revision` 与 `updatedAt`，否则保持待同步状态。
- **严格乐观并发**：Supabase 与本机账号首次写入也纳入 CAS；缺失版本以 409 `STATE_REVISION_REQUIRED` 拒绝，非法版本以 400 拒绝，过期或竞争写入以 409 `STATE_CONFLICT` 返回当前载荷。客户端按天合并后只重试一次。
- **防复活清空**：`DELETE /api/state` 固定返回 405；应用清空改为带客户端请求标记与 `revision` 的 PUT 墓碑，服务端以自己的时钟签发权威 `clearedAt`。本地保留最小墓碑和观测到的基础版本，离线时禁止假清空；普通同步或 409 冲突遇到远端墓碑时不得把旧数据按天合并复活，只有明确基于该墓碑版本产生的新修改才可继续上传。
- **静态协议语义**：`Accept-Encoding` 完整解析 q 值、通配符及 identity 拒绝；小型文本在 identity 被拒绝时仍可选择可接受的 `br`/`gzip`，不可编码资源在 identity 被拒绝时返回 406。ETag 由实际内容 SHA-256 摘要与 `br`/`gzip`/`identity` 表示共同生成，所有静态资源的 200/304/406 均带 `Vary: Accept-Encoding`，`If-None-Match` 支持列表、`*` 与 GET 弱比较。
- **覆盖率持续门禁**：`npm run check` 直接运行 `vitest --coverage`，`autoUpdate: false`，阈值不会自行下调；`npm run test:coverage` 可独立生成 text/HTML/JSON 报告。DOM 依赖模块继续由 Playwright 覆盖，不为凑数字塞入 Node 覆盖率。
- **HTML 安全规则收敛**：内联 style 与未转义/动态 HTML 属性迁为两个本地 ESLint 规则，含 12 个规则级测试；运行时安全头、压缩、CSP 与 raw-socket 检查仍保留在回归门禁，避免把协议验证误迁到 lint。
- **前端清单自动校验**：第六个 validator 自动发现 `src/**/*.js`，严格核对 `index.html` modulepreload 与 `sw.js` APP_SHELL，含 5 个解析器回归测试。清单仍为显式声明，但漏登记、重复项、陈旧项及注释伪装都会被门禁拦截；语法检查与回归扫描无需人工登记。
- **CI 状态纠偏**：`.github/workflows/verify.yml` 当前只是未跟踪、未推送的本地候选，尚无远端 Actions 或缓存命中证据，不能视为已启用；缓存预热延期到工作流获准提交并首次跑通之后。
- **bundle 复评**：仅做本机原型和量化，不接入生产 serving、不修改 `src`/`package-lock.json`。结论与局限见 [bundle 收益复评（2026-08-30）](./bundle-evaluation-20260830.md)。

覆盖率阈值（statements / branches / functions / lines）锁定为当前可复现基线下限，并非最终质量目标：

| 范围 | 阈值 |
| --- | --- |
| 全局 | 56.78 / 50.07 / 61.14 / 59.17 |
| `src/app-data.js` | 94.61 / 82.84 / 96.87 / 96.78 |
| `src/app-logic.js` | 48.80 / 52.26 / 60.29 / 52.23 |
| `src/app-storage.js` | 86.07 / 62.22 / 86.66 / 88.23 |
| `src/app-sync.js` | 64.04 / 52.66 / 61.76 / 67.17 |
| `server/**/*.mjs` 聚合 | 41.22 / 34.26 / 45.56 / 43.77 |

最新验证口径为 **208 项自动化测试用例**：Vitest 149 项（10 个文件）+ Playwright 59 项（非视觉 48、视觉基线 11）；另有 67 个 JS/MJS 文件语法检查、6 个静态校验，以及 ESLint、Prettier、运行时回归门禁。同步高风险组额外以单 worker 重复 10 轮，100/100 通过；重复轮次不重复计入 208。最终状态以本节收口后的连续完整验证为准。

## 总体评价

项目基础质量高于同类原型：认证链路完整（HttpOnly Cookie 刷新、服务端会话吊销）、RLS 用户隔离、离线同步按天合并、原子文件写入（tmp+rename）、门禁脚本覆盖数据模型/AI 契约/版本同步，工程意识很强。

当前的主要短板集中在四处：

1. **前端渲染层**：每次状态变化全量 `root.innerHTML = appShell()` 重建 DOM，且 HTML 属性插值转义不一致，存在 XSS 面与性能双重问题。
2. **后端静态服务**：同步文件 IO 阻塞事件循环，只支持 gzip 不支持 Brotli。
3. **代码组织**：`app-render.js`（约 2000 行）与 `app-actions.js`（约 1750 行）两个巨型文件，内部重复模式多、事件分发线性 if-else。
4. **工程化**：无单测框架、无 Linter、CI 无浏览器缓存、版本号三处手动同步。

---

## 一、P0 · 安全加固（建议最先做）

### 1.1 HTML 属性插值转义不一致（XSS 面）

- **位置**：`src/app-render.js` 全文件；注入点 `src/app-actions.js:1702`（`root.innerHTML = appShell()`）
- **现状**：文本节点普遍调用 `escapeHtml()`（全文件 51 处），但 `data-*` 属性、`value`、`placeholder`、`aria-label` 等属性插值大量未转义，例如：
  - `data-diet-scenario="${item.id}"`、`data-field-name="${key}"`（render.js 第 44、132 行附近）
  - 部分动态 value/placeholder 拼接（第 124-163、648-664、1041-1069 行附近）
- **风险**：当前多数值来自内部状态，但餐名、模板名等用户输入派生值一旦流入未转义插值点，即可注入属性（`" onmouseover=...`）。转义口径不统一意味着每次新增插值都是一次风险决策。
- **方案**：
  1. 在 `app-utils.js` 新增 `safeAttr()` / `safeDataset()`（转义 `"`、`<`、`&` 等），全量替换属性插值；
  2. 在 `scripts/app-regression-checks.mjs` 增加静态门禁：正则扫描 render 文件中未包 `escapeHtml/safeAttr` 的 `${...}` 属性插值，发现即失败；
  3. 中期将纯动态文本（餐名、错误提示）改为 `textContent` 写入，结构性模板保留字符串拼接。

### 1.2 缺少 HSTS 响应头

- **位置**：`server/http.mjs:2-21`（`baseHeaders()`）
- **现状**：已有 CSP、Permissions-Policy、nosniff、XFO、Referrer-Policy，但无 `Strict-Transport-Security`。
- **方案**：生产环境（HTTPS 判定成立时）返回 `Strict-Transport-Security: max-age=63072000; includeSubDomains`；本地 HTTP 开发环境不返回。

### 1.3 CSP `style-src 'unsafe-inline'`

- **位置**：`server/http.mjs:8`
- **方案**：✅ 已实施——排查结论：内联样式共 7 处（progress-ring `--progress`、mini/inline-progress `width`、baseline-progress `--baseline`、completion-row 与 mini-bars `height`、chart-point `--point-x/y`），全部经 `innerHTML` 注入。改造：渲染时写 `data-*` 属性（照常 `escapeHtml` 转义），`render()` 末尾统一调用 `hydrateDynamicStyles(root)` 经 CSSOM `setProperty` 写自定义属性；CSS 侧 `width/height` 规则改 `calc(var(--x, 0) * 1%)` 取值。CSP 已移除 `'unsafe-inline'`。门禁新增：前端源码禁 `style="` 插值、必须接线 `hydrateDynamicStyles(root)`、http.mjs 禁 `unsafe-inline`。图表 tooltip 的 `getPropertyValue("--point-x")` 读取不受影响（CSSOM 内联样式同样可读）。

### 1.4 内存型速率限制（条件性风险）

- **位置**：`server/rate-limit.mjs:3`（`const buckets = new Map()`）
- **现状**：进程内计数。单实例部署（当前 Render 配置）下功能正常；一旦水平扩容为多实例，限流形同虚设。
- **方案**：✅ 短期已实施——`render.yaml` 与 README 部署提醒均已标注"单实例假设"及多实例迁移路径；中期若需要多实例，改为 Supabase 表或 Redis 计数（按 IP+用户双维度）。
- **附带**：✅ 已实施——超限清理从全量遍历改为每请求最多清扫 64 个最旧桶的有界惰性扫描（`SWEEP_BATCH`），高峰期不再叠加整表扫描的 CPU 尖刺。

### 1.5 scrypt 成本参数处于最低线（低风险加固项）

- **位置**：`server/local-auth.mjs:46-54`
- **现状核实**：`scrypt(password, salt, 64)` 中 64 是输出密钥长度，成本参数使用 Node 默认（N=16384, r=8, p=1）。这是 OWASP 建议的最低可接受线，不算漏洞，但可加强。
- **方案**：✅ 已实施——显式传参 N=2^15、r=8、p=1 并显式 maxmem 64MB（N 提升后 128·N·r 恰好压在 Node 32MB 默认上限，必须同步放宽）；本机实测派生中位 81ms（默认参数 40ms），满足 <200ms 目标。兼容性：新记录在 `password` 块内存储 `cost` 参数，验证时按记录参数派生（带范围护栏防篡改存储请求病态参数）；老记录（无 cost 块）按 Node 默认参数回验，已验证可正常登录、错误密码正确拒绝。

---

## 二、P1 · 性能优化

### 2.1 全量 innerHTML 重渲染

- **位置**：`src/app-actions.js:1698-1706`
- **现状**：任何状态变化（输入、点击、同步回调）都触发 `root.innerHTML = appShell()`，五页全部重建。移动端低端机上输入场景（打字时逐键触发状态更新）会造成可感知卡顿；且全量重建使表单焦点、滚动位置需要额外恢复逻辑。
- **方案**（渐进式，三层递进）：
  1. **第一步（低风险）**：✅ 已实施——`app-render.js` 新增 `shellSignature()`（捕获加载/登录/引导分支、activeTab、pendingTabEnter、四个 overlay 开关）与 `patchCurrentPage()`（原地同步 toast、aria 公告并重建当前页内容），`app-actions.js` 的 `render()` 在签名一致时短路为局部替换，nav/骨架节点不再反复重建；overlay 打开期间与一切结构变化仍走全量渲染。输入路径（`handleAppInput`）经核实本就不触发渲染，第二步的"输入不重渲染"已天然满足；
  2. **第二步**：✅ 已实施——输入路径经核实本就不触发渲染（`handleAppInput` 只更新草稿不调用 `render()`，meal 表单 11 个控件逐键同步 `state.mealDraft`），因此第二步聚焦异步渲染对输入的打断：`patchCurrentPage()` 增加 `runtime.lastPageHtml` 基线比对，页面 HTML 未变（典型：toast 显示/清除、aria 公告更新）时跳过页面重建；确实重建时，先抓取正在输入的控件（`name`/`id`/`data-*` 选择器 + 选区），重建后恢复焦点与光标，草稿值由状态同步天然保留。新增 e2e 用例覆盖两个路径；
  3. **第三步（可选）**：引入极轻量的 keyed diff（自研 ~100 行或引入 uhtml/lit-html 单依赖），保持无构建架构不变。——评估结论：第二步落地后，页面重建只在内容真实变化时发生（用户动作频率，非逐键），单次成本为一次页面模板构建 + 解析（低端机约 1-3ms）；keyed diff 的边际收益不抵其对"渲染输出不变"保证的风险，建议关闭本项，待出现实测性能瓶颈再评估。
- **验收**：用现有 Playwright 三档视口 + 视觉回归基准兜底，确保重构不改变渲染输出。

### 2.2 静态文件服务同步 IO

- **位置**：`server/static.mjs:89,93`（`existsSync` + `statSync`）
- **现状**：每个静态请求都同步探测文件系统，高并发下阻塞事件循环（Node 单线程，所有 API 请求都会被卡住）。
- **方案**：改用 `fs.promises.stat`，ENOENT 即 404（`existsSync` 可直接去掉）；启动时可预热一次目录元数据缓存 ETag 用的 mtime/size。

### 2.3 压缩只支持 gzip

- **位置**：`server/static.mjs:3,47-49,122`
- **方案**：`Accept-Encoding` 含 `br` 时优先 `createBrotliCompression()`（质量级 5 即可），回退 gzip。CSS/JS 的 Brotli 比 gzip 通常再小 15-20%。项目当前 CSS 约 96KB、JS 约 200KB，收益直接。

### 2.4 模块加载瀑布（可选）

- **位置**：`index.html:18-19` + `src/app.js` 依赖链
- **现状**：无 bundle，浏览器需串行发现并下载约 15 个 ES Module（app.js → actions → render → logic/sync/state → utils），移动网络下首屏多轮往返。
- **方案**：短期在 `index.html` 加 `<link rel="modulepreload">` 列出全部模块，消除瀑布；长期若模块继续增长再评估轻量打包（esbuild 单依赖，产物仍可走现有 `?v=` 缓存策略）。

---

## 三、P2 · 架构与可维护性

### 3.1 渲染层反向依赖同步层

- **位置**：`src/app-render.js:3`（`import { backendStatusText, readStorageValue } from "./app-sync.js"`）
- **现状**：渲染模块直接读取存储与同步状态函数，UI 与持久化边界模糊（注意：与 actions 之间是单向依赖，不是循环依赖）。
- **方案**：同步结果统一收敛为状态切片字段（如 `sessionState.backendStatusText`），render 只消费 state；`readStorageValue` 的调用点移到 actions/初始化层。
- **状态**：✅ 已实施——`backendStatusText` 移入 `app-logic.js`，`render/shared.js` 只消费 state；`readStorageValue` 调用点收敛到 actions/settings.js（导出用户数据）与入口 `initApp()`。

### 3.2 两个巨型文件与线性事件分发

- **位置**：`src/app-actions.js`（约 1750 行）、`src/app-render.js`（约 2000 行）
- **现状**：`handleAppClick` / `handleAppSubmit` / `handleAppInput`（app-actions.js 第 1430-1680 行等）用长 if-else 链 + `closest()` 匹配 action，新增交互必须改分发函数，回归风险集中。
- **方案**：
  1. 建立动作路由表 `{ "data-action": handler }`，点击/提交统一 lookup 分发（与现有单次事件委托天然兼容）；
  2. 按页面拆 handler 文件（`actions/meal.js`、`actions/auth.js`、`actions/settings.js`），主文件只做注册与初始化；
  3. render 按页拆（`render/pages/`），`appShell()` 只组合。
- **状态**：✅ 已实施——(1) click/submit/input/change 四张路由表（`clickRoutes` 42 项按声明顺序匹配，含 `[data-tab]` 的 preventDefault 标记位）；(2) actions 拆为 `actions/services.js`（render/toast/路由/焦点管理/图表交互/庆祝/表单工具等跨域服务）+ `meal.js`/`auth.js`/`settings.js`/`training.js`/`home.js` 五个业务域，`app-actions.js`（1892 行）收敛为入口+路由层（约 480 行），对外导出面保持 12 个名字不变；(3) `app-render.js` 拆为 `render/shared.js` + `render/pages/` 五页模块，保留 facade 再导出。事件绑定从"每次 render 重试"改为 `initApp()` 首行一次性挂载（挂载点 `#app`/document/window 均为持久节点，行为等价）。

### 3.3 重复模式收敛

- **AI 状态重置**：app-actions.js 中 9 处重复重置 `aiResult/aiStatus/aiError/...`（第 259-519 行间）→ 抽 `clearMealDraftAI()`；
- **表单读取**：`updateMealDraftFromForm()`（397-411 行）与 `settingsValuesFromForm()`（812-827 行）手写 querySelector → 抽配置驱动的 `readFormValues(fields)`；
- **指标字段双份定义**：Onboarding（render.js 153-160 行）与 Settings（884-890 行）重复定义身高/年龄/体重等字段 → 抽 `bodyMetricFields()` 共用，避免范围校验漂移。
- **状态**：✅ 已实施——`clearMealDraftAI()` 落位于 `actions/meal.js`；`readFormValues(fields)` 落位于 `actions/services.js`（meal/settings 两处表单共用）；指标字段以 `data-setting-*` 选择器配置进 `settingsValuesFromForm()`，Onboarding 复用同一表单与校验。

### 3.4 app-sync.js 职责过载

- **位置**：`src/app-sync.js`（约 850 行）
- **现状**：同时负责存储封装、schema 迁移、按天合并、服务端加载、同步编排、重试。迁移与合并是数据安全核心，混在大文件里改动风险高。
- **方案**：拆为 `storage.js`（localStorage 封装）、`migrations.js`（schemaVersion 链）、`merge.js`（按天合并策略）、`sync.js`（编排）。迁移链补充显式单测（见 4.1）。
- **状态**：✅ 已实施——实际拆为 `app-data.js`（数据模型/normalize/migratePayload/mergePayloads/resetAppData）+ `app-storage.js`（localStorage 读写/会话存取封装）+ `app-sync.js`（同步编排 facade），迁移与合并已有 vitest 显式单测（`tests/unit/app-sync.spec.mjs`）。

### 3.5 服务端清除同步的防护

- **位置**：`src/app-sync.js:580-590`（`clearedAt` 处理）
- **现状**：服务端清除时间戳判断失误时本地数据会被静默清空，用户无感知。
- **方案**：清除本地前校验 `updatedAt <= clearedAt` 的同时，要求清除动作来自刚完成的服务端响应（而非合并推断），并在 UI 上留一次性提示"云端数据已于 X 清除"。

---

## 四、P3 · 工程化补强

### 4.1 引入 vitest 单测（优先覆盖纯逻辑）

- **现状**：核心计算（`app-logic.js` 的热量预算、体重/腰围进度、蛋白质推荐、`app-sync.js` 的迁移与合并）只靠 `scripts/app-regression-checks.mjs` 内联断言 + Playwright E2E 覆盖，反馈慢、无隔离、无覆盖率。
- **方案**：`npm i -D vitest`，把 `app-regression-checks.mjs` 第 302-509 行的逻辑断言迁为 `tests/unit/*.spec.mjs`；优先覆盖：热量口径、进度计算、`migratePayload()` 全版本链、`mergePayloads()` 按天合并边界。

### 4.2 ESLint + Prettier

- **现状**：只有 `node --check` 语法检查；门禁规则（禁 `transition: all`、禁遗留 key 等）散落在回归脚本里手写正则。
- **方案**：引入 eslint（推荐 `eslint` + `@eslint/js` recommended）与 prettier；回归脚本中的源码模式检查保留，但风格类规则移交工具链。
- **状态**：✅ 已实施——`eslint.config.mjs`（flat config；src/sw 用 browser+serviceworker globals，server/scripts/tests 用 node，tests 额外声明 browser globals 因 `page.evaluate` 回调在浏览器执行）+ `.prettierrc.json`（printWidth 140）。存量清零：删 3 处真实未用导入（meal.js/app-logic.js/data.js）、修 1 处 `no-useless-escape`、`ignoreRestSiblings` 豁免 app-data.js 的解构剔除模式；52 文件全量 `prettier --write`。

### 4.3 CI 缓存与并行

- **位置**：`.github/workflows/verify.yml`
- **现状**：每次 CI 重装 Chromium（约 1-2 分钟）；`npm run verify` 全串行。
- **方案**：用官方缓存方案缓存 `~/.cache/ms-playwright`；把门禁拆为两个并行 job（node-check / playwright），PR 反馈时间可减半。
- **状态**：✅ 已实施——`verify.yml` 拆为 node-check（`npm run check`，无需浏览器）与 playwright（E2E）双并行 job；`actions/cache@v4` 按 `package-lock.json` 哈希缓存 Playwright 浏览器（restore-keys 前缀兜底）；失败时上传工件（7 天保留）。复审修正轮修正两处：工件路径改为 Playwright 实际输出目录 `output/playwright/test-results/` + `playwright-report/`（原根目录 `test-results/` 与 outputDir 不符，永远为空），并为 Playwright 补配 `html` reporter。

### 4.4 版本号单一来源

- **现状**：发布需手动同步三处版本（`index.html` 两处 `?v=`、`sw.js` 的 `?v=` 与 `CACHE_NAME`），靠 `validate-version-sync.mjs` 事后校验。
- **方案**：新增 `scripts/bump-version.mjs`，从 `package.json` version（或时间戳）生成并写入三处；`check` 保留校验。发布动作从"改三处+祈祷"变成"跑一个脚本"。
- **状态**：✅ 已实施——`npm run bump:version` 默认生成 `YYYYMMDD-N`（本地时区，同日递增），或 `--shell <版本号>` 指定；一次写入 index.html 三处 `?v=`、sw.js 两处 `?v=` 并递增 `CACHE_NAME`，写后自动跑 `validate-version-sync.mjs` 自校验。实测：20260822-1 → 20260828-1，v13 → v14。

### 4.5 check 命令收敛

- **位置**：`package.json:9`（单行 18 个命令拼接）
- **方案**：新增 `scripts/run-gates.mjs` 统一调度（串行 node 检查 + 可并行的 validate 脚本），`package.json` 的 `check` 变为 `node scripts/run-gates.mjs`。
- **状态**：✅ 已实施——四阶段调度：语法检查按目录自动发现（src/server/scripts/tests/根配置，56 文件，新增文件零登记）、五个 validate 脚本并行、vitest+eslint+prettier 并行（均走 `node_modules` 内的 node 入口直跑，无 shell 依赖）、回归门禁串行收尾；失败聚合输出（哪项失败 + 输出尾部 20 行）。新增 `npm run lint` / `npm run format`。

### 4.6 文档口径统一

- **现状**：docs/ 下多份文档测试数量口径不一（15 / 17 / 53 混用），README 为唯一权威但历史文档未标注过时。
- **方案**：历史文档顶部加"已被 README 取代"标注；或在 docs/ 加索引说明当前基准。
- **状态**：✅ 已实施——六份历史文档（auth-reliability / implementation-audit / ui-optimization-plan / plan2 / plan-final / tasks-remaining）顶部统一加"历史快照（日期）"标注，指向 README（命令与测试）与 optimization-review-20260825.md（架构与进度）为权威口径；README 同步更新"可用命令 / 发布与缓存 / 持续集成"三节。

---

## 五、建议实施顺序

| 批次 | 内容 | 预估工作量 | 风险 |
|------|------|-----------|------|
| 第一批（安全） | 1.1 属性转义统一 + 门禁、1.2 HSTS、1.4 限流标注 | 1-2 天 | 低（不改变行为） |
| 第二批（性能） | 2.2 异步 IO、2.3 Brotli、2.4 modulepreload | 1 天 | 低 |
| 第三批（渲染） | 2.1 分步局部渲染（先输入不重渲染，再按页短路） | 2-3 天 | 中（视觉回归兜底） |
| 第四批（架构） | 3.1-3.4 拆分与去重 | 3-5 天 | 中（需先补单测） |
| 第五批（工程化） | 4.1 vitest、4.2 ESLint、4.3 CI 缓存、4.4 版本脚本 | 2-3 天 | 低 |

建议第三批动渲染前先做第四批中的 4.1（vitest 覆盖 logic/sync），给重构上保险。

---

## 附：审阅中已排除的疑点（不构成问题）

以下几项经源码核实后确认实现正确，无需改动，记录在此避免重复排查：

1. **local-auth 并发写入**：`mutateStore`（local-auth.mjs:102-111）将整个 read→mutate→write 序列放入 `writeQueue` 串行化，且写入用 tmp 文件 + `rename` 原子替换（mode 0o600），无竞态。
2. **Service Worker 缓存 API 响应**：`sw.js:43` 明确排除 `/api/`，network-first + 失败回退缓存策略对 PWA 应用壳是合理选择（`APP_SHELL` 中 `./` 与 `./index.html` 有冗余，可顺手清理，非问题）。
3. **Supabase RLS**：`auth.uid() = user_id` 行级隔离已生效；JSONB 内部一致性靠服务端 sanitize 双保险，当前规模下可接受。
4. **刷新令牌 Cookie**：`Path=/api/auth` + `HttpOnly` + `SameSite=Lax` 组合与刷新/登出端点匹配，路径未变更前无问题。
