import { copyFile, rename } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "vite";

const root = resolve(import.meta.dirname, "..");
await build({ configFile: resolve(root, "vite.android.config.mjs") });
await rename(resolve(root, "dist-android", "index.native.html"), resolve(root, "dist-android", "index.html"));
await copyFile(resolve(root, "src", "app-icon-192.png"), resolve(root, "dist-android", "app-icon-192.png"));
