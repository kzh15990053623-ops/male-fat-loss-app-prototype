# Android 云同步与 AI 实测记录

测试日期：2026-09-30，13:34–13:40（北京时间）。使用三星 SM-N9860、Android 12，以及已安装的 Android 1.2 APK（SHA-256 前缀 `47DE92E0`）。

## 结论

13:34–13:40 的真实 AI 文字调用通过；16:54 追加的真实餐食照片调用也通过（本机后端调用真实模型）。手机云账号连接未通过，真实云同步和手机端 AI 尚未完成验收。手机实际使用的公网后端仍提供旧版资源，认证就绪和 AI 预算接口均返回 `401「需要访问密码」`。

本轮未修改应用源码、APK 或云服务配置。已有手机记录先备份，测试结束时持久化档案指纹与测试前一致。

## 实测结果

| 检查 | 结果 | 实际证据与范围 |
| --- | --- | --- |
| 手机访问公网健康接口 | PASS | 原生 Capacitor HTTP 请求 `/api/health`，返回 200、`ok: true`；仅证明服务存活 |
| 公网认证就绪 | FAIL | 手机和电脑请求 `/api/readiness?force=1`，均返回 401、`需要访问密码` |
| 手机云连接流程 | FAIL | 使用不存在的测试邮箱、默认“先检查，暂不覆盖”提交；界面显示“云端认证服务未就绪，手机记录仍可使用” |
| 连接失败后保留手机数据 | PASS | 云同步仍关闭、账号未认证、档案未绑定；表单邮箱及密码已清空，持久化档案指纹一致 |
| 真实 Supabase 登录、上传和跨设备读回 | NOT RUN | 认证就绪检查已阻止连接，未取得真实云账号会话 |
| 离线修改后联网同步、冲突恢复 | NOT RUN | 同上；此前本机离线保存通过不代表真实云同步通过 |
| 手机访问 AI 预算接口 | FAIL | 原生 HTTP 请求 `/api/ai/budget` 返回 401、`需要访问密码` |
| 真实 AI 文字调用 | PASS | 本机项目服务端实现使用现有私密配置调用真实模型；返回 `source: model` 和有效营养 JSON |
| AI 预算记录 | PASS | 请求次数 1 → 2，预留金额 0.10 → 0.20 元，每月上限保持 100 元；本轮新增一次请求 |
| 手机界面 → 云端 AI → 确认保存 | NOT RUN | 手机云登录尚未成功；本机模型调用不能替代这条完整路径 |
| 真实食物照片识别、相机/相册及照片结果核对 | NOT RUN | 未发送真实食物照片，不能据文字结果认定照片功能通过 |
| 本机现有 Supabase 配置 | FAIL | `npm.cmd run check:supabase`：configured、reachable=false、ready=false、`AUTH_PROJECT_NOT_FOUND`；仅代表本机配置 |
| Render 部署详情 | NOT RUN | 连接器可列出工作区 `male-fat-loss-app-prototype`；要求用户确认工作区后才能读取服务和部署详情，本轮尚未取得确认 |

## 公网版本证据

手机云服务地址：`https://male-fat-loss-app-prototype.onrender.com`。

- 公网 `/` 返回 200，入口脚本为 `./src/app.js`，未发现当前应用版本戳。
- 公网 `/src/app.js` 返回 200，83,313 字节；SHA-256 为 `71e3c0bc964a2e4c92b463f67e0cb4bb80aaaf5fa1d7c7f92ef2b1b026ba2bb0`，与本机 `origin/master:src/app.js` 完全一致。
- 这证明实际网页资源仍与旧分支一致。Render 的服务分支、最近部署 SHA、环境变量和 Supabase 项目状态仍需通过授权接口核对。
- `/api/health` 的 200 不能证明登录、数据库、同步或 AI 可用。

## 真实 AI 调用证据

通过项目现有 `requestNutritionEstimate()` 调用真实配置的 `deepseek-flash`，未替换 fetch、未使用测试响应，也未重置预算账本。

- 输入：`100克熟米饭，不加油，不加酱料`。
- 请求耗时：1,239ms。
- 模型返回：116kcal，蛋白质 2.6g、碳水 25.9g、脂肪 0.3g；包含食物明细和结构化营养字段。
- 请求 ID：`9cce09cb-c799-4811-8b48-048b27f3bf3c`。
- 本轮预算预留增加 0.10 元；账本估算费用增加 0.001412 元。估算金额不是模型提供商账单。
- 此项证明现有本机配置可调用真实模型并记录预算。未验证手机云路由、Render 上的 AI 配置或照片识别准确性，返回数值也不代表营养准确性已经验收。

## 数据与本机证据

测试前已备份 SQLite、shared preferences 和应用持久化档案。测试前及云连接失败后的档案 SHA-256 均为：

`be3fdb290700cd0c63365c5fe6dcf6a0a71d369dcbdd084dc71d76fe85c17cbb`

本轮未覆盖或删除手机、云端健康档案，未修改手机网络和系统显示设置。临时表单内容已清空。

- [手机连接失败截图](../output/playwright/0930-cloud-connection-blocked.png)。
- 完整响应和私有备份位于本机忽略目录 `.playwright-cli/cloud-20260930/`；私有档案和密钥不放入交接文档。
- UI、安装与本机离线验收仍见[Android 真机复测记录](android-device-20260930.md)。

## 完成剩余验收的前提

先确认 Render 工作区并核对服务分支、实际部署、认证配置和数据库状态。公网认证就绪后，由用户在手机输入真实账号凭据，再验证两端数据读取、临时记录同步、离线恢复及手机 AI 确认保存。两端都有档案时保留默认“先检查，暂不覆盖”，确认需要保留的数据后再执行首次同步。

13:34–13:40 的验收轮仅执行测试。用户随后要求处理登录故障与照片识别；后续排查和修复进展见以下追加记录。

## 2026-09-30 登录故障排查与真实照片复测

用户安装后报告云服务未就绪，并要求处理登录和拍照识别。本节是 16:54–17:03 的追加验证；上文保留 13:34–13:40 的历史结果。当前没有发布新版后端、修改平台配置或数据库，也没有改动手机记录或重新安装 APK。

### 登录故障

- 公网 `/api/readiness?force=1`、`/api/ai/budget` 均复现 HTTP 401、`需要访问密码`。
- 17:03 再次读取公网 `/src/app.js`，83,313 字节；SHA-256 为 `71e3c0bc964a2e4c92b463f67e0cb4bb80aaaf5fa1d7c7f92ef2b1b026ba2bb0`，仍与 `origin/master:src/app.js` 完全一致。该旧后端使用访问密码，缺少当前 APK 所需的云账号和预算接口；只修改手机表单无法恢复服务。
- GitHub `main` 当前为 `9a62d96334ee714f43391e5b40fd79f0535dac71`。当前工作区的照片处理、AI 预算模块及预算迁移尚未包含在这个提交中，发布时需要包含这些实现。
- 本机 Supabase URL、客户端密钥为 configured，但认证探测仍返回 `AUTH_PROJECT_NOT_FOUND`；服务角色密钥和 AI 使用者配置为 not configured。这些结果仅代表本机配置，不代表 Render 环境变量的实际状态。
- Supabase 官方 CLI 的只读项目查询返回 `Access token not provided`。Render 连接器列出目标工作区，但工具要求用户明确确认工作区后才能读取服务。已请求工作区确认和 Supabase 管理登录；尚未得到所需输入。

恢复服务需要核对 Render 实际服务和部署配置、使用有效的 Supabase 项目，发布含照片与预算模块的后端，并核对三项现有迁移及个人账号预算权限。上线后还要完成真实账号登录、手机同步和手机端照片识别，才能判定问题已解决。

### 真实餐食照片

使用[公开的鸡肉米饭样例照片](https://khogaomientay.vn/upload/images/com-ga-nau-tu-gao-Nang-Hoa.jpg)验证现有 `requestNutritionEstimate()`，只提交图片，不提供食物名称提示；没有替换 fetch 或模型返回。

| 项目 | 结果 | 实际证据与范围 |
| --- | --- | --- |
| JPEG 校验 | PASS | 305,164 字节，通过项目的格式、大小及尺寸校验 |
| 真实照片调用 | PASS | `deepseek-flash`，耗时 2,277ms，返回 `source: model`、`inputMode: photo` |
| 食物识别与核对 | PASS | 返回米饭、鸡肉和蔬菜；`needsReview: true`，包含份量、用油和酱料不确定性提示 |
| 持久预算 | PASS | 请求数 2 → 3，预留金额 0.20 → 0.30 元；月上限保持 100 元。本次预留 0.10 元，不代表服务商实际账单 |
| Node 22 应用门禁 | PASS | Node v22.23.2；111 文件语法、6 项静态校验、单测及覆盖率、ESLint、Prettier、应用回归门禁全部通过 |
| 登录与照片浏览器回归 | PASS | 现有 `native-cloud.spec.mjs` 和 `meal-photo.spec.mjs` 共 10/10；使用本地模拟服务，不作为真实公网验收 |
| 手机端真实相机/相册 → 云端识别 → 核对保存 | NOT RUN | 公网认证仍未恢复，尚未取得真实云账号会话 |

此样例证明现有照片接口能调用真实视觉模型并返回核对结果；单张图片不能证明餐食营养数值准确度。样例及原始证据保存在本机忽略目录 `.playwright-cli/cloud-fix-20260930/`，其中 `photo-live.json` 保留请求结果和预算变化，`public-version.json` 保留本次公网版本比较结果。没有把原始图片写入用户档案或云同步数据。

## 2026-09-30 后端修复候选与平台授权

用户已确认 Render 工作区并告知完成网页登录。本次通过连接器读取到实际服务 `srv-d8rq3cugvqtc73fcrc2g`，仓库正确，但服务分支仍为 `master`，构建命令为 `npm install`、没有健康检查路径。当前 live 部署为 `dep-d8rq3d6gvqtc73fcrcb0`，提交 `dd05de5c965ba84276591fb30d7a940a937f6f4b`，首次完成于 2026-06-21；这是云端管理接口证据。

已从 `origin/main` 创建隔离工作区和 `codex/cloud-login-photo-20260930` 修复分支，仅包含 15 个后端、部署配置、预算迁移及测试文件。Render Blueprint 明确设置 `branch: main`；PGlite 仅作为预算 SQL 测试的开发依赖。没有暂存或提交原工作区的 Android、界面、截图或其他未提交改动。

- 修复提交：`8c0a91299a3698fd47b9a74480af92a43ecc2c23`。
- [修复 PR #4](https://github.com/kzh15990053623-ops/male-fat-loss-app-prototype/pull/4)：当前为草稿，尚未合并。
- Windows Node v22.23.2 应用门禁全部通过，含 97 文件语法、6 项静态校验、单测和覆盖率、ESLint、格式及应用回归门禁。
- Windows 完整浏览器检查 77/77 通过；沿用该基线的视觉截图，没有更新基准或阈值。
- GitHub 三项 CI 全部成功：[应用与浏览器门禁](https://github.com/kzh15990053623-ops/male-fat-loss-app-prototype/actions/runs/36702274107)、[独立 Supabase 数据库集成](https://github.com/kzh15990053623-ops/male-fat-loss-app-prototype/actions/runs/36702274034)。数据库结果来自专用临时测试环境，不能证明公网项目已迁移。

浏览器控制仍返回连接错误，应用内 Supabase 页面读取超时，无法读取用户已登录的管理页面。官方 CLI 的核验结果为 Render 尚未授权，Supabase 仍返回 `Access token not provided`。网页登录和 CLI 管理授权是不同会话。

已准备并在 18:36 启动本机 `.playwright-cli/cloud-fix-20260930/authorize-cloud.cmd` 交互授权助手，只调用官方 Render 和 Supabase CLI 完成登录与只读核验；不执行部署、迁移或修改健康记录。Render CLI 凭据保存在本机忽略目录，Supabase 凭据由官方 CLI 管理。验证码只需在平台和终端输入，不发送到聊天。此前单独发起的 Render 授权请求已超时，助手会生成新的授权流程。

剩余状态：实际 Supabase 项目、项目密钥和数据库权限为 NOT RUN；云平台环境变量更新、服务分支更新、新版部署、真实手机云登录与手机照片识别为 NOT RUN。修复候选与 CI 已就绪，仍需有效 CLI 管理授权后继续执行和验收。

## 2026-09-30 再次连接与电脑 Chrome 要求

用户要求重新尝试，并明确后续仅使用电脑上的 Chrome，沿用现有登录会话。此前要求在内置浏览器登录的请求已作废。

- Render 连接器本次仍可读取已确认工作区的服务；服务仍指向 `master`，构建为 `npm install`，健康检查路径为空。读取连接器不等于取得 Dashboard 或 CLI 会话。
- Render 官方 CLI 授权核验仍未通过，Supabase 官方 CLI 项目查询仍返回 `Access token not provided`。此前交互授权助手已经退出，不能把进程退出视为登录完成。
- 内置浏览器重试时能够读取 Render 和 Supabase 登录页，但两个会话均未登录；用户明确要求改用电脑 Chrome 后，没有继续在内置浏览器操作。
- 电脑 Chrome 正在运行，工具识别到 `用户1` 的扩展连接；实际读取用户标签页仍返回 `nodeRepl.fetch request failed`。目前不能确认或操作 Chrome 中的已登录管理页面。
- Windows 注册的 `com.openai.codexextension` 原生通信清单存在，所指程序存在，且有一个通信程序进程运行。这些结果证明组件存在，不能证明浏览器通信已恢复。没有读取浏览器 Cookie、密码或会话存储，也没有修改通信组件。
- 官方[浏览器扩展排障说明](https://learn.chatgpt.com/docs/chrome-extension#troubleshooting)包含重启桌面应用和重新连接扩展的步骤；当前需要先恢复 Chrome 连接，再继续读取实际 Supabase 项目与部署配置。

修复 PR #4 的三项 CI 仍全部成功，草稿未合并。本次没有部署、迁移或修改云环境变量；真实手机云登录及手机照片识别仍为 NOT RUN。

### 用户重启 Codex 后再次尝试 Chrome

用户告知已重启 Codex，并要求再次连接 Chrome。本次工具清单不再包含 Chrome；选择 Chrome 以及通过 Chrome 专用入口打开已确认的 Render 服务页，均返回 `Browser is not available: chrome`。Windows 只读进程检查显示 Chrome 进程为 0、原生通信进程为 0；通信清单和其程序文件仍存在。当前需要用户打开电脑 Chrome 后继续连接，不需要重复进行平台登录或再次重启 Codex。没有改用内置浏览器，也没有执行云端写入。

用户随后确认已打开 Chrome。再次读取工具清单时，Chrome `用户1` 的扩展重新出现，但标签页读取仍返回 `nodeRepl.fetch request failed`。选择当前 Chrome 接口后，按其文档初始化会话也返回相同错误，未取得可操作的标签页。重启后的实际复查没有恢复通信；接下来需要检查 Chrome 工具栏扩展的侧栏是否正常连接，并通过桌面应用的浏览器设置修复扩展连接。未继续反复请求同一失败接口，未读取浏览器凭据，也未执行云端写入。

## 2026-09-30 连接器发布与实际公网复查

用户要求改用可用方法解决，并随后开启完整访问权限。本节记录 22:34–22:46 的最新结果，覆盖上文候选仍为草稿、尚未发布的历史状态。

- 通过 GitHub 连接器合并[修复 PR #4](https://github.com/kzh15990053623-ops/male-fat-loss-app-prototype/pull/4)，`main` 合并提交为 `63a47bcea9bb1ea963ba69da2a664622b58b4a8d`；内容与已验证修复候选一致。
- 实际 Render 服务继续自动部署 `master`。通过[发布 PR #5](https://github.com/kzh15990053623-ops/male-fat-loss-app-prototype/pull/5)将已验证 `main` 内容合入该部署分支，合并提交为 `cbb5c5c9856a797f8cf1f7e167726e1b94ba6fcb`。没有在原工作区暂存或提交 Android、UI 和其他未提交改动。
- PR #5 的[应用与浏览器门禁](https://github.com/kzh15990053623-ops/male-fat-loss-app-prototype/actions/runs/36728928298)以及[独立 Supabase 数据库集成](https://github.com/kzh15990053623-ops/male-fat-loss-app-prototype/actions/runs/36728928288)全部成功；数据库仍是专用测试环境。
- Render 连接器以合并方式更新四个非密钥运行参数：Node 22、production、关闭本机账号模式、AI 月预算 100 元。保留服务其他环境变量，没有修改套餐或创建资源。
- GitHub 提交自动触发 Render 部署 `dep-dauhrdvgolkc73e09tfg`，实际提交为 `cbb5c5c9856a797f8cf1f7e167726e1b94ba6fcb`，22:34:11 完成，管理接口状态为 `live`。

| 最新验收项 | 状态 | 证据与范围 |
| --- | --- | --- |
| 新后端实际上线 | PASS | Render live 部署提交与发布 PR 的合并提交一致 |
| 公网存活 | PASS | `/api/health` HTTP 200，返回当前 Supabase 认证和照片 AI 配置状态 |
| 公网源文件版本 | PASS | 22:46 的 `/src/app.js` 与隔离工作区候选逐字节一致；SHA-256 `4dc07f04ed5d763a26f578cc1d45905dab133ec98af93f0444d44b45391f03c5` |
| 旧访问密码错误 | PASS | `/api/ai/budget` 已返回当前云账号的“请先登录”，不再是旧后端“需要访问密码” |
| Supabase 公网认证就绪 | FAIL | `/api/readiness?force=1` HTTP 503、`AUTH_NOT_CONFIGURED`；项目 URL 和客户端密钥缺失 |
| 手机云登录、同步与照片 AI 保存 | NOT RUN | 尚无有效 Supabase 项目配置和真实账号会话 |

自动审批拒绝了把本机现有 DeepSeek API 密钥写入该 Render 服务的操作，原因是缺少对这份敏感凭据和目标服务的明确授权。被拒绝的环境变量更新没有执行；随后成功的更新仅包含上述四个非密钥参数。已单独请求用户授权，不通过其他工具绕过拒绝。

完整访问权限下 Chrome 控制接口仍然连接失败，未取得或读取浏览器登录凭据。本机进程环境与已知 Supabase CLI 凭据位置没有可用管理令牌；本机原项目配置此前探测为 `AUTH_PROJECT_NOT_FOUND`，因此没有将其复制到线上。已在忽略目录准备 `supabase-management.env`，供用户在本机填写实际项目 Ref 和限于该项目的管理令牌；随后可直接使用官方管理 API 核对现有数据库并补齐配置，不依赖 CLI 登录。

### 23:06 Supabase 新格式密钥兼容补修上线

进一步检查发现，原后端将 `sb_publishable_`、`sb_secret_` 新格式密钥同时放入 `Authorization: Bearer`。根据[Supabase 官方密钥文档](https://supabase.com/docs/guides/getting-started/api-keys#known-limitations)，这类密钥应通过 `apikey` 发送；Bearer 用于用户 JWT 和遗留 JWT 密钥。原行为可能使正确的新密钥仍遭到认证拒绝。

- 新增共用请求头构造，覆盖认证就绪、密码登录、服务端管理和 AI 预算 RPC；保留用户 JWT 与遗留密钥请求行为。
- 增加五个接口回归检查；修复前复现三项失败，修复后 Node 22 全部门禁通过，包括 99 文件语法、6 静态校验、单测与覆盖率、Lint、格式及应用回归。
- 修复提交 `b099602f2570d23ca7da1631171a6777c49c65f3` 仅包含五个后端及测试文件。[PR #6](https://github.com/kzh15990053623-ops/male-fat-loss-app-prototype/pull/6)合入 `main`，提交 `403da89914def58490b719d48d29f07a497627f7`；[PR #7](https://github.com/kzh15990053623-ops/male-fat-loss-app-prototype/pull/7)合入实际部署分支 `master`，提交 `4483f01a80a0a1b19e82098b932d01e72305d0af`。两个合并提交文件内容一致。
- 两个 PR 的 CI 全部成功：[PR #6 应用与浏览器](https://github.com/kzh15990053623-ops/male-fat-loss-app-prototype/actions/runs/36733158115)、[PR #6 数据库集成](https://github.com/kzh15990053623-ops/male-fat-loss-app-prototype/actions/runs/36733158270)、[PR #7 应用与浏览器](https://github.com/kzh15990053623-ops/male-fat-loss-app-prototype/actions/runs/36733221522)、[PR #7 数据库集成](https://github.com/kzh15990053623-ops/male-fat-loss-app-prototype/actions/runs/36733221471)。新密钥协议回归使用测试提供方；数据库 CI 使用专用测试环境，仍不代表公网项目验收。
- Render 自动部署 `dep-dauial3bc2fs73cndjng`，实际提交 `4483f01a80a0a1b19e82098b932d01e72305d0af`，23:06:27 完成，管理接口确认 `live`。没有手动触发重复部署。
- 23:08 再次核对公网：`/api/health` HTTP 200；`/api/readiness?force=1` HTTP 503、`AUTH_NOT_CONFIGURED`；`/api/ai/budget` HTTP 401、`请先登录`。新后端已经存活，但有效 Supabase 项目配置仍缺失。

Supabase 实际项目配置与管理令牌仍未提供，DeepSeek 密钥写入仍待明确授权；真实手机云登录、同步和照片确认保存保持 NOT RUN。本机 `supabase-management.env` 的 Ref、令牌和可选账号均为 not configured。补充准备 `inspect-cloud-schema-api.sql`，通过官方管理 API 的只读入口以单个结果核对表、RLS、权限、预算 RPC 和账号数，不读取健康记录。最后一次公网检查原始结果保存在忽略目录 `public-after-release.json`。

## 2026-10-01 已授权 DeepSeek 配置与自动部署

用户明确授权将本机现有 DeepSeek 密钥写入 Render 的 `male-fat-loss-app-prototype` 服务。通过连接器再次核对服务 ID、工作区 ID 和服务名称后，以 `replace: false` 合并更新六个 AI 参数：Endpoint、API key、Model、Protocol、30 秒超时及 100 元月上限。密钥只报告 configured，未写入源代码、文档或 APK。此次授权后的更新已成功执行，上文密钥写入待授权为历史状态。

- Render 自动部署：`dep-daujmom0tbcc73fmqa1g`，实际提交 `4483f01a80a0a1b19e82098b932d01e72305d0af`；北京时间 00:40:38 完成，管理接口状态 `live`。
- 00:42 核对公网 `/api/health`：HTTP 200、`nutritionAiConfigured: true`，确认 AI 运行配置生效；`localAuthEnabled: false`。
- 使用本机当前密钥请求 DeepSeek 官方模型目录：HTTP 200，`deepseek-flash` 存在，实时元数据列出 `text`、`image` 输入。该项确认提供方接受当前密钥及模型支持图片输入，不代表 Render 已完成真实照片调用。接口说明见[DeepSeek 模型目录文档](https://api-docs.deepseek.com/api/list-models/)。
- 公网认证仍为 HTTP 503、`AUTH_NOT_CONFIGURED`；`/api/ai/budget` 仍为 HTTP 401、`请先登录`。Supabase 输入文件仍无项目 Ref 或管理令牌，尚未执行生产数据库迁移或 Supabase 密钥配置。

AI 配置写入、实际部署和提供方密钥核验为 PASS。Supabase 登录就绪为 FAIL；云端持久预算、个人账号权限及手机相机/相册识别确认保存为 NOT RUN，仍需有效 Supabase 项目及账号配置后完成。月上限参数已设置为 100 元，未通过未登录接口验证预算账本。原始核验结果位于忽略目录 `deepseek-config-20261001.json`、`cloud-ai-config-20261001.json`，均不含密钥。

## 2026-10-01 Supabase 已连接、原项目恢复和持久预算联调

用户安装并连接 Supabase 插件后，工具账号绑定已生效；不再需要手填管理令牌，旧的 `supabase-management.env` 流程已作废。原项目 `fitness-fat-loss-app`（`afixmnqtqdafrverwvbh`）与本机配置一致，实际状态为暂停。通过连接器恢复现有项目后，状态已为 `ACTIVE_HEALTHY`，没有创建新项目或修改套餐。

- 将原项目 URL 和有效的新格式 publishable key 合并写入已确认的 Render 服务，未输出密钥值。自动部署 `dep-daujvrg473hc73bhl7jg` 在北京时间 00:59:57 完成，实际提交仍为 `4483f01a80a0a1b19e82098b932d01e72305d0af`。
- 公网 `/api/health` 返回 200、`supabaseConfigured: true`、`nutritionAiConfigured: true`；`/api/readiness?force=1` 返回 200、`AUTH_READY`。实际项目允许注册，并要求邮箱确认。不存在账号的登录请求返回“邮箱或密码不正确”，已不再是云认证配置缺失。
- 先只读核对真实数据库：`app_states` 已存在且强制 RLS，未有预算表或迁移历史；`auth.users` 和保存的云账号记录数均为 0。未读取健康记录。
- 仅补齐缺少的表权限、AI 预算和预算通道迁移。实际迁移版本分别为 `20260930170829`、`20260930170834`、`20260930171731`，名称为 `explicit_app_state_grants`、`nutrition_budget`、`nutrition_budget_gateway`。
- 真实权限核对：匿名角色不能读取 `app_states`；已登录用户仅有自身记录 CRUD，已有所有权 RLS 保留；匿名和已登录角色均不能调用预算 RPC，也不能读取预算通道凭据哈希；预算 RPC 仅对 service-role 开放。
- 部署 `nutrition-budget-gateway` Edge Function v1。函数内部使用 Supabase 平台注入的管理密钥，仅提供预算 `status`、`reserve`、`report`；未导出 Supabase 管理密钥。通过随机 256 位服务端令牌及受 RLS 保护的 SHA-256 哈希鉴权，限制请求体和参数。`verify_jwt: false` 用于该已实现并测试的自定义服务端鉴权。
- 公网通道实际校验：缺失/错误凭据均为 HTTP 401，正确凭据为 HTTP 200，返回云端月度预算。月上限 100 元，初始可用请求数 1000。随后向 Render 写入限定用途的通道令牌，密钥状态只报告 configured；自动部署 `dep-daukcr942hec73eqc3l0` 在北京时间 01:27:48 完成。
- Node 22 全部门禁通过：101 文件语法、6 项静态校验、单测与覆盖率、Lint、格式及应用回归；预算、通道、SQL 针对性检查 32/32 PASS。修复提交 `95f9fd1d20a2a94f27c624b9ddee693164f710cc` 只包含隔离工作区的 11 个后端、迁移、文档及测试文件。
- 使用已发布预算通道、真实 Supabase 账本和真实 DeepSeek 对餐食照片执行一次内部服务端联调：PASS，4093ms，识别米饭、鸡肉、黄瓜/胡萝卜/番茄等配菜，返回 `needsReview: true`。云端账本准确增加 1 次、预留 0.10 元，未退款或重置。该项不覆盖公网 App 账号认证和手机调用。
- Supabase 安全检查没有 ERROR/WARN；两个 INFO 为预算账本/凭据表启用 RLS 而未开放客户端策略，这是服务端专用表的预期限制。说明见[官方 RLS 提示](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)。

原始证据保存在忽略目录 `cloud-auth-restored-20261001.json`、`budget-gateway-acceptance-20261001.json`、`photo-hosted-ledger-20261001.json`，均不含凭据。预算通道令牌的本机私有文件保持忽略，不纳入 Git、文档或 APK。

当前原数据库仍无个人云账号，已询问用户拟使用的注册邮箱，尚未配置个人 Auth UUID 白名单。`adb devices -l` 未检测到连接的手机。公网认证就绪、数据库权限和真实图片/云账本内部联调为 PASS；公网个人账号登录、同步，以及手机相机/相册识别确认保存保持 NOT RUN。不得把 `AUTH_READY` 或内部联调等同于这些验收已完成。

### 01:35 预算通道后端发布完成与最终公网核对

- [PR #8](https://github.com/kzh15990053623-ops/male-fat-loss-app-prototype/pull/8)已合入 `main`，合并提交 `76f34ff0816f21b8c45416d432c8da6717161c6a`；[PR #9](https://github.com/kzh15990053623-ops/male-fat-loss-app-prototype/pull/9)已合入实际部署分支 `master`，提交 `55602434ef06d531019601361c208ac187d6c230`。两个分支文件内容一致，隔离工作区干净，原工作区未提交改动保持原样。
- 四项 CI 全部成功：[PR #8 应用检查](https://github.com/kzh15990053623-ops/male-fat-loss-app-prototype/actions/runs/36750869228)、[PR #8 数据库集成](https://github.com/kzh15990053623-ops/male-fat-loss-app-prototype/actions/runs/36750869360)、[PR #9 应用检查](https://github.com/kzh15990053623-ops/male-fat-loss-app-prototype/actions/runs/36751365865)、[PR #9 数据库集成](https://github.com/kzh15990053623-ops/male-fat-loss-app-prototype/actions/runs/36751366043)。
- Render 随提交自动部署 `dep-daukfnbm8hqs738mtvjg`，实际提交与 `master` 一致，在北京时间 01:33:48 完成并确认 `live`。没有手动触发重复部署。
- 01:35 最终公网检查：健康接口 200，Supabase 和 AI 配置均生效；认证就绪接口 200、`AUTH_READY`；未登录预算接口 401、`请先登录`。原项目匿名请求 app-state 表、凭据哈希表和预算 RPC 均为 401、权限拒绝 `42501`。
- 云端预算状态 HTTP 200：2026-10 月上限 100 元、已预留 0.10 元、请求数 1、未报告数 0、剩余 999 次；估算费用 0.004446 元是 token 计价估算，不能视为提供方最终账单。最终公网原始证据为 `cloud-final-20261001.json`。

本轮可独立完成的服务、数据库、代码和 AI 联调均已发布并验证。个人账号邮箱尚未收到；云账号创建/验证及 UUID 白名单、真实 App 登录同步与手机拍照保存仍待完成。当前既有 APK 的云 API 地址仍指向本次已修复服务，照片调用字段与后端接口一致；没有清除手机档案、覆盖云记录或重装 APK。

### 01:53 临时账号完成真实公网登录、同步与照片接口验收

进一步用独立临时测试账号完成了公网认证后的验收。账号通过 Supabase [服务端创建用户 API](https://supabase.com/docs/reference/javascript/auth-admin-createuser)建立，只使用随机的保留域名测试邮箱及随机密码，不向任何邮箱发送邮件。临时辅助函数限定固定测试邮箱，并用另一份随机服务端凭据鉴权；Supabase 管理密钥始终留在平台函数内部。没有修改全局邮箱确认策略或用户健康记录。

| 公网验收项 | 状态 | 实际结果与范围 |
| --- | --- | --- |
| 邮箱密码登录 | PASS | Render `/api/auth/login` 200，返回真实 Supabase 用户会话；测试账号由服务端预确认，不覆盖用户邮箱收信验证 |
| 刷新令牌边界 | PASS | JSON 不含刷新令牌；Cookie 的 HttpOnly、Secure、SameSite=Lax 均生效 |
| 云端状态读取与保存 | PASS | 新测试账号初始版本 0；写入合成测试状态后，公网读取值一致且版本为 1 |
| 会话刷新 | PASS | `/api/auth/refresh` 使用 Cookie 成功返回相同测试账号的新会话 |
| 公网照片识别 | PASS | `/api/ai/nutrition` 200，5825ms；纯照片识别米饭、鸡腿肉和蔬菜，`source: model`、`inputMode: photo`、`needsReview: true` |
| 公网持久预算扣记 | PASS | `/api/ai/budget` 调用前后增加 1 次和 0.10 元；含先前内部联调，月累计 2 次、预留 0.20 元、剩余 998 次，未报告数 0 |
| 测试账号及记录清理 | PASS | 先退出会话，再通过[服务端删除用户 API](https://supabase.com/docs/reference/javascript/auth-admin-deleteuser)仅删除本轮测试账号；其合成云记录级联删除，两者计数均为 0；删除后的会话请求被拒绝 |
| 临时权限和辅助接口撤回 | PASS | Render 的临时测试 UUID 白名单已清空；辅助函数 v2 为无管理操作的 410 返回体，并开启 JWT 校验；原创建凭据无法再创建用户，本机临时密码/会话/令牌已移除 |
| 个人账号、真实手机使用 | NOT RUN | 个人注册邮箱尚未收到；ADB 未连接，未验证手机登录、同步选择、相机/相册权限和确认保存 |

撤回临时白名单后，Render 自动部署 `dep-dauko7flk1mc73d999ng` 在北京时间 01:51:54 完成并确认 `live`，提交仍为 `55602434ef06d531019601361c208ac187d6c230`。01:53 公网再次确认健康接口 200、认证 `AUTH_READY`，真实预算路径 `/api/ai/budget` 对未登录请求返回 401。辅助接口实测为 HTTP 410。真实数据库中的账号总数仍为 0，临时账号和其记录无残留；预算保留已真实派发请求的预留，不退款或清零。

本轮原始证据为 `cloud-account-acceptance-20261001.json`、`photo-render-api-20261001.json`、`cloud-fixture-cleanup-20261001.json` 和 `cloud-final-after-account-20261001.json`，均保存在忽略目录且不含凭据。以上结果覆盖真实公网后端链路，但个人账号注册/绑定和手机 UI 验收仍需继续完成。
