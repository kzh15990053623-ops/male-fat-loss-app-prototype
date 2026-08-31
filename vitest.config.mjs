import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/unit/**/*.spec.mjs"],
    coverage: {
      provider: "v8",
      include: ["src/app-logic.js", "src/app-data.js", "src/app-storage.js", "src/app-sync.js", "server/**/*.mjs"],
      reporter: ["text", "html", "json-summary"],
      reportsDirectory: "coverage",
      clean: true,
      thresholds: {
        autoUpdate: false,
        statements: 56.78,
        branches: 50.07,
        functions: 61.14,
        lines: 59.17,
        "src/app-data.js": { statements: 94.61, branches: 82.84, functions: 96.87, lines: 96.78 },
        "src/app-logic.js": { statements: 48.8, branches: 52.26, functions: 60.29, lines: 52.23 },
        "src/app-storage.js": { statements: 86.07, branches: 62.22, functions: 86.66, lines: 88.23 },
        "src/app-sync.js": { statements: 64.04, branches: 52.66, functions: 61.76, lines: 67.17 },
        "server/**/*.mjs": { statements: 41.22, branches: 34.26, functions: 45.56, lines: 43.77 },
      },
    },
  },
});
