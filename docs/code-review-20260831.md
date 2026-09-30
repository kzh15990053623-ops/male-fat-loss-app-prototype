# 代码审阅报告（2026-08-31）

> 审阅方式：三路并行审阅（服务端 / 前端核心 / 工程基础设施）+ 逐项人工核实。
> 本报告是事实记录，不是本轮执行指令；本轮按用户指定的修正版范围实施，并保留工作树中的既有改动。

## 〇、最终验证概览

- `npm.cmd run check` 六阶段全绿：语法（73 文件）/ 静态校验（6 项）/ vitest+coverage / eslint / prettier / 应用回归门禁。
- 最终 `npm.cmd run test:unit`：13 个测试文件、162 个测试通过。
- 最终 `npm.cmd run test:e2e`：60 个 Playwright 测试通过，其中包含 11 个视觉测试。
- 本轮实际完成：R1、R3、R4、R6、R7、R8、R9。
- 本轮未执行：R2、R5；两项均调整为可选增强。R10 不再作为问题处理，也未执行顺序重排或顺序校验增强。

## 一、问题清单与本轮状态

| 编号 | 原级别 | 本轮状态 | 结论 |
|------|--------|----------|------|
| R1 | P1 | 已完成 | 首页连续记录天数从 `dailyRecords` 派生，真实有效记录日可正常增长 |
| R2 | P2 | 可选增强，未执行 | 不做本轮大范围 render 信任边界重构 |
| R3 | P2 | 已完成 | 主模块注册幂等的 SIGTERM/SIGINT 优雅关闭 |
| R4 | P2 | 已完成 | 停止通用运行时写缓存，保留 network-first 与离线回退 |
| R5 | P2 | 可选增强，未执行 | 保持 Vitest 纯逻辑与 Playwright DOM 分层覆盖策略 |
| R6 | P3 | 已完成 | 补充两个本地工具目录的 ignore 规则 |
| R7 | P3 | 已完成 | .env 解析支持行内注释、引号内 `#` 与空字符串环境变量 |
| R8 | P3 | 已完成 | `locale` 固定为 `zh-CN` |
| R9 | P3 | 已完成 | 创建新 access session 前惰性清扫过期项 |
| R10 | P3 | 不构成问题，未执行 | 保持集合一致校验，不要求 modulepreload 与 APP_SHELL 顺序一致 |

---

## 二、本轮实际完成项

### R1（P1）连续记录天数改为从有效 daily record 派生

- 在 `src/app-logic.js` 新增并导出纯函数 `computeStreak(dailyRecords, today = todayKey())`。
- 有效记录日复用并细化 `hasDailyRecordData()`：饮食摄入、消耗、饮水、步数、睡眠、有效体重/腰围、已完成训练或有效任务覆写等实际数据满足其一才计入；空对象、空白 daily record 不计入。
- 今天有有效记录时从今天向前计算；今天无有效记录时从昨天开始；遇到第一个无效日立即停止。
- 日期递减使用经过校验的 `YYYY-MM-DD` 与 UTC 运算，覆盖跨月、跨年且不受本地 DST 影响。
- `src/app-data.js` 的 `DAILY_RECORD_LIMIT` 仍为 180；连续计算使用当前 `dailyRecords`，结果自然受最近 180 天窗口限制。
- 首页直接对 `state.dailyRecords` 调用 `computeStreak()` 渲染徽章，不把派生值写回业务状态。
- 删除生产初始状态中的 `streak`、`bestStreak`；`persistedStateFrom()` 也显式剔除这两个字段，因此历史载荷中的值不会继续回传云端。
- 更新 fixture，不再直接写 `state.streak` 伪造功能。完整 fixture 的 7 个连续有效记录日现在渲染为「连续记录 7 天」。
- 新增单元测试覆盖：空记录、今天截止连续 3 天、今天为空而昨天截止连续 2 天、中间断日、空白 record、跨月、跨年，以及历史持久化 streak 值不影响派生结果。

### R3（P2）可测试的优雅关闭

- 新增 `server/shutdown.mjs`，将 process/server/timer/强退函数/日志注入为可测试的小生命周期函数。
- 仅在 `server.mjs` 的主模块启动分支注册 SIGTERM、SIGINT；导入 `startServer` 不注册全局监听器。
- 第一个信号立即调用 `server.close()` 停止接收新请求，并调用可用的 `closeIdleConnections()`；重复信号不会重复关闭或重复创建定时器。
- 强制关闭窗口为 55 秒，等待进行中的请求完成；正常 close 会清理 timer、设置成功退出状态并自然结束进程；超时或 close 错误会尝试 `closeAllConnections()`、记录失败并以失败状态强退。
- `render.yaml` 增加 `maxShutdownDelaySeconds: 60`，覆盖当前最长 45 秒请求时限并为 Render 的 SIGKILL 留出窗口。
- 单元测试覆盖信号注册、重复信号、正常 close 清理 timer、超时强退和无全局监听器导入。

### R4（P2）Service Worker 收敛运行时缓存

- 删除 `sw.js` 中 fetch 成功后的通用 `cache.put()` 运行时写入。
- 保留同源、非 API、GET 请求的 network-first 行为，以及网络失败时对 APP_SHELL 的 `caches.match(request)` 回退。
- 不新增独立 runtime cache，也不实现 FIFO/LRU；安装阶段仍通过 `event.waitUntil()` 完成 APP_SHELL 缓存。
- PWA 测试验证应用壳安装后可离线启动、任意 query 变体不会持续写入壳缓存、API 请求不进入缓存。
- 版本戳由 `npm.cmd run bump:version` 统一更新 `index.html`、`sw.js` 和 `CACHE_NAME`；未手工拆改版本位置。

### R6（P3）补充 `.gitignore`

仅追加以下规则，未删除目录或目录内容：

```gitignore
.trae-html-share-packages/
.workbuddy/
```

### R7（P3）可测试的 .env 解析边界

- 新增 `server/env.mjs`，将解析、应用到目标环境对象、文件读取分别提取为可测试函数；`server/config.mjs` 通过该模块加载项目 `.env`。
- 未加引号值支持 `KEY=value # comment`；紧邻值的 `#` 保留；引号内的 `#` 保留。
- 目标环境中只要 key 已定义，即使值是空字符串，也不会被 `.env` 覆盖；只有 `undefined` 才允许填充。
- 测试使用纯字符串、独立 targetEnv 与临时文件，不读取或写入真实项目根 `.env`。

### R8（P3）固定中文 locale

`server/api.mjs` 中无效三元表达式已简化为：

```js
locale: "zh-CN"
```

当前 prompt、缓存和契约测试只支持中文，因此本轮不开放 `en-US`。

### R9（P3）惰性清扫过期 access session

- 新增 `server/session.mjs` 的 `clearExpiredAccessSessions(accessSessions, now)`。
- `issueSession()` 在创建新会话前使用同一个 `now` 删除 `expiresAt <= now` 的 access session。
- 未新增 `setInterval`，也不声称 Map 获得硬容量上限。
- 单元测试验证未过期条目保留、过期条目删除。

---

## 三、未执行项与边界

### R2（可选增强，未执行）

本轮不按原报告机械地为 `pageHeader` subtitle 套 `escapeHtml`，也不对整个 render 层做大范围信任边界重构。该项保留为后续可选增强。

### R5（可选增强，未执行）

本轮不把所有 render/actions 模块纳入 Node coverage，不调整 `vitest.config.mjs` 的覆盖范围与阈值。当前继续采用 Vitest 覆盖纯逻辑、Playwright 覆盖 DOM 模块的分层策略。

### R10（不是问题，未执行）

`index.html` modulepreload 与 `sw.js` APP_SHELL 继续做集合、重复、遗漏和陈旧项校验；本轮不要求两者顺序一致，不重排 APP_SHELL，也不新增顺序断言。

---

## 四、视觉回归记录

- 先以不更新基线的方式检查 actual/diff；确认差异仅来自 R1 首页徽章由「连续记录 6 天」变为派生的「连续记录 7 天」后，才更新受影响场景。
- 已更新的具体基线文件：
  - `tests/visual/__screenshots__/03-home-390.png`
  - `tests/visual/__screenshots__/03-home-320.png`
- `tests/visual/__screenshots__/08-settings-390.png` 已检查且无 R1 相关差异，未更新。
- 更新后全量视觉测试为 11/11 通过；未执行全仓批量 `update-snapshots`。

---

## 五、项目约束与未验证边界

1. CSP `style-src`、动态样式走 `data-*` + CSSOM、静态服务压缩/ETag 等既有约束未改变。
2. 本轮未执行 R2 的全量 HTML 插值转义重构，也未执行 R5 的 coverage 扩围。
3. 本地测试没有伪造远端 CI、真实 Supabase/RLS 或 Render 部署验证结果；这些仍属于未验证边界。
4. R3 的信号生命周期通过注入式单元测试验证，未声称已在真实 Render 进程中收到信号并完成线上请求排空。
5. 最终测试数量以本轮命令输出为准：Vitest 13 个文件/162 个测试；Playwright 全量 60 个测试（含视觉 11 个）。不再使用旧的 75 + 44 + 11 口径。

---

## 六、实际验证命令与结果

```text
npm.cmd run test:unit
  Test Files  13 passed (13)
  Tests       162 passed (162)

npm.cmd exec -- playwright test tests/dom/ui-upgrades.spec.mjs
  7 passed

npm.cmd exec -- playwright test tests/e2e/pwa.spec.mjs
  2 passed

npm.cmd exec -- playwright test tests/visual
  11 passed

npm.cmd run test:e2e
  60 passed

npm.cmd run check
  语法检查 73 项 / 静态校验 6 项 / vitest+coverage / eslint / prettier / 应用回归门禁全部通过

npm.cmd run verify
  最终版本与基线处理完成后连续 3 轮通过
```

版本 bump、最终三轮 verify、`git diff --check`、测试端口残留检查和当前 `git status` 结果在本轮收尾记录中确认；未暂存、未提交、未推送、未部署。
