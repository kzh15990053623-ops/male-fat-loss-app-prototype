# 测试版上线核查记录

核查日期：2026-09-20（Asia/Shanghai）。范围：自己或少数人先测试，暂不接入 AI。

## 当前结论

发布候选的代码与自动检查已就绪；新版尚未部署到现有公网服务。当前状态为 **NO-GO：等待 Render 与 Supabase 管理访问授权**。本记录将本地、GitHub 和线上证据分别列出，不用本地通过替代真实上线验收。

- 发布分支：`main`。
- 目标提交：`9a62d96334ee714f43391e5b40fd79f0535dac71`，已通过 GitHub API 核实。
- 仓库：[male-fat-loss-app-prototype](https://github.com/kzh15990053623-ops/male-fat-loss-app-prototype)。
- 现有服务：[公网地址](https://male-fat-loss-app-prototype.onrender.com/)。此地址目前为旧版，不是新版交付链接。
- 本地保留原来的 `codex/ui-refinement-20260916` 分支，HEAD 为 `81ffdd7`；已验证其文件内容与目标 `origin/main` 无差异。没有切换、重置或更新工作区分支。

## 已完成的发布准备

| 检查 | 状态 | 本次证据 |
| --- | --- | --- |
| main 已合并可靠性与 UI 改动 | PASS | PR #2、PR #3 均已合并；GitHub main 指向目标提交 |
| 代码、单测及应用回归门禁 | PASS | 核实目标提交的既有 verify 任务成功 |
| 浏览器端到端及视觉检查 | PASS | 核实同一 verify 运行中的浏览器任务成功 |
| 数据库迁移、用户隔离与并发写入 | PASS | 核实 2026-09-19 UTC 的隔离 Supabase 集成任务成功，提交与目标一致 |
| 页面与缓存版本一致性 | PASS | 本次执行校验：应用壳 `20260916-1`，缓存 `fitness-fat-loss-app-shell-v18` |
| 前端文件清单 | PASS | 本次执行校验：21 个 JavaScript 模块，入口版本正确 |
| 本地生产模式启动检查 | PASS | 本次使用 Node `v22.23.2` 完成 8 项检查，见下文 |
| 仓库部署配置 | PASS | `render.yaml` 为 Node 22、`npm ci`、`npm start`、`/api/health`，本机账号关闭；这不证明 Render 后台已采用这些设置 |
| 数据库脚本准备 | PASS | 已检查两份迁移及执行次序，目标提交的隔离数据库任务验证通过 |

GitHub 证据：

- [verify：35096363718](https://github.com/kzh15990053623-ops/male-fat-loss-app-prototype/actions/runs/35096363718)，2026-09-16，两个任务均为 success。
- [数据库集成：35470568367](https://github.com/kzh15990053623-ops/male-fat-loss-app-prototype/actions/runs/35470568367)，2026-09-19 UTC，任务为 success。

以上远端检查均对应完整目标提交。本次读取既有结果，没有重新触发或重复执行完整测试套件。

### 本次新增执行的 8 项启动检查

在独立 Node 22 进程中启动临时本地端口，设置生产模式，明确关闭本机账号，并在该进程中置空 Supabase 与 AI 配置，避免连接真实数据。进程结束后服务已关闭；没有修改 `.env`。

1. Node 22 能启动服务；健康接口成功，本机账号与 AI 均关闭。
2. 缺少 Supabase 时，认证就绪接口返回 503 / `AUTH_NOT_CONFIGURED`，不自动启用本机账号。
3. 首页包含 `20260916-1` 入口版本，HTML 使用 `no-store`。
4. Service Worker 返回 JavaScript、缓存名称为 v18，文件使用 `no-cache`。
5. PWA 清单返回正确 MIME 类型，显示模式为 standalone。
6. 带版本号的应用入口返回 JavaScript 与 immutable 缓存策略。
7. `.env`、本机数据、Git 配置、服务端源码和数据库迁移路径均返回 404。
8. 页面包含安全响应头；模拟 HTTPS 代理请求时存在 HSTS。

这些是本地启动和 HTTP 检查，不代表已完成真实 Supabase、离线浏览器操作或手机验收。

## 本次线上实测

| 检查 | 状态 | 结果 |
| --- | --- | --- |
| 公网服务响应 | PASS | 首页、`/api/health` 返回 200 |
| 公网是否为目标版本 | FAIL | 首页和 `/src/app.js` 的内容校验值均匹配旧 `origin/master`，不匹配目标 `origin/main` |
| 认证就绪接口 | FAIL | `/api/readiness?force=1` 返回 401，内容为“需要访问密码” |
| Service Worker 文件 | FAIL | `/sw.js` 返回首页 HTML，不是 JavaScript；200 状态不能视为通过 |
| PWA 清单 | FAIL | 返回旧 master 内容，类型为 `application/octet-stream` |
| 新版安全响应头 | FAIL | 实测响应缺少 HSTS、CSP、nosniff、frame 和 Referrer Policy 头 |

校验值（响应解压后的正文，SHA-256）：

- 公网首页：`d9f5d95b1b6e6860244d5b2961e19d8c4d7b0a03e2e357381ce5cfedf23c1985`。
- 公网 `/src/app.js`：`71e3c0bc964a2e4c92b463f67e0cb4bb80aaaf5fa1d7c7f92ef2b1b026ba2bb0`。

上述结果确认线上提供旧文件；实际服务分支与部署提交仍需要从 Render 后台核实。

## 当前阻塞与配置状态

- Render CLI `whoami`：无法认证，要求重新登录。浏览器后台读取也未成功，无法借此核实服务配置。
- Supabase CLI `projects list`：没有可用访问令牌，不能读取项目列表、迁移或生产数据库。
- 本地 `check:supabase`：`configured=true`、`reachable=false`、`ready=false`，错误为 `AUTH_PROJECT_NOT_FOUND`。只能确认本地配置不可用，不能据此判断云端项目已删除或 Render 上使用了同一配置。
- 本地 Supabase URL 和客户端密钥：configured；服务角色密钥：not configured。
- 本地 AI endpoint、API key、model：not configured，符合本次暂不接 AI 的范围。
- Render 后台实际环境变量：NOT RUN。

不记录任何密钥、令牌、数据库密码或个人健康数据。

## 授权后直接接续

1. 恢复 Render 与 Supabase 登录，定位现有 APP 服务和对应数据库；先读取当前配置和部署记录，保留回退所需信息。不要使用旧会话的设备授权码。
2. 确认 Supabase 项目可用且允许测试账号注册，核对已有迁移、表、访问权限及用户隔离规则。按顺序只执行缺少的迁移：
   - `supabase/migrations/202606300001_init_app_states.sql`。
   - `supabase/migrations/202609060001_explicit_app_state_grants.sql`。
3. 将现有 Render 服务核对到正确仓库及 `main`，配置 Node 22、`npm ci`、`npm start`、`/api/health`、`LOCAL_AUTH_ENABLED=false`，填入对应项目的 Supabase URL 和客户端密钥。AI 暂不配置。服务角色密钥仅在需要云端删号功能时处理。
4. 部署指定提交并核对实际部署 SHA、就绪接口、页面资源与缓存版本。若 main 已变动，先核对新提交及其检查结果，不能自动将未验证版本视为本候选。
5. 使用专用测试账号验证注册、登录、手动记录、刷新与重新登录后的保存、两设备同步和两账号隔离；在测试账号中关闭 AI。
6. 验证已登录状态下离线记录与重连补传；离线冷启动单独覆盖信任设备开关，以及旧缓存更新到新版。
7. 记录真实云端和设备验收结果，再交付可用公网链接。

真实账号、生产数据库权限、跨设备同步与离线浏览器验收当前均为 **NOT RUN**。现有已知餐次覆盖和趋势口径问题仍在本次范围外，首轮使用测试数据，不宣称长期正式使用验收完成。

## 本次改动

仅新增本核查记录。应用源码、GitHub 分支、Render 配置、云端数据库和本地密钥文件均未修改；没有触发部署或创建新服务。
