import js from "@eslint/js";
import globals from "globals";
import htmlTemplatePlugin from "./scripts/eslint-rules/html-template.mjs";

export default [
  {
    // optimization-summary-report/ 是生成的交付物（含 echarts/mermaid 压缩包），与 docs/ 同类，不参与 lint。
    ignores: ["node_modules/", "coverage/", "test-results/", "playwright-report/", "docs/", "supabase/", "optimization-summary-report/"],
  },
  js.configs.recommended,
  {
    files: ["src/**/*.js"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: {
        ...globals.browser,
      },
    },
    plugins: {
      "html-template": htmlTemplatePlugin,
    },
    rules: {
      "html-template/no-inline-style-attribute": "error",
      "html-template/require-escaped-html-attribute": "error",
    },
  },
  {
    files: ["sw.js"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.serviceworker,
      },
    },
  },
  {
    files: ["server.mjs", "server/**/*.mjs", "scripts/**/*.mjs", "*.config.mjs"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: {
        ...globals.node,
      },
    },
  },
  {
    // Playwright evaluate() 回调在浏览器上下文执行，字面引用 document/window 等全局。
    files: ["tests/**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
  },
  {
    rules: {
      // ignoreRestSiblings：app-data.js 的 persistedStateFrom 用解构剔除临时字段（rest 模式），变量故意不用
      "no-unused-vars": ["error", { args: "none", caughtErrors: "none", ignoreRestSiblings: true }],
    },
  },
];
