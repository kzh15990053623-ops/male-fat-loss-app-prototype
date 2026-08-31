const ATTRIBUTE_PATTERN = /(?:^|[\s"'<>/])([A-Za-z][A-Za-z0-9:_-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
const EXPRESSION_MARKER_PATTERN = /\uE000(\d+)\uE001/g;

function marker(index) {
  return `\uE000${index}\uE001`;
}

function templateSource(node) {
  let text = "";
  const sourceIndexes = [];

  node.quasis.forEach((quasi, index) => {
    const raw = quasi.value.raw;
    const rawStart = quasi.range[0] + 1;
    text += raw;
    for (let offset = 0; offset < raw.length; offset += 1) sourceIndexes.push(rawStart + offset);

    if (index < node.expressions.length) {
      const expressionMarker = marker(index);
      text += expressionMarker;
      sourceIndexes.push(...Array.from({ length: expressionMarker.length }, () => node.expressions[index].range[0]));
    }
  });

  return { text, sourceIndexes, expressions: node.expressions };
}

function concatenationSource(node) {
  let text = "";
  const sourceIndexes = [];
  const expressions = [];

  function append(part) {
    if (part.type === "BinaryExpression" && part.operator === "+") {
      append(part.left);
      append(part.right);
      return;
    }
    if (part.type === "Literal" && typeof part.value === "string") {
      const value = part.value;
      text += value;
      sourceIndexes.push(...Array.from({ length: value.length }, (_, index) => part.range[0] + 1 + index));
      return;
    }
    const index = expressions.length;
    const expressionMarker = marker(index);
    expressions.push(part);
    text += expressionMarker;
    sourceIndexes.push(...Array.from({ length: expressionMarker.length }, () => part.range[0]));
  }

  append(node);
  return { text, sourceIndexes, expressions };
}

function literalSource(node) {
  const text = String(node.value);
  return {
    text,
    sourceIndexes: Array.from({ length: text.length }, (_, index) => node.range[0] + 1 + index),
    expressions: [],
  };
}

function openingTagRanges(text) {
  const ranges = [];
  let index = 0;
  while (index < text.length) {
    if (text.startsWith("<!--", index)) {
      const commentEnd = text.indexOf("-->", index + 4);
      index = commentEnd < 0 ? text.length : commentEnd + 3;
      continue;
    }
    if (text[index] !== "<" || !/[A-Za-z\uE000]/.test(text[index + 1] || "")) {
      index += 1;
      continue;
    }

    let quote = "";
    let cursor = index + 1;
    for (; cursor < text.length; cursor += 1) {
      const character = text[cursor];
      if (quote) {
        if (character === quote && text[cursor - 1] !== "\\") quote = "";
        continue;
      }
      if (character === '"' || character === "'") {
        quote = character;
        continue;
      }
      if (character === ">") {
        ranges.push({ start: index, end: cursor + 1 });
        index = cursor + 1;
        break;
      }
    }
    if (cursor >= text.length) break;
  }
  return ranges;
}

function attributeMatches(source) {
  const matches = [];
  for (const range of openingTagRanges(source.text)) {
    const tag = source.text.slice(range.start, range.end);
    for (const match of tag.matchAll(ATTRIBUTE_PATTERN)) {
      const prefixLength = match[0].indexOf(match[1]);
      const attributeOffset = range.start + match.index + prefixLength;
      matches.push({
        name: match[1],
        value: match[2] ?? match[3] ?? match[4] ?? "",
        sourceIndex: source.sourceIndexes[attributeOffset] ?? source.sourceIndexes[range.start] ?? 0,
      });
    }
  }
  return matches;
}

function tagExpressionIndexes(source) {
  const indexes = new Set();
  for (const range of openingTagRanges(source.text)) {
    const tag = source.text.slice(range.start, range.end);
    for (const expressionMarker of tag.matchAll(EXPRESSION_MARKER_PATTERN)) indexes.add(Number(expressionMarker[1]));
  }
  return indexes;
}

function isDirectEscapeHtmlCall(expression) {
  return expression.type === "CallExpression" && expression.callee.type === "Identifier" && expression.callee.name === "escapeHtml";
}

function isSafeAttributeFragment(expression) {
  if (isDirectEscapeHtmlCall(expression)) return true;
  if (expression.type === "Literal") return typeof expression.value === "string";
  if (expression.type === "TemplateLiteral") return expression.expressions.every(isDirectEscapeHtmlCall);
  if (expression.type === "ConditionalExpression") {
    return isSafeAttributeFragment(expression.consequent) && isSafeAttributeFragment(expression.alternate);
  }
  return false;
}

function fragmentContainsInlineStyle(expression) {
  if (expression.type === "Literal" && typeof expression.value === "string") {
    return /(?:^|\s)style\s*=/i.test(expression.value);
  }
  if (expression.type === "TemplateLiteral") {
    return /(?:^|\s)style\s*=/i.test(expression.quasis.map((quasi) => quasi.value.raw).join(""));
  }
  if (expression.type === "ConditionalExpression") {
    return fragmentContainsInlineStyle(expression.consequent) || fragmentContainsInlineStyle(expression.alternate);
  }
  return false;
}

function sourceForNode(node) {
  if (node.type === "TemplateLiteral") return templateSource(node);
  if (node.type === "BinaryExpression") return concatenationSource(node);
  return literalSource(node);
}

function topLevelConcatenation(node) {
  return !(node.parent?.type === "BinaryExpression" && node.parent.operator === "+");
}

function reportInlineStyles(context, node) {
  const sourceCode = context.sourceCode;
  const source = sourceForNode(node);
  for (const attribute of attributeMatches(source)) {
    if (attribute.name.toLowerCase() !== "style") continue;
    const start = sourceCode.getLocFromIndex(attribute.sourceIndex);
    const end = sourceCode.getLocFromIndex(attribute.sourceIndex + attribute.name.length);
    context.report({ loc: { start, end }, messageId: "inlineStyle" });
  }
  for (const index of tagExpressionIndexes(source)) {
    const expression = source.expressions[index];
    if (expression && fragmentContainsInlineStyle(expression)) context.report({ node: expression, messageId: "inlineStyle" });
  }
}

function reportUnsafeAttributeExpressions(context, node) {
  const source = sourceForNode(node);
  const attributeExpressionIndexes = new Set();
  for (const attribute of attributeMatches(source)) {
    for (const expressionMarker of attribute.value.matchAll(EXPRESSION_MARKER_PATTERN)) {
      const index = Number(expressionMarker[1]);
      attributeExpressionIndexes.add(index);
      const expression = source.expressions[index];
      if (expression && !isDirectEscapeHtmlCall(expression)) context.report({ node: expression, messageId: "unescapedAttribute" });
    }
  }

  for (const index of tagExpressionIndexes(source)) {
    if (attributeExpressionIndexes.has(index)) continue;
    const expression = source.expressions[index];
    if (expression && !isSafeAttributeFragment(expression)) context.report({ node: expression, messageId: "unsafeAttributeFragment" });
  }
}

const noInlineStyleAttribute = {
  meta: {
    type: "problem",
    docs: { description: "Disallow inline style attributes in HTML source strings" },
    schema: [],
    messages: { inlineStyle: "Inline style attributes are blocked by CSP; use data-* attributes and CSSOM hydration instead." },
  },
  create(context) {
    return {
      TemplateLiteral: (node) => reportInlineStyles(context, node),
      BinaryExpression(node) {
        if (node.operator === "+" && topLevelConcatenation(node)) reportInlineStyles(context, node);
      },
      Literal(node) {
        if (typeof node.value === "string" && !(node.parent?.type === "BinaryExpression" && node.parent.operator === "+")) {
          reportInlineStyles(context, node);
        }
      },
    };
  },
};

const requireEscapedHtmlAttribute = {
  meta: {
    type: "problem",
    docs: { description: "Require escaped interpolation in HTML attributes and reject arbitrary attribute fragments" },
    schema: [],
    messages: {
      unescapedAttribute: "HTML attribute interpolation must be a direct escapeHtml(...) call.",
      unsafeAttributeFragment:
        "Dynamic HTML attribute fragments must be static literals or conditionals; interpolate values with escapeHtml(...).",
    },
  },
  create(context) {
    return {
      TemplateLiteral: (node) => reportUnsafeAttributeExpressions(context, node),
      BinaryExpression(node) {
        if (node.operator === "+" && topLevelConcatenation(node)) reportUnsafeAttributeExpressions(context, node);
      },
    };
  },
};

export const rules = {
  "no-inline-style-attribute": noInlineStyleAttribute,
  "require-escaped-html-attribute": requireEscapedHtmlAttribute,
};

export default { rules };
