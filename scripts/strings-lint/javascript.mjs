// Find display copy by its use in the syntax tree. Protocol names, selectors and SQL are
// ordinary program values. A lower-case word in a label or a named message still counts.
import { parse } from "acorn";

const PROPERTIES = new Set([
  "alt",
  "aria-label",
  "aria-description",
  "ariaLabel",
  "caption",
  "detail",
  "emptyText",
  "help",
  "hint",
  "innerText",
  "label",
  "message",
  "notice",
  "placeholder",
  "summary",
  "textContent",
  "title",
  "tooltip",
]);
const COPY_NAME =
  /(?:caption|description|emptyText|feedback|hint|label|message|notice|placeholder|title|tooltip|warning|why)$/i;
const CODE_NAME = /^(?:sql|query|statement|ddl|databaseId|commandId|protocol|wire)/i;
const COPY_MAP = /(?:CAPTIONS|DESCRIPTIONS|HINTS|LABELS|TITLES|TOOLTIPS)$/u;
const SQL =
  /^(?:SELECT|VALUES|WITH|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|BEGIN|COMMIT|ROLLBACK|SHOW|SET|GRANT|REVOKE|COMMENT|COPY|EXPLAIN|ANALYZE|VACUUM|REINDEX|PRAGMA|ATTACH|DETACH)\b/u;
const CALLS = new Map([
  ["alert", 0],
  ["confirm", 0],
  ["createTextNode", 0],
  ["feedback", 0],
  ["note", 0],
  ["pick", 0],
  ["prompt", 0],
  ["report", 0],
  ["say", 0],
  ["setNotice", 0],
  ["setStatus", 0],
  ["showMessage", 0],
  ["status", 0],
  ["toast", 0],
]);
const COMPARISONS = new Set(["==", "===", "!=", "!==", "in", "instanceof"]);
const LETTER = /\p{L}/u;

/** Child nodes in source order, without Acorn's location and range records. */
export function nodesOf(node) {
  return Object.values(node).flatMap((value) => {
    if (Array.isArray(value)) return value.filter((child) => typeof child?.type === "string");
    return typeof value?.type === "string" ? [value] : [];
  });
}

const nameOf = (node) => {
  if (node?.type === "Identifier") return node.name;
  if (node?.type === "Literal" && typeof node.value === "string") return node.value;
  if (node?.type === "MemberExpression") return nameOf(node.property);
  return undefined;
};
const namedCopy = (name) => name && COPY_NAME.test(name) && !CODE_NAME.test(name);
const sentence = (text) => {
  const words = text.trim().replaceAll("{}", "value");
  return (
    !SQL.test(words) &&
    !/^(?:\w+:\/\/|[{[</\\_-])/.test(words) &&
    /[.!?…]$/u.test(words) &&
    (words.match(/\b[a-zA-Z][a-z']{1,}\b/gu)?.length ?? 0) >= 2
  );
};

/** A string or a template's text, parameter expressions replaced by placeholders. */
export const literalText = (node) => {
  if (node.type === "Literal") return typeof node.value === "string" ? node.value : "";
  if (node.type === "TemplateLiteral")
    return node.quasis.map(({ value }) => value.cooked ?? value.raw).join("{}");
  return "";
};

/** Return the copy's source nodes along with the parsed module. */
export function javascriptCopy(source) {
  const tree = parse(source, { ecmaVersion: "latest", sourceType: "module", locations: true });
  const parents = new Map();
  const declarations = new Map();
  const usedAsCode = new Set();
  const found = new Map();
  const used = new Set();

  function visit(node, parent) {
    parents.set(node, parent);
    if (node.type === "VariableDeclarator" && node.id.type === "Identifier") {
      const name = node.id.name;
      declarations.set(name, declarations.has(name) ? null : node.init);
    }
    if (node.type === "BinaryExpression" && COMPARISONS.has(node.operator)) {
      for (const [side, other] of [
        [node.left, node.right],
        [node.right, node.left],
      ])
        if (side.type === "Identifier" && other.type === "Literal") usedAsCode.add(side.name);
    }
    if (node.type === "SwitchStatement" && node.discriminant.type === "Identifier")
      usedAsCode.add(node.discriminant.name);
    for (const child of nodesOf(node)) visit(child, node);
  }
  visit(tree);

  function mark(node) {
    if (!node || used.has(node)) return;
    used.add(node);
    const words = literalText(node);
    if (LETTER.test(words)) {
      found.set(node.start, { node, line: node.loc.start.line, text: words });
      if (node.type === "TemplateLiteral")
        for (const expression of node.expressions)
          if (
            expression.type === "ConditionalExpression" ||
            expression.type === "LogicalExpression"
          )
            mark(expression);
      return;
    }
    switch (node.type) {
      case "ConditionalExpression":
        mark(node.consequent);
        mark(node.alternate);
        break;
      case "LogicalExpression":
        if (node.operator !== "&&") mark(node.left);
        mark(node.right);
        break;
      case "BinaryExpression":
        if (node.operator === "+") {
          mark(node.left);
          mark(node.right);
        }
        break;
      case "ChainExpression":
        mark(node.expression);
        break;
      case "ArrayExpression":
        for (const item of node.elements) mark(item);
        break;
      case "ObjectExpression":
        for (const prop of node.properties) mark(prop.value);
        break;
      case "Identifier":
        if (!usedAsCode.has(node.name)) mark(declarations.get(node.name));
        break;
    }
  }

  const functionName = (node) => {
    for (let fn = parents.get(node); fn; fn = parents.get(fn)) {
      if (!/Function/.test(fn.type)) continue;
      return nameOf(fn.id) ?? nameOf(parents.get(fn)?.id) ?? nameOf(parents.get(fn)?.key);
    }
    return undefined;
  };

  // A sentence may be returned through a model or helper whose name does not describe its copy.
  function usedAsProgram(node) {
    for (
      let child = node, parent = parents.get(child);
      parent;
      child = parent, parent = parents.get(child)
    ) {
      const { type } = parent;
      if (type === "VariableDeclarator")
        return usedAsCode.has(nameOf(parent.id)) || CODE_NAME.test(nameOf(parent.id) ?? "");
      if (type === "Property" && parent.key === child) return true;
      if (type === "MemberExpression" && parent.property === child) return true;
      if (type === "SwitchCase" && parent.test === child) return true;
      if (type === "BinaryExpression" && COMPARISONS.has(parent.operator)) return true;
      if (type === "TaggedTemplateExpression" || /Import|Export/.test(type)) return true;
      if (type === "Property") return CODE_NAME.test(nameOf(parent.key) ?? "");
      if (type === "CallExpression") return CODE_NAME.test(nameOf(parent.callee) ?? "");
      if (/Statement$|Function/.test(type)) return false;
    }
    return false;
  }

  for (const node of parents.keys()) {
    if (
      (node.type === "Literal" || node.type === "TemplateLiteral") &&
      sentence(literalText(node)) &&
      !usedAsProgram(node)
    )
      mark(node);
    switch (node.type) {
      case "Property":
        if (PROPERTIES.has(nameOf(node.key))) mark(node.value);
        break;
      case "VariableDeclarator":
        if (
          node.id.type === "Identifier" &&
          (namedCopy(node.id.name) || COPY_MAP.test(node.id.name)) &&
          !usedAsCode.has(node.id.name)
        )
          mark(node.init);
        break;
      case "AssignmentExpression":
        if (PROPERTIES.has(nameOf(node.left))) mark(node.right);
        break;
      case "ReturnStatement":
        if (namedCopy(functionName(node))) mark(node.argument);
        break;
      case "ArrowFunctionExpression":
        if (namedCopy(nameOf(parents.get(node)?.id))) mark(node.body);
        break;
      case "NewExpression": {
        const ctor = nameOf(node.callee);
        if (ctor === "Option" || (ctor && /Error$/.test(ctor))) mark(node.arguments[0]);
        if (ctor === "CommandFailed") mark(node.arguments[2]);
        break;
      }
      case "CallExpression": {
        const callee = nameOf(node.callee);
        if (CALLS.has(callee)) mark(node.arguments[CALLS.get(callee)]);
        if (callee === "setAttribute" && PROPERTIES.has(nameOf(node.arguments[0])))
          mark(node.arguments[1]);
        if (callee === "el") for (const child of node.arguments.slice(3)) mark(child);
        break;
      }
    }
  }
  return { tree, findings: [...found.values()].sort((a, b) => a.node.start - b.node.start) };
}
