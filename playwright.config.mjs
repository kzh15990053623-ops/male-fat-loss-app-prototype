import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testIgnore: "**/unit/**",
  timeout: 30_000,
  expect: {
    timeout: 5_000,
    toHaveScreenshot: {
      animations: "disabled",
      maxDiffPixelRatio: 0.01,
    },
  },
  fullyParallel: true,
  workers: 4,
  reporter: [["line"], ["html", { open: "never" }]],
  outputDir: "output/playwright/test-results",
  // Chromium text rasterization differs by OS; keep CI Linux and local baselines isolated.
  snapshotPathTemplate: "{testDir}/{testFileDir}/__screenshots__/{platform}/{arg}{ext}",
  use: {
    baseURL: "http://127.0.0.1:4173",
    browserName: "chromium",
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
    viewport: { width: 390, height: 844 },
    colorScheme: "light",
    reducedMotion: "no-preference",
    serviceWorkers: "block",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node server.mjs",
    url: "http://127.0.0.1:4173/api/health",
    reuseExistingServer: false,
    timeout: 15_000,
    env: {
      PORT: "4173",
      SUPABASE_URL: "https://your-project-ref.supabase.co",
      SUPABASE_ANON_KEY: "your-supabase-anon-key",
      NUTRITION_AI_ENDPOINT: "",
      NUTRITION_AI_API_KEY: "",
      NUTRITION_AI_MODEL: "",
    },
  },
});
