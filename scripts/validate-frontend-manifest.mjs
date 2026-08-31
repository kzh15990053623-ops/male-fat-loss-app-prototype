import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { discoverFrontendJsFiles, projectRoot } from "./frontend-files.mjs";

function attribute(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, "i"));
  return match?.[2] || "";
}

function normalizedAssetPath(asset) {
  return asset.split(/[?#]/, 1)[0].replace(/^\.\//, "").replaceAll("\\", "/");
}

function duplicates(values) {
  return [...new Set(values.filter((value, index) => values.indexOf(value) !== index))];
}

function assertExactAssets(label, actual, expected) {
  const duplicateAssets = duplicates(actual);
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  const missing = expected.filter((asset) => !actualSet.has(asset));
  const extra = actual.filter((asset) => !expectedSet.has(asset));

  assert.deepEqual(duplicateAssets, [], `${label} contains duplicate entries: ${duplicateAssets.join(", ")}`);
  assert.deepEqual(missing, [], `${label} is missing: ${missing.join(", ")}`);
  assert.deepEqual(extra, [], `${label} contains stale entries: ${extra.join(", ")}`);
}

export function stripHtmlComments(source) {
  return source.replace(/<!--[\s\S]*?-->/g, "");
}

function maskJavaScriptComments(source) {
  const characters = [...source];
  let quote = "";
  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index];
    if (quote) {
      if (character === "\\") {
        index += 1;
        continue;
      }
      if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    if (character !== "/") continue;
    if (characters[index + 1] === "/") {
      characters[index] = " ";
      characters[index + 1] = " ";
      index += 2;
      while (index < characters.length && characters[index] !== "\n" && characters[index] !== "\r") {
        characters[index] = " ";
        index += 1;
      }
      index -= 1;
      continue;
    }
    if (characters[index + 1] === "*") {
      characters[index] = " ";
      characters[index + 1] = " ";
      index += 2;
      while (index < characters.length && !(characters[index] === "*" && characters[index + 1] === "/")) {
        if (characters[index] !== "\n" && characters[index] !== "\r") characters[index] = " ";
        index += 1;
      }
      assert.ok(index < characters.length, "unterminated JavaScript block comment");
      characters[index] = " ";
      characters[index + 1] = " ";
      index += 1;
    }
  }
  return characters.join("");
}

export function parseStringArrayConstant(source, constantName) {
  const masked = maskJavaScriptComments(source);
  const declarationPattern = new RegExp(`\\bconst\\s+${constantName}\\s*=\\s*`, "g");
  const declarations = [...masked.matchAll(declarationPattern)];
  assert.equal(declarations.length, 1, `${constantName} must have exactly one const declaration`);

  let cursor = declarations[0].index + declarations[0][0].length;
  assert.equal(masked[cursor], "[", `${constantName} must be an array literal`);
  cursor += 1;
  const values = [];

  while (cursor < masked.length) {
    while (/\s/.test(masked[cursor] || "")) cursor += 1;
    if (masked[cursor] === "]") return values;
    const quote = masked[cursor];
    assert.ok(quote === '"' || quote === "'", `${constantName} may contain only string literals`);
    cursor += 1;
    let value = "";
    while (cursor < masked.length && masked[cursor] !== quote) {
      assert.notEqual(masked[cursor], "\\", `${constantName} asset paths must not use escape sequences`);
      value += masked[cursor];
      cursor += 1;
    }
    assert.equal(masked[cursor], quote, `${constantName} contains an unterminated string literal`);
    cursor += 1;
    values.push(value);
    while (/\s/.test(masked[cursor] || "")) cursor += 1;
    if (masked[cursor] === ",") {
      cursor += 1;
      continue;
    }
    assert.equal(masked[cursor], "]", `${constantName} items must be comma separated`);
    return values;
  }

  assert.fail(`${constantName} array literal is unterminated`);
}

export async function validateFrontendManifest(root = projectRoot) {
  const [frontendFiles, rawHtml, serviceWorker] = await Promise.all([
    discoverFrontendJsFiles(root),
    readFile(join(root, "index.html"), "utf8"),
    readFile(join(root, "sw.js"), "utf8"),
  ]);
  const html = stripHtmlComments(rawHtml);

  const moduleScripts = [...html.matchAll(/<script\b[^>]*>/gi)]
    .map((match) => match[0])
    .filter((tag) => attribute(tag, "type").toLowerCase() === "module");
  assert.equal(moduleScripts.length, 1, "index.html must contain exactly one type=module entry script");

  const entryUrl = attribute(moduleScripts[0], "src");
  assert.ok(entryUrl, "the module entry script must carry src");
  const entryPath = normalizedAssetPath(entryUrl);
  assert.ok(frontendFiles.includes(entryPath), `module entry does not resolve to a discovered src/**/*.js file: ${entryUrl}`);

  const preloadUrls = [...html.matchAll(/<link\b[^>]*>/gi)]
    .map((match) => match[0])
    .filter((tag) => attribute(tag, "rel").toLowerCase() === "modulepreload")
    .map((tag) => attribute(tag, "href"));
  assert.ok(preloadUrls.every(Boolean), "every modulepreload link must carry href");

  // The entry preload is intentional: it starts app.js from <head>, before the
  // module script at the end of <body>. Dependencies remain unversioned so
  // import URLs, preload URLs and service-worker URLs stay byte-for-byte equal.
  const expectedJsUrls = frontendFiles.map((file) => (file === entryPath ? entryUrl : `./${file}`));
  assertExactAssets("index.html modulepreload list", preloadUrls, expectedJsUrls);
  assert.equal(
    preloadUrls.filter((url) => url === entryUrl).length,
    1,
    "the entry modulepreload URL must match the module script URL exactly",
  );

  const appShellAssets = parseStringArrayConstant(serviceWorker, "APP_SHELL");
  const serviceWorkerJsUrls = appShellAssets.filter((asset) => {
    const path = normalizedAssetPath(asset);
    return path.startsWith("src/") && path.endsWith(".js");
  });
  assertExactAssets("sw.js APP_SHELL JavaScript list", serviceWorkerJsUrls, expectedJsUrls);

  return { frontendFiles, entryUrl };
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  const result = await validateFrontendManifest();
  console.log(`Frontend manifest checks passed (${result.frontendFiles.length} JavaScript modules, entry ${result.entryUrl})`);
}
