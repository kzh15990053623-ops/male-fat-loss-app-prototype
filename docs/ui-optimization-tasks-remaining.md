> **历史快照（2026-08-19）**：本文档是特定阶段的方案/审计记录，文中测试数量与文件结构等口径已过时。当前权威口径见根目录 `README.md`（命令与测试说明）与 `docs/optimization-review-20260825.md`（架构与优化进度）。

# 稳减 App · UI 优化剩余任务书（P0b–P4）

> 交接对象：执行 AI（无历史会话上下文，本文档自包含）
> 基线文档：`docs/ui-optimization-plan-final.md`（最终方案，P0a 已完成并通过 17/17 测试）
> 当前状态：2026-08-19，工作树有未提交改动，P0a 与"认证就绪/本机账号"特性混在同一批文件中
> 每批独立成切片，完成一批验收一批，禁止跨批合并改动

---

## 0. 项目背景（执行前必读）

**技术栈**
- 渐进式原生 ES Module（无前端框架），分层 CSS：`src/styles/tokens.css` → `base.css` → `components.css` → `pages.css`
- 核心文件：`src/app-render.js`（1037 行渲染）、`src/app-actions.js`（1214 行交互）、`src/app-state.js`（状态）、`src/app-sync.js`（同步）
- Node 静态服务 + Supabase；PWA（manifest + sw.js）

**硬约束（违反任何一条即返工）**
1. 零运行时依赖：不引入任何图表库/动画库/UI 框架
2. 只做浅色主题，深色模式不在范围
3. 320–430px 视口可用，44px 触控目标，safe-area 适配保持
4. 所有动画必须在 `prefers-reduced-motion: reduce` 下完全降级（全局规则已在 base.css:293）
5. 不修改认证边界、Supabase RLS、营养 AI 合同、持久化 schema、服务端 API
6. 视觉基准只有 390×844（`tests/visual/__screenshots__/`）；320/430 是 DOM 布局门禁不是截图
7. 快照更新规则：先跑测试看 actual/diff，人工审阅差异属于本批意图内变化后，才允许针对性 `--update-snapshots`；**禁止批量更新全部快照**
8. 不清理工作树、不重置用户改动、不自动提交、不批量格式化无关文件

**验证命令（Windows）**
```
npm.cmd run check          # 语法 + 数据模型/认证/营养合同/回归脚本
npm.cmd run test:e2e       # 17 个 Playwright 用例
npm.cmd run verify         # check + e2e 全链路
```

---

## 优先级 0 · 提交前工作树拆分（阻塞项，最先做）

当前未暂存改动中，P0a（UI 校准）与"认证就绪/本机账号"特性（auth readiness）交织在同一批文件里，主要是：
- `src/app-render.js`：diff 同时含 auth-service-notice 与 toggle-switch/训练页改动
- `src/styles/components.css`：同时含 auth 通知样式与 switch 样式
- `tests/dom/app-dom.spec.mjs`：新增 5 个用例中 3 个属认证特性
- 另有整块属于认证特性的文件：`server/supabase.mjs`、`server/local-auth.mjs`（untracked）、`src/app-actions.js`、`src/app-state.js`、`scripts/validate-*.mjs`、`docs/auth-reliability.md`

**任务**
- [ ] 与用户确认提交策略：A) `git add -p` 逐块拆成两个 commit（推荐）；B) 接受合并提交，commit message 写明双特性
- [ ] 拆分后分别跑 `npm.cmd run verify` 确认两个 commit 各自可独立通过（若拆分成本过高，走 B 方案并说明）
- [ ] 顺手修订 `docs/ui-optimization-plan-final.md` P0a 执行结果段：注明"DOM 新增 5 例中 3 例属认证特性"

---

## 优先级 1 · P0b 可读性与组件层级（约半天，风险最低）

**任务清单**
- [ ] 字号审计：全站现存 36 处 0.6–0.68rem（`src/styles/components.css` 与 `pages.css`）。按四类分类处理，不做无差别全局替换：
  - 正文/辅助正文（用户必读）：提到 ≥0.75rem（12px）
  - 单位（kcal/kg/cm）：可紧凑，但不得成为唯一标签
  - 装饰眉题（.eyebrow 英文）：留给 P1 处理，本轮不动
- [ ] 半透明卡片改实色：`components.css` 约 236 行 `background: rgba(250, 249, 244, 0.76)` → `var(--paper-2)`，加 `box-shadow: var(--shadow-soft)` 轻投影；边框只保留给 hover/选中/危险态
- [ ] 空态改造：当前 dashed 边框工程占位（`.empty-state`）→ 一句话陪伴文案 + 主行动按钮（例：「还没有记录，吃下第一口前先来记一笔？」），不引入新插画资产
- [ ] 顺手收敛：switch 关闭态轨道硬编码色 `#c9d0cf`、焦点环 `rgba(22,167,125,0.22)` 等收进 `tokens.css`
- [ ] 顺手观感：设置页 `.toggle-row` 开关行高与相邻输入行（约 52px）对齐，消除节奏差
- [ ] 新增回归断言：五页 empty/partial/full 三数据态无截断、遮挡、横向溢出（可扩展现有 `tests/dom/app-dom.spec.mjs` 的三档视口用例）

**验收**
- `npm.cmd run verify` 全绿
- 视觉基准 diff 全部属于意图内（卡片实色化会改动多页，逐张审阅后更新）
- 手动抽查 390 截图：无"发虚"卡片、空态有明确主行动

---

## 优先级 2 · P1 品牌语言与页面节奏（约 1–2 天，工作量最大）

**任务清单**
- [ ] 文案全量迁移（页面标题，位置在 `app-render.js` 的 `pageHeader()` 调用处）：
  - 今日实验 → 今天（:382）
  - 饮食实验 → 好好吃饭（:262）
  - 训练实验 → 动起来（:640）
  - 数据实验 → 你的进步（:724）
  - 个人实验档案 → 我的（:781）
  - 登录页眉题（:206「建立个人实验档案/继续你的减脂实验」）→ 陪伴式文案
- [ ] 清理全部英文装饰眉题（实际盘点远超 10 处）：`BODY / 01`、`TODAY / FOCUS`、`TODAY / SESSION`、`QUICK CAPTURE`、`ACTIVITY / LOG`、`LIBRARY`、`NUTRITION / MODEL`、`SUBJECT / PERSONAL`、`DATA / CONTROL`、`CONTROL / SETTINGS`、`LOCAL / DEVICE` 等。原则：全站清到 0–2 处；模型透明度（`model-badge` 的 AI MODEL 标识）、单位、必要缩写保留
- [ ] 首页 hero 重构（关键改动，先写测试再动代码）：
  - 进度环语义从"总目标完成度"（当前基准 32%）改为「本周完成度」快节奏正反馈
  - 长期总目标进度挪到「我的」页
  - **先写测试**：本周完成度计算公式、周起始日、零数据态（新用户无记录时不得显示 0%）
  - hero 底部三格数据（剩余/摄入/消耗）拆出深色卡，改浅色 strip
- [ ] 四页 hero 节奏差异化：饮食页输入区改浅色+绿色左边条、深色只留 AI 结果卡；训练页今日卡用 `--green → --signal` 渐变替代深蓝黑；数据页趋势解读卡保留深色不动
- [ ] 同步更新：`index.html`（title/meta）、`manifest.webmanifest`、`README.md`、`tests/` 中所有语义断言（`expectedHeadings` 等硬编码标题）、视觉基准

**验收**
- 全站搜索"实验/实验室"仅剩必要技术上下文；英文眉题 ≤2 处
- 五页首屏视觉锚点不重复；主要任务两次操作内可达
- 业务数据、导航目标、表单合同不变（E2E 全绿即证明）
- `npm.cmd run verify` 全绿 + 基准逐张审阅更新

---

## 优先级 3 · P2 反馈、加载与完成时刻（约 1–2 天）

**任务清单**
- [ ] 修复淡入范围：`.app-surface` 的 `page-enter` 动画（base.css:188）目前所有重渲染都触发。改为只在真实 Tab 切换时入场；字段更新、toast 弹出等局部重渲染不重复入场
- [ ] 异步按钮加载态盘点：找出所有无 loading/disabled/aria-busy 的异步操作按钮，统一 spinner + 文案切换规则（如「保存中…」），消除"点击无反应→toast"断档
- [ ] 打卡庆祝：「今日三件事」打勾局部回弹（check scale 弹跳 + 卡片 200ms 绿色呼吸）；三件事全部完成时的全屏庆祝每日最多一次、可跳过
- [ ] 数字动效：首页 hero 数字 count-up（300–500ms，requestAnimationFrame 自实现，reduced-motion 下直接显示终值）
- [ ] 触感：`navigator.vibrate?.(10)` 可选链调用（注意：不可用环境直接调用会抛 TypeError，必须能力检测），仅作为增强，失败不得影响保存主流程
- [ ] 连击徽章：「连续记录 · DAY N」强化为视觉资产；断签前一天温柔提醒，不做惩罚性文案
- [ ] AI 识别取消：前置条件是引入 AbortController + 迟到响应丢弃 + 草稿保留三套测试，未满足前不落地

**验收**
- reduced-motion 下无明显位移/缩放/持续闪烁（复用现有 [11/17] 行为用例扩展断言）
- 重复点击不产生重复记录；加载/成功/失败/取消均有可访问状态（aria-live）

---

## 优先级 4 · P3 同步状态与数据图表（约 1–2 天）

**任务清单**
- [ ] 落地七态矩阵（当前 `components.css:41-57` 四态共用橙色，需拆分）：

| 状态 | 文案 | 视觉 | 操作 |
|---|---|---|---|
| idle | 等待登录 | 灰点 | 无 |
| connecting | 连接中… | 橙点呼吸 | 无 |
| saving | 保存中… | 橙点呼吸 | 无 |
| online | 已同步 | 绿点 | 可选查看时间 |
| device | 本机模式 | 蓝灰点 | 无 |
| local | 已存本机，等待同步 | 橙点 | 真按钮「重试」 |
| offline | 当前离线 | 灰/红按错误类型 | 真按钮「重试」 |

  - 「重试」必须是真实 `<button>`，支持键盘和清晰焦点
  - 未捕获本地写入异常前，不得笼统承诺「数据安全」
- [ ] 图表升级：折线数据从纯数值升级为 `{ date, value }`（涉及 `app-logic.js` 的 series 函数）
- [ ] 选点交互：触摸/鼠标/键盘统一选点，tooltip 含日期+数值+单位，提供屏幕阅读器等价文本（aria-live）
- [ ] 折线入场描边动画（stroke-dashoffset），reduced-motion 降级为直接显示

**验收**
- 七态各自可触发且视觉/文案/操作正确（每态至少一个 DOM 断言）
- 图表选点键盘可达，tooltip 有 SR 等价物
- 零依赖保持，`npm.cmd run verify` 全绿

---

## 优先级 5 · P4 工程门禁与可选探索（约半天）

**任务清单**
- [ ] axe-core 接入 Playwright（`@axe-core/playwright`），新增 `npm.cmd run test:a11y` 并纳入 `verify` 链路。**注意：不能接进 `npm run check`**（那是纯 Node 无 DOM）；首期扫描五主页面+设置弹层+登录+首次设置，阻断 serious/critical，豁免必须写明理由
- [ ] 视觉基准扩档：维持 390 全量；320/430 只对高风险首屏（首页 hero、饮食 AI 输入）补截图，避免快照爆炸
- [ ] 可选项（明确标记为可选，用户点头才做）：
  - 下拉刷新：先定义它是"触发同步"还是"整页刷新"，验证与浏览器/PWA 手势不冲突
  - 长按复制餐食到今日：必须有可发现的按钮或菜单作为主入口，长按只是附加，需键盘等价操作
  - skeleton shimmer 扫光

---

## 每批统一验收协议

1. 记录改动前 `git status --short`，只触碰本批列明的文件
2. `npm.cmd run check`
3. 跑相关 Playwright 用例；视觉用例先允许失败，人工审阅 actual/diff
4. 确认差异属意图内后，针对性 `--update-snapshots`
5. 完整 `npm.cmd run verify`
6. 再次 `git status` + diff，向用户报告：已验证 / 未验证 / 阻塞项

**禁止**：清理工作树、重置用户改动、批量格式化、自动提交、全量快照更新、宣称未完成的批次为已完成。
