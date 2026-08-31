(function () {
  var style = getComputedStyle(document.documentElement);
  var accent = style.getPropertyValue("--accent").trim();
  var accent2 = style.getPropertyValue("--accent2").trim();
  var ink = style.getPropertyValue("--ink").trim();
  var muted = style.getPropertyValue("--muted").trim();
  var rule = style.getPropertyValue("--rule").trim();
  var bg2 = style.getPropertyValue("--bg2").trim();

  // ── Mermaid 初始化 ──
  if (window.mermaid) {
    mermaid.initialize({
      startOnLoad: true,
      theme: "neutral",
      securityLevel: "loose",
      themeVariables: {
        fontFamily: "PingFang SC, Microsoft YaHei, WorkSans, sans-serif",
        fontSize: "13px",
        primaryColor: "#eaf3f6",
        primaryBorderColor: accent,
        primaryTextColor: ink,
        lineColor: muted,
        clusterBkg: "#f2f5f6",
        clusterBorder: rule,
        edgeLabelBackground: bg2,
      },
    });
  }

  // ── 图表 1：模块行数分布（横向条形图）──
  // 数据为 2026-08-29 源码工作树实测（Get-Content | Measure-Object -Line）
  var lineData = [
    ["app-actions（拆分前·单体）", 1892],
    ["app-logic · 派生计算", 603],
    ["app-render · 外壳+facade", 467],
    ["app-data · 数据模型", 362],
    ["actions/meal · 餐食/AI", 346],
    ["app-sync · 同步编排", 327],
    ["app-state · 状态", 326],
    ["actions/services · 跨域UI服务", 309],
    ["actions/auth · 认证/账号", 289],
    ["actions/settings · 设置/数据", 246],
    ["render/shared · 共享组件", 244],
    ["render/pages/home", 233],
    ["render/pages/diet", 210],
    ["app-storage · localStorage", 135],
    ["app-utils · 工具", 94],
    ["actions/training · 训练", 90],
    ["render/pages/training", 86],
    ["render/pages/data", 85],
    ["actions/home · 今日打卡", 71],
    ["render/pages/profile", 63],
  ];

  var chartLines = echarts.init(document.getElementById("chart-lines"), null, { renderer: "svg" });
  chartLines.setOption({
    animation: false,
    grid: { left: 8, right: 52, top: 10, bottom: 6, containLabel: true },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      appendToBody: true,
      valueFormatter: function (value) {
        return value + " 行";
      },
    },
    xAxis: {
      type: "value",
      axisLabel: { color: muted, fontFamily: "JetBrainsMono, monospace", fontSize: 11 },
      splitLine: { lineStyle: { color: rule } },
    },
    yAxis: {
      type: "category",
      inverse: true,
      data: lineData.map(function (item) {
        return item[0];
      }),
      axisLabel: { color: ink, fontSize: 11.5 },
      axisLine: { lineStyle: { color: rule } },
      axisTick: { show: false },
    },
    series: [
      {
        type: "bar",
        barWidth: 15,
        data: lineData.map(function (item) {
          return {
            value: item[1],
            itemStyle: { color: item[0].indexOf("拆分前") >= 0 ? accent2 : accent, borderRadius: [0, 3, 3, 0] },
          };
        }),
        label: {
          show: true,
          position: "right",
          color: muted,
          fontFamily: "JetBrainsMono, monospace",
          fontSize: 11,
          formatter: "{c}",
        },
      },
    ],
  });

  // ── 图表 2：自动化检查构成 ──
  var chartTests = echarts.init(document.getElementById("chart-tests"), null, { renderer: "svg" });
  chartTests.setOption({
    animation: false,
    grid: { left: 10, right: 20, top: 34, bottom: 10, containLabel: true },
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, appendToBody: true },
    legend: { show: false },
    xAxis: {
      type: "category",
      data: ["vitest 单元测试", "Playwright E2E 功能", "视觉回归基线"],
      axisLabel: { color: ink, fontSize: 12.5, interval: 0 },
      axisLine: { lineStyle: { color: rule } },
      axisTick: { show: false },
    },
    yAxis: {
      type: "value",
      axisLabel: { color: muted, fontFamily: "JetBrainsMono, monospace", fontSize: 11 },
      splitLine: { lineStyle: { color: rule } },
    },
    series: [
      {
        type: "bar",
        barWidth: 74,
        data: [
          { value: 64, itemStyle: { color: accent, borderRadius: [4, 4, 0, 0] } },
          { value: 45, itemStyle: { color: accent, opacity: 0.62, borderRadius: [4, 4, 0, 0] } },
          { value: 9, itemStyle: { color: accent2, borderRadius: [4, 4, 0, 0] } },
        ],
        label: {
          show: true,
          position: "top",
          color: ink,
          fontFamily: "JetBrainsMono, monospace",
          fontWeight: 700,
          fontSize: 15,
          formatter: "{c} 项",
        },
        markLine: {
          symbol: "none",
          silent: true,
          lineStyle: { color: accent2, type: "dashed" },
          label: {
            position: "insideEndTop",
            color: accent2,
            fontFamily: "JetBrainsMono, monospace",
            fontSize: 11,
            formatter: "合计 118 项",
          },
          data: [{ yAxis: 118 }],
        },
      },
    ],
  });

  window.addEventListener("resize", function () {
    chartLines.resize();
    chartTests.resize();
  });
})();
