import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  base: "./",
  publicDir: false,
  build: {
    outDir: "dist-android",
    emptyOutDir: true,
    rollupOptions: { input: resolve("index.native.html") },
  },
});
