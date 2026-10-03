# 热量概览说明与 Android 1.2.1 交付

日期：2026-10-02。此交付解决首页只有摄入、运动、剩余三个数字，用户无法判断预算来源与全天消耗的问题。

## 页面变化

- 首页、饮食汇总和数据页统一展示预估全天总消耗、全天饮食预算、预算剩余（或预算已超出）、已记录摄入和运动消耗。
- 直接展示预算与摄入的算式；超出预算时显示正数与“已超出”，不把负数当作还能吃的额度。
- 点击“计算说明”可查看基础代谢、活动系数、目标每日缺口、自动建议预算以及当前已保存预算形成的计划缺口。支持键盘 Space 展开。
- 说明明确：运动参与活动水平的估算，不直接加回饮食预算；预算剩余不是减脂缺口，也无需刻意吃完。
- “我的”页统一估算用语，基础资料不完整时显示“待完善”，并禁用应用无效建议的按钮。
- 首页“本周行动”移到记录卡，与饮食、训练、喝水的行动入口对应；三个记录入口在 320/390/430px、740px 高的首屏仍可点击。

本次沿用现有估算公式和已经保存的预算。自动估算仍使用男性基础代谢公式与运动量分档，页面已注明估算依据与限制。

## 安装包与截图

- 安装包：[wenjian-1.2.1-20261002-energy-budget.apk](../output/apk/wenjian-1.2.1-20261002-energy-budget.apk)
- 首页示例：[home-390.png](../output/playwright/energy-budget-20261001/home-390.png)
- 计算说明展开：[home-explanation-390.png](../output/playwright/energy-budget-20261001/home-explanation-390.png)
- 超出预算：[home-over-budget-430.png](../output/playwright/energy-budget-20261001/home-over-budget-430.png)

截图来自隔离浏览器中的测试档案。预算 1811、摄入 1000、运动 472 与用户截图一致；身高、年龄、基础代谢和由此生成的全天消耗是测试数据，不是对用户本人总消耗的确认。

包名 `com.wenjian.healthledger`，版本 `1.2.1`，versionCode `4`。文件大小 17,327,837 字节，SHA-256：

```text
9C101D3CD10DA44D134C892BC2BB91225257A3F57421923CAB003714E44354AE
```

应用壳版本 `20261002-2`，Service Worker 缓存代号 `v30`。

## 验证记录

| 验证项 | 结果 | 证据 |
| --- | --- | --- |
| 完整开发门禁：语法、静态校验、单测与覆盖率、ESLint、Prettier、应用回归 | PASS | `output/playwright/energy-budget-20261001/validation/final-verify.log` |
| Windows 浏览器测试 | PASS，90/90 | 同上 |
| Linux 视觉回归 | PASS，11/11 | `output/playwright/energy-budget-20261001/validation/linux-final-visual.log` |
| 首屏记录入口、320/390/430px 布局、无横向溢出 | PASS | 既有 DOM 回归与专项浏览器检查 |
| 三页计算说明键盘展开、运动更新估算但不增加预算、超预算与缺少资料状态 | PASS，14 项 | `output/playwright/energy-budget-20261001/validation/energy-behavior-results.json` |
| Android APK 构建 | PASS | `output/playwright/energy-budget-20261001/validation/android-build.log` |
| 24 个网页资源在构建目录、Android assets、APK 内 SHA-256 一致 | PASS | `output/playwright/energy-budget-20261001/validation/apk-validation.json` |
| APK 包名、版本与签名验证 | PASS | Android SDK aapt / apksigner |
| 本轮真机覆盖安装与操作复测 | NOT RUN | 本轮交付为源码、浏览器验证与 APK |

Windows 与 Linux 的首页 390/320px 和数据页截图均先审阅实际图与差异，再仅更新这三张基线；未调整截图容差。生成的浏览器调试文件与测试输出加入工具忽略目录，应用源代码继续参与完整检查。
