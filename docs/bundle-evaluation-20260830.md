# Bundle 收益复评（2026-08-30）

## 结论

本轮继续保留当前 **no-bundle ES Module** 生产形态，不把 esbuild 接入 serving、发布脚本或依赖清单；但单 bundle 的本地结果已经足以支持下一步在真实 HTTP/2/HTTP/3 部署链路做受控 A/B pilot。逐文件 minify 只减少体积、没有稳定改善启动时序，不建议单独落地。

这是一份决策评估，不是生产改造：未修改 `src/`、静态服务、`package.json` 或 `package-lock.json`，esbuild 0.28.2 仅通过临时命令运行，产物位于被忽略的 `node_modules/.cache/bundle-benchmark-20260830/`。

## 实测结果

| 形态 | JS 文件/请求 | Raw | Brotli q5 | 冷启动 DCL / 可用 | 暖启动 DCL / 可用 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 当前模块 | 21 | 222,599 B | 63,341 B | 1,202.4 / 1,589.5 ms | 923.9 / 1,301.3 ms |
| 逐文件 minify | 21 | 163,136 B | 55,689 B | 1,208.2 / 1,595.6 ms | 921.2 / 1,304.1 ms |
| 单 bundle | 1 | 146,086 B | 38,475 B | 796.6 / 1,242.3 ms | 410.2 / 779.7 ms |

相对当前模块形态：

- 逐文件 minify：Raw 减少 26.7%，Brotli 减少 12.1%，但请求仍为 21，冷/暖时序均无稳定收益。
- 单 bundle：Raw 减少 34.4%，Brotli 减少 39.3%，JS 请求从 21 降至 1。
- 单 bundle 冷启动：DCL 减少 405.8 ms（33.7%），最终可用减少 347.2 ms（21.8%）。
- 单 bundle 暖启动：DCL 减少 513.7 ms（55.6%），最终可用减少 521.6 ms（40.1%）。

浏览器冷态观测到的 JS encoded body 为：当前 63,395 B、逐文件 minify 55,705 B、单 bundle 38,475 B。前两项与离线 Brotli 汇总的少量差异来自不足 1 KiB 的模块在 identity 可接受时不压缩。

## 测试条件

- Windows 本机，Node 24.16.0，esbuild 0.28.2，Playwright 1.62.1，Chromium 151.0.7922.34。
- 视口 390×844；Service Worker 禁用，避免既有缓存和安装阶段干扰页面启动测量。
- Chromium DevTools 模拟 150 ms RTT、1.6 Mbps 下行、750 Kbps 上行、4× CPU 降速。
- 每种形态先预热 1 次，再分别采集冷启动与暖启动各 5 次；表中为均值。
- “可用”定义为认证就绪状态完成渲染；没有访问真实 Supabase，也没有测试真实账号或生产网络。
- 当前模块与逐文件 minify 都保持 21 个 modulepreload/模块请求；单 bundle 原型将入口替换为一个版本化 ESM 文件。

构建核心命令：

```powershell
$moduleFiles = Get-ChildItem -LiteralPath src -Recurse -Filter *.js | ForEach-Object FullName

npx.cmd --yes esbuild@0.28.2 $moduleFiles `
  --outdir=node_modules/.cache/bundle-benchmark-20260830/minified/src `
  --outbase=src --format=esm --platform=browser --target=es2022 --minify

npx.cmd --yes esbuild@0.28.2 src/app.js `
  --bundle --format=esm --platform=browser --target=es2022 --minify `
  --metafile=node_modules/.cache/bundle-benchmark-20260830/bundle/meta.json `
  --outfile=node_modules/.cache/bundle-benchmark-20260830/bundle/app.js
```

本轮浏览器测量脚本保留在 `node_modules/.cache/bundle-benchmark-20260830/benchmark.mjs`，临时服务使用 4188 端口，测量结束后已关闭。

## 为什么暂不直接落地

1. 本地 Node 服务是 HTTP/1.1；高 RTT 会放大多请求成本，不能把这里的 21→1 请求收益直接外推到生产 HTTP/2/HTTP/3。
2. 暖启动差异同时包含缓存策略影响：单 bundle 使用版本化 immutable URL，而当前 20 个依赖模块使用 `no-cache` 重校验，不能把全部收益归因于合并文件。
3. Service Worker 被禁用，本轮没有验证首次安装、离线冷启动、缓存升级与旧版本清理。
4. 当前门禁以逐文件清单为不变量：modulepreload、SW APP_SHELL、版本同步、静态协商和回归扫描都需要随 bundle 方案共同重构。
5. 样本来自单机、单浏览器、每组 5 次，不足以单独作生产架构决策。

## 下一步决策门

只有同时满足以下条件，才建议进入生产实现：

1. 在真实部署地址以 HTTP/2 或 HTTP/3 复测模块版与 bundle 版，至少覆盖中端移动设备、冷缓存和暖缓存；bundle 的中位“最终可用”需稳定改善至少 10%。
2. 完整 `npm run verify`、视觉基线、PWA 首次安装、离线冷启动和版本升级缓存全部通过，且不靠批量更新截图掩盖差异。
3. 明确 source map、错误定位、版本戳、SW 资产清单及回滚策略，并量化新增构建复杂度。
4. pilot 数据确认收益仍存在，再单独立项修改生产 serving；在此之前继续维护当前无构建架构。
