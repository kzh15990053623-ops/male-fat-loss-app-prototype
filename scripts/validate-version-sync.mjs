import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// The app shell version is stamped in three places: index.html (twice) and
// sw.js (APP_SHELL entries), plus the SW cache name. They must move together,
// otherwise clients can end up running a mixed old/new app shell.
const [html, serviceWorker] = await Promise.all([readFile("index.html", "utf8"), readFile("sw.js", "utf8")]);

const htmlVersions = [...html.matchAll(/\?v=([0-9a-zA-Z-]+)/g)].map((match) => match[1]);
assert.ok(htmlVersions.length >= 2, "index.html should carry versioned asset URLs");
assert.equal(new Set(htmlVersions).size, 1, `index.html version strings disagree: ${htmlVersions.join(", ")}`);
const shellVersion = htmlVersions[0];

const swVersions = [...serviceWorker.matchAll(/\?v=([0-9a-zA-Z-]+)/g)].map((match) => match[1]);
assert.ok(swVersions.length >= 2, "sw.js APP_SHELL should carry the same versioned URLs");
swVersions.forEach((version) => assert.equal(version, shellVersion, `sw.js asset version ${version} != index.html ${shellVersion}`));

const cacheName = serviceWorker.match(/CACHE_NAME = "([^"]+)"/)?.[1] || "";
assert.match(cacheName, /^fitness-fat-loss-app-shell-v\d+$/, "CACHE_NAME must follow fitness-fat-loss-app-shell-v<N>");

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
assert.ok(packageJson.version, "package.json must carry a version for release tracking");

console.log(`Version sync checks passed (shell ${shellVersion}, cache ${cacheName})`);
