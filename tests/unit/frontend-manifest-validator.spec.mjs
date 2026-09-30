import { describe, expect, it } from "vitest";
import { parseStringArrayConstant, stripHtmlComments } from "../../scripts/validate-frontend-manifest.mjs";

describe("frontend manifest validator parsing", () => {
  it("ignores modulepreload markup inside HTML comments", () => {
    const html = `
      <!-- <link rel="modulepreload" href="./src/stale.js" /> -->
      <link rel="modulepreload" href="./src/app.js" />
    `;
    const active = stripHtmlComments(html);
    expect(active).not.toContain("stale.js");
    expect(active).toContain("./src/app.js");
  });

  it("reads only active string entries from APP_SHELL comments", () => {
    const source = `
      const APP_SHELL = [
        "./src/app.js",
        // "./src/commented.js",
        /* "./src/also-commented.js", */
        "./src/app-sync.js",
      ];
    `;
    expect(parseStringArrayConstant(source, "APP_SHELL")).toEqual(["./src/app.js", "./src/app-sync.js"]);
  });

  it.each([
    'const APP_SHELL = ["./src/app.js", ...extra];',
    'const APP_SHELL = ["./src/app.js", dynamicPath];',
    "const APP_SHELL = [`./src/app.js`];",
  ])("rejects non-literal APP_SHELL entries: %s", (source) => {
    expect(() => parseStringArrayConstant(source, "APP_SHELL")).toThrow(/only string literals/);
  });
});
