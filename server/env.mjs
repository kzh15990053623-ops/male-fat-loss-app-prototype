import { existsSync, readFileSync } from "node:fs";

function stripUnquotedInlineComment(value) {
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === "#" && (index === 0 || /\s/.test(value[index - 1]))) return value.slice(0, index).trim();
  }
  return value.trim();
}

export function parseDotEnv(source) {
  const values = {};
  String(source || "")
    .split(/\r?\n/)
    .forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return;
      const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match) return;

      const rawValue = match[2].trim();
      const quote = rawValue[0];
      if (quote === '"' || quote === "'") {
        const closingQuote = rawValue.indexOf(quote, 1);
        values[match[1]] = (closingQuote < 0 ? rawValue.slice(1) : rawValue.slice(1, closingQuote)).trim();
        return;
      }
      values[match[1]] = stripUnquotedInlineComment(rawValue);
    });
  return values;
}

export function applyDotEnv(values, targetEnv = process.env) {
  Object.entries(values || {}).forEach(([key, value]) => {
    if (Object.prototype.hasOwnProperty.call(targetEnv, key) && targetEnv[key] !== undefined) return;
    targetEnv[key] = value;
  });
  return targetEnv;
}

export function loadDotEnv(filePath, targetEnv = process.env) {
  if (!existsSync(filePath)) return targetEnv;
  return applyDotEnv(parseDotEnv(readFileSync(filePath, "utf8")), targetEnv);
}
