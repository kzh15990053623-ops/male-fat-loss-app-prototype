# 稳减 · 私人健康手账

这是一个面向手机尺寸的减脂与健康管理 PWA，包含首页、饮食、训练、数据、我的五个页面。当前版本使用渐进式 ES Module + Node 静态服务，并接入 Supabase 邮箱登录与多用户数据隔离。

## 现在已经做好了什么

- 邮箱 + 密码登录。
- 不提供游客模式。
- 每个登录用户只读写自己的数据。
- 刷新登录状态使用 HttpOnly Cookie，前端不再把 refresh token 放进 `localStorage`。
- 新用户第一次登录会先完成基础目标设置，不再直接使用演示记录。
- 每天的饮食、训练、喝水、步数、睡眠和任务状态会按日期归档。
- 多设备冲突按天合并：每天的记录、体重和腰围日志按日期取较新一方，不再整包覆盖。
- 体重和腰围趋势会按日期更新，同一天覆盖、跨天追加；趋势日志两端统一保留最近 90 条，按天归档记录保留最近 180 天。
- 断网时会先保存在本机，恢复联网或回到前台后会自动重试同步，也可以手动重试。
- “我的”页面可以导出数据，也可以通过应用内确认弹窗清空本地与云端数据。
- 设置里可以关闭 AI 辅助，关闭后饮食页只保留手动填写。
- 设置里可以开启记录提醒，浏览器支持通知时会按设定时间提醒补全记录。
- 热量口径固定为“剩余可摄入 = 每日预算 - 已摄入”，运动消耗独立展示，不自动加回预算。
- AI 营养识别只接受真实模型结果；限流、离线、超时或服务失败时明确提示，并保留手动记录。
- 登录、注册和 AI 接口有服务端速率限制（认证接口按 IP，AI 接口按用户，含每日配额），超限返回 429 和 Retry-After。
- 退出登录会同时吊销 Supabase 服务端会话，泄露的刷新令牌即刻失效。
- 刷新登录状态只接受 HttpOnly Cookie，不再从请求体读取令牌。
- 本地会自动读取 `.env` 文件。
- Supabase 数据库脚本已经放在 `supabase/migrations/202606300001_init_app_states.sql`。

## 第一次配置 Supabase

1. 打开 Supabase，新建一个项目。
2. 进入项目后台的 SQL Editor。
3. 把 `supabase/migrations/202606300001_init_app_states.sql` 里的内容复制进去并运行。
4. 进入 Project Settings > API / API Keys，复制这两个值：
   - Project URL
   - Publishable key（旧项目也可使用 anon public key）
5. 在项目根目录复制一份环境变量文件：

```powershell
Copy-Item .env.example .env
```

6. 打开 `.env`，把里面的示例值替换成你 Supabase 后台复制出来的真实值：

```text
SUPABASE_URL=https://你的项目.supabase.co
SUPABASE_ANON_KEY=你的 Publishable key
```

## 本地运行

```powershell
npm run dev
```

然后访问：

```text
http://localhost:5173
```

启动后，登录页会先检查配置格式、项目可达性、Auth 就绪状态和是否允许新用户注册。不可用时表单会停止提交并显示可操作原因，不再把底层 `fetch failed` 暴露给用户。

可在不创建测试账号的前提下单独检查真实认证链路：

```powershell
npm run check:supabase
```

该命令只读取 Supabase Auth 设置，不写数据库、不发注册邮件。成功必须同时满足 Auth 可达且当前项目允许注册。

### 本机账号兜底

在本地开发环境中，如果 Supabase 不可达，登录页会显示“改用本机账号”。本机账号仍使用邮箱和密码：密码通过 scrypt 加盐哈希保存，刷新会话只保存令牌哈希；健康数据按本机用户隔离保存在 `data/local-auth.json`，该目录不会作为静态文件暴露，也不会提交到 Git。

本机模式不会伪装成云同步，页面会持续标注“本机账号已保存”。Render、Vercel 或 `NODE_ENV=production` 环境默认关闭本机账号；`render.yaml` 也显式设置了 `LOCAL_AUTH_ENABLED=false`。拿到有效 Supabase 配置后，登录页会继续默认使用云端账号。

## 数据保存在哪里

数据保存到 Supabase 的 `public.app_states` 表。每个用户只有一条自己的 App 状态记录，里面包含当前页面需要的目标、饮食、训练、体重、腰围等数据。

当前 App 数据结构版本是 `schemaVersion: 3`。迁移会保留现有饮食、训练、体重、腰围与偏好数据，并移除旧运动基数和演示趋势字段。为了保持数据层简单，数据库本轮仍不拆表；每天的记录会放在这条用户状态里的 `dailyRecords` 中，只保留最近 180 天（滚动窗口），体重/腰围趋势日志保留最近 90 条，前后端口径一致并有脚本校验。

这张表已经开启 RLS，也就是数据库层面的“用户隔离锁”。简单说：A 用户登录后只能看到 A 自己的数据，不能读写 B 用户的数据。

## 可用命令

```powershell
npm run check
npm run lint
npm run format
npm run bump:version
npm run check:supabase
npm run test:unit
npm run test:coverage
npm run test:a11y
npm run test:e2e
npm run verify
```

`npm run check` 由 `scripts/run-gates.mjs` 统一调度：语法检查按目录自动发现（当前 67 个 JS/MJS 文件，新增文件无需登记）、六个 validate 脚本并行、Vitest 单测与 V8 覆盖率门禁、ESLint、Prettier 格式检查及应用运行时回归门禁。`npm run test:unit` 单独运行 Vitest，`npm run test:coverage` 生成文本、HTML 与 JSON 覆盖率报告；当前全局基线下限为 statements 56.78%、branches 50.07%、functions 61.14%、lines 59.17%，分项阈值见 `vitest.config.mjs`。渲染和 actions 等依赖 DOM 的模块不纳入 Node 覆盖率阈值，由 Playwright 覆盖。`npm run lint` 单独跑 ESLint，`npm run format` 用 Prettier 全量格式化。`npm run bump:version` 一键更新应用壳版本戳并自校验（见“发布与缓存”）。`npm run check:supabase` 是针对当前 `.env` 的无副作用真实云端连通性检查。`npm run test:a11y` 单独运行可访问性用例；`npm run test:e2e` 使用固定版本 Chromium 覆盖 DOM、两种认证模式、登录与首次设置、三类记录、离线同步恢复、PWA 离线应用壳、AI 全状态、三档视口和视觉回归，首次运行前可执行 `npx playwright install chromium`。`npm run verify` 顺序运行 `check` 与全部 Playwright 用例，但不会创建真实云端用户。

```powershell
npm run supabase:login
npm run supabase:link
npm run supabase:db:push
```

如果你已经登录 Supabase 命令行，可以用这三条命令把 `supabase/migrations` 里的数据库结构推送到云端项目。

## 后端接口

- `GET /api/health`：本地进程存活检查；不访问 Supabase，适合平台 liveness probe。
- `GET /api/readiness`：无副作用检查 Supabase Auth 是否可达、是否就绪及是否允许注册；`?force=1` 跳过短期缓存。
- `POST /api/auth/signup`：邮箱注册。
- `POST /api/auth/login`：邮箱登录。
- `POST /api/auth/refresh`：刷新登录状态。
- `POST /api/auth/logout`：退出登录并清除刷新 Cookie。
- `GET /api/auth/user`：读取当前登录用户。
- `GET /api/state`：读取当前用户 App 状态及当前 `revision`。
- `PUT /api/state`：保存当前用户 App 状态（兼容 `POST`）。写入必须携带显式非负整数 `revision`；缺失或过期版本返回 409 并携当前冲突载荷，非法版本返回 400，成功响应包含新 `revision` 与 `updatedAt`。
- `DELETE /api/state`：不支持，固定返回 405。应用内“清空全部记录”使用带 `clearedAt` 与 `revision` 的 PUT 墓碑；遇到 409 时仅以同一请求 marker 和服务端新版本重试一次，最终 `clearedAt` 由服务端统一生成并与 `updatedAt` 相同。本机只保留无健康数据的 marker，离线时拒绝清空，避免旧设备或时钟偏差复活已清空数据。
- `POST /api/ai/nutrition`：真实模型营养识别代理，需要登录后使用。请求为 `{ foodText, context, locale: "zh-CN" }`；失败统一返回 `{ error, code, retryable, requestId }`。

成功响应包含 `requestId`、`source: "model"`、`model`、`confidence`、`needsReview`、三大营养、食物明细、`assumptions[]` 与 `warnings[]`。保存记录时会写入 `nutritionSource`，并标记 AI 结果是否被用户修改。

## 前端结构与视觉回归

- `src/app-state.js`：领域、会话/同步、纯 UI 三个状态切片与 schema v3 默认值。
- `src/app-data.js`：数据模型、迁移、持久化清洗、本地变更时钟与 base/local/remote 字段级三方合并。
- `src/app-storage.js`：用户状态、本机会话元数据及旧键迁移的 localStorage 封装。
- `src/app-sync.js`：认证会话与同步编排，串行排空写入期间的新变更；脏状态把最后确认的服务端基线与工作副本原子落入同一 localStorage envelope，409 后仅在基线可验证时三方合并重试。
- `src/app-logic.js`：热量、进度、趋势和训练建议等纯逻辑。
- `src/app-render.js`：五页、登录、首次设置、设置页与弹窗的纯渲染。
- `src/app-actions.js`：根节点单次事件委托和页面动作。
- `src/styles/`：按 tokens、base、components、pages 分层的样式。

登录、首次设置、五个主页面、设置页和 AI 复核态的可重复视觉基准位于 `tests/visual/__screenshots__/`；人工验收图位于 `output/playwright/`。DOM 测试固定覆盖 320×740、390×844、430×932，且逐页检查横向溢出、44px 触控目标、字段语义和非法数值。Barlow Condensed 数字字体已内嵌在设计令牌样式中，授权文本位于 `src/fonts/OFL.txt`。

## 配置真实 AI 营养服务

服务端支持 OpenAI-compatible Chat Completions 协议，也支持返回约定营养结构的内部网关。前端不会读取模型密钥。

```text
NUTRITION_AI_ENDPOINT=https://你的模型网关/v1/chat/completions
NUTRITION_AI_API_KEY=仅保存在服务端的密钥
NUTRITION_AI_MODEL=模型名称
NUTRITION_AI_PROTOCOL=openai-compatible
NUTRITION_AI_TIMEOUT_MS=15000
```

如果你的内部网关直接接收 `{ foodText, context, locale, model }` 并返回约定结构，将 `NUTRITION_AI_PROTOCOL` 设置为 `contract`。未配置模型服务时，接口返回 `AI_PROVIDER_NOT_CONFIGURED`，不会降级为本地规则估算。

## 部署提醒

不要把真实 Supabase key 或 AI key 写进代码仓库。部署到 Render、Vercel 或其他平台时，把它们配置到平台的服务端环境变量里。

`render.yaml` 已经预留 Supabase 与 AI 环境变量，部署时在 Render 后台填真实值即可；`healthCheckPath` 指向 `/api/health`。

限流计数（`server/rate-limit.mjs`）保存在进程内存中，按“单实例部署”设计：当前 Render 单实例配置下有效；若将来水平扩容为多实例，需先把计数迁移到共享存储（Redis 或数据库表），否则每个实例各自计数，实际阈值会被实例数放大。

## 发布与缓存

静态资源带 gzip/Brotli 压缩与协商缓存。服务端完整解析 `Accept-Encoding` 的 q 值与通配符：至少 1 KiB 的可编码资源按权重协商，同权重优先 `br → gzip → identity`；小型文本在 identity 可用时避免无益压缩，但 identity 被拒绝时仍选择可接受编码；PNG 等不可编码资源在 identity 被拒绝时返回 406。ETag 由实际发送内容的 SHA-256 摘要和 `br`、`gzip`、`identity` 表示共同生成，既避免同尺寸/同 mtime 内容替换的碰撞，也避免跨编码误判 304；所有静态资源的 200、304、406 均携带 `Vary: Accept-Encoding`，`If-None-Match` 支持列表、`*` 与 GET 弱比较。带 `?v=` 版本号的资源使用一年 immutable 缓存，其余模块文件走协商缓存。发布新版本时执行 `npm run bump:version`：脚本会一次性更新全部版本戳（`index.html` 三处 `?v=`、`sw.js` 两处 `?v=` 与 `CACHE_NAME` 递增），随后自动运行 `scripts/validate-version-sync.mjs` 自校验；也可以 `npm run bump:version -- --shell <版本号>` 指定版本。`npm run check` 同样会校验版本一致性，不一致直接失败。

## 持续集成

工作区内有一份尚未跟踪、尚未推送的 `.github/workflows/verify.yml` 候选配置，设计为两个并行 job：node-check（语法、校验脚本、Vitest+coverage、ESLint、Prettier、回归门禁，无需浏览器）与 playwright（E2E 与视觉回归），并按 `package-lock.json` 哈希缓存 Chromium。它尚未在远端 Actions 实际运行，因此当前不能视为已启用 CI，也没有缓存命中率或提速数据；浏览器缓存预热同样延期到工作流获准提交并首次跑通之后。本地 bundle 收益复评见 [bundle 收益复评（2026-08-30）](docs/bundle-evaluation-20260830.md)。
