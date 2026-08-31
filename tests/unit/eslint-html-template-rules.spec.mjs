import { Linter } from "eslint";
import { describe, expect, it } from "vitest";
import htmlTemplatePlugin from "../../scripts/eslint-rules/html-template.mjs";

function lint(source, enabledRules) {
  const linter = new Linter();
  return linter.verify(source, [
    {
      plugins: { "html-template": htmlTemplatePlugin },
      languageOptions: { ecmaVersion: 2024, sourceType: "module" },
      rules: enabledRules,
    },
  ]);
}

describe("html template ESLint rules", () => {
  it("reports inline style attributes at the attribute location", () => {
    const messages = lint('const view = `<div\n  style="color: red">text</div>`;', {
      "html-template/no-inline-style-attribute": "error",
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ ruleId: "html-template/no-inline-style-attribute", line: 2, column: 3 });
  });

  it("allows data attributes used for CSSOM hydration", () => {
    const messages = lint('const view = `<div data-progress="${escapeHtml(progress)}">text</div>`;', {
      "html-template/no-inline-style-attribute": "error",
    });

    expect(messages).toEqual([]);
  });

  it("reports inline styles in ordinary HTML string literals", () => {
    const messages = lint(`const view = '<div style="color: red">text</div>';`, {
      "html-template/no-inline-style-attribute": "error",
    });

    expect(messages).toHaveLength(1);
    expect(messages[0].ruleId).toBe("html-template/no-inline-style-attribute");
  });

  it("reports every unescaped quoted attribute interpolation", () => {
    const messages = lint('const view = `<a\n  href="${url}"\n  aria-label="${label}">text</a>`;', {
      "html-template/require-escaped-html-attribute": "error",
    });

    expect(messages).toHaveLength(2);
    expect(messages.map(({ line, column }) => ({ line, column }))).toEqual([
      { line: 2, column: 11 },
      { line: 3, column: 17 },
    ]);
  });

  it("requires escapeHtml to be the direct expression call", () => {
    const messages = lint('const view = `<div title="${String(escapeHtml(title))}"></div>`;', {
      "html-template/require-escaped-html-attribute": "error",
    });

    expect(messages).toHaveLength(1);
    expect(messages[0].ruleId).toBe("html-template/require-escaped-html-attribute");
  });

  it("allows direct escapeHtml calls in quoted and unquoted values", () => {
    const messages = lint('const view = `<a href="/items/${escapeHtml(id)}" data-key=${escapeHtml(key)}>text</a>`;', {
      "html-template/require-escaped-html-attribute": "error",
    });

    expect(messages).toEqual([]);
  });

  it("checks string concatenation inside attribute values", () => {
    const unsafe = lint(`const view = '<div title="' + value + '">text</div>';`, {
      "html-template/require-escaped-html-attribute": "error",
    });
    const safe = lint(`const view = '<div title="' + escapeHtml(value) + '">text</div>';`, {
      "html-template/require-escaped-html-attribute": "error",
    });

    expect(unsafe).toHaveLength(1);
    expect(unsafe[0].ruleId).toBe("html-template/require-escaped-html-attribute");
    expect(safe).toEqual([]);
  });

  it("does not treat child content or whole conditional attributes as attribute values", () => {
    const messages = lint('const view = `<button ${disabled ? "disabled" : ""}>${label}</button>`;', {
      "html-template/require-escaped-html-attribute": "error",
    });

    expect(messages).toEqual([]);
  });

  it("ignores attribute-like prose outside opening tags", () => {
    const messages = lint('const view = `<div>Example title="${value}"</div><p>Visible text: style="safe"</p>`;', {
      "html-template/require-escaped-html-attribute": "error",
      "html-template/no-inline-style-attribute": "error",
    });

    expect(messages).toEqual([]);
  });

  it("rejects arbitrary attribute fragments and dynamic attribute names", () => {
    const messages = lint('const view = `<div ${attrs} data-${name}="${escapeHtml(value)}">text</div>`;', {
      "html-template/require-escaped-html-attribute": "error",
    });

    expect(messages).toHaveLength(2);
    expect(messages.every((message) => message.ruleId === "html-template/require-escaped-html-attribute")).toBe(true);
  });

  it("checks nested attribute template fragments", () => {
    const messages = lint('const view = `<button ${active ? `data-key="${key}"` : ""}>text</button>`;', {
      "html-template/require-escaped-html-attribute": "error",
    });

    expect(messages).toHaveLength(1);
    expect(messages[0].ruleId).toBe("html-template/require-escaped-html-attribute");
  });

  it("ignores ordinary interpolated template strings", () => {
    const messages = lint("const endpoint = `https://${host}/items/${id}`;", {
      "html-template/require-escaped-html-attribute": "error",
      "html-template/no-inline-style-attribute": "error",
    });

    expect(messages).toEqual([]);
  });
});
