# Android 1.2 真机复测记录

测试日期：2026-09-30。范围：五页分区 UI 更新、同签名覆盖安装、图表交互及离线记录恢复。

## 结论

最终 APK 已安装在三星 SM-N9860（Android 12）上。五页分区、页面配色、导航、设置和确认弹层显示正常，横竖屏均无横向溢出。实测发现的趋势线尾部间隙和选中标记偏移已修复，并重新出包、覆盖安装和复测。

手机原有记录在升级前、最终升级后及测试恢复后的指纹完全一致。临时饮水记录已撤回，网络和屏幕设置已恢复。

同日补测云同步和 AI：真实模型文字调用通过，手机云账号连接被公网认证就绪接口的 `401「需要访问密码」` 阻止。跨设备同步、手机端 AI 和照片识别仍未完成，详见[云同步与 AI 实测记录](cloud-ai-device-20260930.md)。下表保留本轮 UI 验收范围。

## 最终安装包

- [下载本次验收 APK](../android/app/build/outputs/apk/debug/wenjian-1.2-20260930-47DE92E0.apk)
- 手机位置：`Download/wenjian-1.2-20260930-47DE92E0.apk`。
- 包名：`com.wenjian.healthledger`；版本：`1.2`；版本码：`3`；调试签名。
- 文件大小：17,327,172 字节；构建产物时间：2026-09-30 11:44。
- SHA-256：`47DE92E0F5DB4305757E86145CF26525D89D6A43896854A1F2DDEB88C55601A7`。
- Web 资源版本：`20260930-1`；SW 缓存：`fitness-fat-loss-app-shell-v27`。
- 手机实际加载：`index.native-BLcRNF85.js`、`index-D7RfINrT.css`。
- 24 个网页资源在 `dist-android`、Android assets、APK 内逐一校验一致；手机 Downloads 中 APK 哈希也一致。

此前 `E2C4407E…` 的 1.2 APK 是图表修复前的产物；本次交付使用上述 `47DE92E0…` 包。

## 环境与结果

设备 WebView：`com.google.android.webview` 148.0.7778.178。物理屏幕 1440×3088，当前系统渲染尺寸 1080×2316。WebView 实测竖屏 411×856、横屏 856×387 CSS px。

| 项目 | 结果 | 证据与范围 |
| --- | --- | --- |
| Windows 完整验证 | PASS | 修复后 `npm.cmd run verify`：111 文件语法、6 项静态校验、单测覆盖率、ESLint、Prettier、回归门禁及 90/90 浏览器检查 |
| Linux 浏览器检查 | PASS | 修复后在现有 WSL Ubuntu 执行，90/90；含 8 项无障碍、11 项视觉检查 |
| 视觉基准 | PASS | 两个平台沿用已有基准和阈值，本轮未更新基准；另审阅实际手机截图 |
| Android 构建 | PASS | JDK 21，`npm.cmd run android:apk`，`BUILD SUCCESSFUL` |
| 覆盖升级 | PASS | 1.1 覆盖安装至 1.2，随后覆盖安装最终修复包；原持久化记录指纹一致 |
| 五页布局与滚动 | PASS | 横竖屏各五页，首屏与底部共 20 张截图；页面宽度与视口一致，固定导航可见 |
| 分区与配色 | PASS | 概览暖木色、表单/图表白底细边框、建议浅纸色；五页导航与页头使用各自配色 |
| 标题字体 | PASS | 手机实际标题字体为系统 `Noto Serif CJK SC`；未捆绑字体 |
| 图表显示及触摸 | PASS | 三张趋势图保留独立渐变 ID；实际触摸显示数值；最终绘制为完整实线，圆点与触摸标记位置误差小于 0.01 CSS px |
| 设置与确认弹层 | PASS | 设置固定保存按钮可见；清空确认显示后取消，未执行删除 |
| Android 返回键 | PASS（最终复测） | 曾一次未关闭设置，随后再次按键可关闭；重新打开设置后单次返回复测通过，仍需观察偶发情况 |
| 离线冷启动 | PASS | 最终包飞行模式开启、Wi-Fi 关闭，系统无默认网络；强制结束后启动成功，Activity TotalTime 752ms |
| 离线保存与恢复 | PASS | 从界面临时增加 200ml；SQLite 保存后强制结束、冷启动、WebView 重载均恢复 200ml |
| 测试后恢复 | PASS | 原记录指纹一致；飞行模式关闭、Wi-Fi 开启、竖屏锁定、系统夜间模式关闭，与测试前一致 |
| 手机重启、相机/相册、通知送达 | NOT RUN | 本轮未重复这些功能的专项真机测试 |
| 云账号、真实云同步、真实 AI 识别 | NOT RUN | 本轮使用本机模式；浏览器模拟结果不作为真实后端验收 |

冷启动耗时为 Android Activity 启动指标。最终包安装后的首次冷启动为 1672ms，离线再次冷启动为 752ms；这些数值不代表每次 WebView 全部绘制完成的耗时。启动截图已显示首页，未单独捕获短暂的启动图。

返回键未关闭的现象发生在 WebView 重载与数据恢复之后。后续单次返回复测通过，当前未稳定复现，不能据此排除偶发问题；本轮未修改返回键逻辑。

## 真机发现并修复的图表问题

1. SVG 缩放后，归一化虚线与不缩放描边一起使用，使绘制动画结束后仍留下尾部间隙。保持入场绘制动画，结束时切换完整实线。
2. SVG 的 16px 上边距折叠到图表容器外，触摸层和选中标记因此向下偏移 16px。图表容器使用 `display: flow-root` 包含该边距，圆点、触摸层和提示位置随之对齐。

修改集中在 `src/styles/components.css`，并运行版本更新流程同步网页缓存。修复前后均使用同一手机及原有记录复测。

图表对照：[修复前](../output/playwright/0930-chart-touch.png)、[最终 APK](../output/playwright/0930-final-chart-touch.png)。浏览器首屏基准没有覆盖这一段滚动后的图表，因此仍需真机检查。

## 截图

以下为手机原生截图，保留系统栏与应用固定导航。

| 页面 | 竖屏首屏 | 竖屏底部 | 横屏首屏 | 横屏底部 |
| --- | --- | --- | --- | --- |
| 首页 | [查看](../output/playwright/0930-home.png) | [查看](../output/playwright/0930-home-bottom.png) | [查看](../output/playwright/0930-landscape-home.png) | [查看](../output/playwright/0930-landscape-home-bottom.png) |
| 饮食 | [查看](../output/playwright/0930-diet.png) | [查看](../output/playwright/0930-diet-bottom.png) | [查看](../output/playwright/0930-landscape-diet.png) | [查看](../output/playwright/0930-landscape-diet-bottom.png) |
| 训练 | [查看](../output/playwright/0930-training.png) | [查看](../output/playwright/0930-training-bottom.png) | [查看](../output/playwright/0930-landscape-training.png) | [查看](../output/playwright/0930-landscape-training-bottom.png) |
| 数据 | [查看](../output/playwright/0930-data.png) | [查看](../output/playwright/0930-data-bottom.png) | [查看](../output/playwright/0930-landscape-data.png) | [查看](../output/playwright/0930-landscape-data-bottom.png) |
| 我的 | [查看](../output/playwright/0930-profile.png) | [查看](../output/playwright/0930-profile-bottom.png) | [查看](../output/playwright/0930-landscape-profile.png) | [查看](../output/playwright/0930-landscape-profile-bottom.png) |

其他：[设置](../output/playwright/0930-settings.png)、[取消清空确认](../output/playwright/0930-confirmation.png)、[最终包离线重载](../output/playwright/0930-final-offline-reloaded.png)。

截图、测试日志和升级前私有数据备份仅保存在本机忽略目录；本轮未提交、推送或部署。
