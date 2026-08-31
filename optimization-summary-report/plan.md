# Report Plan

## Meta
- **Type**: 技术总结报告（工程改造复盘）
- **Topic**: 稳减 PWA 五批架构优化与工程化改造总结（2026-08）
- **Audience**: 项目维护者 / 技术评审者
- **Language**: 中文

## Design System
- **Palette**: bg `#f5f7f8` / surface `#ffffff` / ink `#16232e` / muted `#5c6b78` / rule `#dce3e8` / accent `#0e7490`（深青） / accent2 `#b45309`（琥珀）
- **Typography**: 标题 WorkSans + 系统中文黑体；正文系统中文栈；等宽 JetBrainsMono（数字/代码）。层级用字号+字重+留白
- **Layout**: 960px 居中单栏；章节 4rem 大间距；顶部紧凑封面 + KPI 仪表盘；打印友好
- **Components**: h2 带左侧序号+下边框；卡片白底 1px rule；统计卡片大数字等宽字体 accent 色；表格极简横线
- **Personality**: 冷峻技术审计报告——石板蓝主色、等宽数字、数据卡片与结构图密集，装饰克制

## Structure
1. 概述与方法论（审阅先行、门禁先行、批次推进）
2. 总体成效（KPI 卡片 + 批次一览）
3. 第一批：安全加固（转义统一/HSTS/CSP/限流/scrypt）
4. 第二批：性能优化（异步 IO/Brotli/modulepreload）
5. 第三批：渲染局部化（按页短路/基线比对/焦点恢复）
6. 第四批：架构拆分（Mermaid 架构图 + 行数收敛图）
7. 第五批：工程化（门禁链路图 + 测试规模图）
8. 质量保障与验证（118 项自动化检查矩阵）
9. 经验沉淀（7 条教训）
10. 展望

## Visuals
| Visual | Type | Tool |
|--------|------|------|
| 前端模块架构图 | flowchart | Mermaid |
| app-actions 收敛 + 模块行数分布 | 横向条形图 | ECharts |
| 测试与门禁规模 | 柱状图 | ECharts |
| run-gates 门禁调度 | flowchart | Mermaid |

## Key Facts（实证数据）
- 5 批 / 约 20 子项 / 14 个新模块；app-actions.js 1892→448 行；最大模块 603 行
- ESLint 131→0；Prettier 52 文件；语法自动发现 56 文件
- vitest 64 + e2e 54（含 9 视觉基线）= 118 项
- scrypt N=2^15 中位 81ms；SW v13→v14；CI 双 job 并行
