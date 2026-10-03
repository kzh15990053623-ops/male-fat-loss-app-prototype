import { readFile, readdir, copyFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

// 从矢量源重新渲染各尺寸，避免在旧 PNG 上逐像素换色或缩放。
const root = fileURLToPath(new URL("..", import.meta.url));
const res = join(root, "android/app/src/main/res");
const source = await readFile(join(root, "src/app-icon.svg"), "utf8");
const mark = source
  .replace(/<\/?svg[^>]*>/g, "")
  .replace(/<rect[^>]*\/>/, "")
  .trim();
const paper = source.match(/<rect[^>]*fill="([^"]+)"/)?.[1];
if (!paper) throw new Error("图标源缺少背景色");

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  async function render(path, width, height, svg) {
    await page.setViewportSize({ width, height });
    await page.setContent(
      `<html><head><style>html,body{margin:0;background:transparent}svg{display:block;width:100vw;height:100vh}</style></head><body>${svg}</body></html>`,
    );
    await page.screenshot({ path, omitBackground: true });
  }
  for (const size of [192, 512]) {
    await render(join(root, `src/app-icon-${size}.png`), size, size, source);
  }
  for (const [density, size] of Object.entries({ mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 })) {
    const directory = join(res, `mipmap-${density}`);
    await render(join(directory, "ic_launcher.png"), size, size, source);
    await render(join(directory, "ic_launcher_round.png"), size, size, source.replace('rx="42"', 'rx="96"'));
    const foregroundSize = size * 2.25;
    await render(
      join(directory, "ic_launcher_foreground.png"),
      foregroundSize,
      foregroundSize,
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108"><g transform="translate(15.6 15.6) scale(.4)">${mark}</g></svg>`,
    );
  }
  for (const directory of await readdir(res)) {
    if (!directory.startsWith("drawable")) continue;
    const files = await readdir(join(res, directory));
    if (!files.includes("splash.png")) continue;
    const path = join(res, directory, "splash.png");
    const png = await readFile(path);
    const width = png.readUInt32BE(16);
    const height = png.readUInt32BE(20);
    const size = Math.round(Math.min(width, height) * 0.3);
    await render(
      path,
      width,
      height,
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="${paper}"/><g transform="translate(${(width - size) / 2} ${(height - size) / 2}) scale(${size / 192})">${mark}</g></svg>`,
    );
  }
  await copyFile(join(res, "drawable/wenjian_foreground.xml"), join(res, "drawable-v24/ic_launcher_foreground.xml"));
  console.log("已从 app-icon.svg 生成 Web PNG、Android 各密度图标和启动图。");
} finally {
  await browser.close();
}
