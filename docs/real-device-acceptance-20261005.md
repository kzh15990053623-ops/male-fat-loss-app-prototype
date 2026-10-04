# 稳减 Android 真机验收（2026-10-05）

本轮使用实际连接的 Samsung SM-N9860，Android 12 / API 31，Android System WebView 148.0.7778.178。测试通过 USB、ADB 和设备内真实 WebView 完成，未使用模拟器代替手机。手机原应用已升级到 1.2.2（versionCode 5），前端版本为 `20261005-device-1`，网页缓存代号为 v32。

**结论：Android APK 的本机记录与恢复路径通过本轮验收；完整内测准入仍未通过。** 专用云验收账号尚未提供实际邮箱，真实邮件、登录后的跨设备同步、手机 AI、Chrome/PWA 与 iOS Safari 仍需完成。

## 数据保护与连接

- 原应用 `com.wenjian.healthledger` 测试前已备份健康档案、SQLite、配置和原 1.2 APK。
- 合成记录、清空和恢复操作均在独立包 `com.wenjian.healthledger.acceptance` 中进行，没有清空原应用。
- 原应用从 1.2 升至 1.2.1、再升至 1.2.2 后，持久化档案指纹完全一致；原有 2 个记录日及 2 条体重记录保留。
- 前后 SHA-256 完全一致，完整指纹见本机 `final-upgrade-integrity.json`。私有备份位于忽略的 `output/device-acceptance-20261005/private-original/`，没有纳入 Git。
- ADB 37.0.1 默认 USB 后端曾出现 shell 超时；仅对 ADB 进程设置 `ADB_USB_LEGACY=1` 并重插后恢复。没有修改全局环境变量。此选项见 [Android 官方说明](https://developer.android.com/tools/releases/platform-tools)。
- 断网测试时系统显示 `Active default network: none`，原生 HTTP 请求因无法解析主机失败；联网后应用健康接口实际返回 200、Supabase 认证入口返回 401，证明手机可达。WebView 的 `navigator.onLine` 在飞行模式中仍为 true，不能单独作为联网证据。
- 测试后恢复原网络和方向设置：飞行模式关闭、Wi-Fi 和移动数据开启、自动旋转关闭、竖屏。

## 验收矩阵

| 结果 | 路径 | 实际证据 |
| --- | --- | --- |
| PASS | 成人建档校验 | 17 岁保留表单并显示“请输入 18–100 岁”，没有建档成功 |
| PASS | 手动预算 | 身高未填写时能建立手动档案；1800 千卡预算保存，暂停消耗估算 |
| PASS | 女性估算与可选腰围 | 165 cm、30 岁、70 kg 的合成档案按女性公式得到 BMR 1420，预算 1600；腰围可留空 |
| PASS | 首次建档首页位置 | 修正后 scrollY 为 0，首页标题出现在可视区域；实际屏幕截图确认 |
| PASS | 同餐追加 | 鸡胸肉饭 500 + 牛奶 120 = 620 千卡；独立 ID、份量、单位、做法、用油、酱料保留 |
| PASS | 小数份量与修改 | 1 杯及 0.5 杯可保存；改牛奶为 60 千卡后总计 560，原鸡胸肉条目与牛奶 ID 不变 |
| PASS | 复制和单条删除 | 复制生成新 ID；删除复制条目后总计恢复 560，原两条保留，删除标记写入 SQLite |
| PASS | 营养未知 | 先记食物可保存；显示“营养待补充”，已知摄入仍为 560，没有当成已知零值 |
| PASS | 真实相机及取消 | 实际 Samsung 相机启动、拍摄、确认，图片回传并加载；取消拍照保留文字草稿 |
| PASS | 系统相册选择 | Android 文件选择器选取本轮测试图标，回传预览加载成功；没有发送给模型 |
| PASS | 照片与档案分离 | 保存后移除预览；健康档案没有照片字段或图片数据 |
| PASS | 真正离线冷启动 | 飞行模式且 Wi-Fi/移动数据关闭，强制停止再打开；餐次和未保存草稿恢复 |
| PASS | 离线写入及再次启动 | 离线新增记录写入，第二次冷启动恢复 5 条有效饮食条目，午餐仍为 560 千卡 |
| PASS | 历史补录隔离 | 昨天体重与晚餐保存到昨天；今天体重、餐次、预算及文字草稿保留 |
| PASS | 运动删除 | 新增合成运动后可单独删除，饮食预算仍为 1800 |
| PASS | 实际备份导出/导入 | 离线导出调起 Android 分享面板；通过手机系统选择器导入导出的文件，确认说明后恢复 2 天记录及 5 条有效饮食条目 |
| PASS | 布局 | 竖屏五页 411 px 均无横向溢出；横屏首页 856 × 387 px 无横向溢出，底部导航可见 |
| PASS | 原应用覆盖升级 | 实际安装 1.2.2 成功，应用 ID/版本/签名核对通过，原档案指纹不变 |
| NOT RUN | 专用账号登录和真实邮件 | 用户已选择专用验收账号，仍等待实际邮箱与手机端密码输入；尚未测试真实注册、过期邮件、重发及找回 |
| NOT RUN | 登录后的跨设备同步、冲突及手机 AI | 无可用验收账号；没有用匿名健康接口或本地记录代替真实云验收 |
| NOT RUN | Android Chrome / 浏览器 PWA 安装、离线及升级 | 连接设备未安装 Chrome；自动审批拒绝通过 ADB 打开 Samsung Internet 的操作，未给出更具体原因 |
| NOT RUN | iOS Safari | 没有连接 iOS 实机 |
| NOT RUN | 持续弱网和长时间使用 | 本轮验证断网/恢复，没有完成限速、抖动和两周内测 |

## 本轮修正和发布验证

1. 饮食总量输入原来固定 `step=10`，导致 1 杯、半碗等份量被浏览器阻止提交。改为允许小数；保留原有非负与上限限制，并在真实手机复验。
2. 首次建档后原表单的滚动位置沿用到首页。成功保存并渲染后返回首页顶部，失败路径仍保留填写内容。
3. PWA 升级测试原来写死 v31，版本升级到 v32 后没有生成不同的测试 Service Worker。改为匹配实际缓存编号，继续验证 HTTP 500 缓存回退、双标签等待和草稿保留。

Node 22 完整 `verify`：132 项语法、6 项静态校验、单测及覆盖率、lint、格式、运行时门禁通过；浏览器 **100/100 PASS**。真实手机的相机、文件选择器和断网证据单独列于上表。

交付 APK：`output/device-acceptance-20261005/wenjian-1.2.2-20261005-device-1.apk`，SHA-256：`97F059A5928E3E0995FAC9C9215BD1FC3BB9BEBAA5352F451ACC8F5D806E9F58`。这是可覆盖原调试版的调试签名包；正式 Android 商店签名仍按 P2 计划推进。

本轮原生验收不能证明完整历史归档：原生版仍保留 90 条身体指标、180 个日记录的工作窗口；网页永久归档的验收属于前一轮数据库/浏览器结果。

## 本机证据

证据目录：`output/device-acceptance-20261005/`，未纳入 Git。关键结果：`final-upgrade-integrity.json`、`meal-append-fixed.txt`、`meal-edit-result.txt`、`meal-delete-result.txt`、`history-isolation-result.txt`、`offline-native-http.txt`、`offline-second-start.txt`、`import-result.txt`、`setup-position-fixed.txt`、`phone-network-diagnostics.txt`、`verify-node22-final.txt`。有效截图为 `07-home-setup-fixed.png`、`08-import-confirm.png`、`09-landscape-home.png`。

早期 `01-age-validation.png` 是填写前截图；`06-landscape-diet.png` 包含恢复 Wi-Fi 时的系统权限提示，不作为布局通过证据。相机图片只用于本机输入验证，不用于 AI 准确性验收。
