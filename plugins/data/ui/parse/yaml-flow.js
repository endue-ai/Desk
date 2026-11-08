// YAML's flow collections, `[a, b]` and `{a: 1}`, over as many lines as they take: single pairs in
// sequences, empty values, JSON-like keys, and nested collections, anchors, tags and aliases.

import { keyText, quoted } from "./yaml-scalars.js";
import { YamlFail } from "./yaml-scan.js";

/**
 * @typedef {import("../tree.js").DataNode} DataNode
 * @typedef {import("./yaml-scan.js").Reader} Reader
 * @typedef {import("./yaml.js").Composer} Composer
 * @typedef {(node: DataNode) => void} Place
 */

/**
 * A flow collection at the cursor (`[` or `{`), over as many lines as it takes.
 * @param {Composer} y
 * @param {number} n
 * @param {Place} place
 */
export function flow(y, n, place) {
  const { r } = y;
  const at = r.pos;
  const array = r.ch() === "[";
  const close = array ? "]" : "}";
  /** @type {DataNode[]} */
  const children = [];
  /** @type {DataNode} */
  const node = { kind: array ? "array" : "object", children, ...y.where(at), from: at };
  place(node);
  r.pos++;
  for (;;) {
    flowSpace(r);
    const c = r.ch();
    if (c === close) {
      r.pos++;
      break;
    }
    if (c === "") throw new YamlFail(at, `This ${array ? "[" : "{"} is not closed.`);
    if (c === ",") throw new YamlFail(r.pos, 'Unexpected ",".');
    const entryAt = r.pos;
    if (r.isIndicator(r.pos, "?")) {
      r.pos++;
      flowSpace(r);
    }
    const key = flowNode(y, n);
    flowSpace(r);
    const json = key !== undefined && (key.kind !== "string" || r.ch(r.pos - 1) === '"');
    if (r.isKeyColon(true, json)) {
      r.pos++;
      flowSpace(r);
      const value =
        r.ch() === "," || r.ch() === close
          ? y.scalar("", "plain", { own: false }, r.pos, r.pos)
          : (flowNode(y, n) ?? y.scalar("", "plain", { own: false }, r.pos, r.pos));
      Object.assign(value, { key: key ? keyText(key, r.text) : "" }, y.where(entryAt));
      if (array) {
        children.push({
          kind: "object",
          key: children.length,
          children: [value],
          ...y.where(entryAt),
          from: entryAt,
          to: r.pos,
        });
      } else children.push(value);
    } else if (key) {
      if (array) children.push(Object.assign(key, { key: children.length }));
      else {
        const value = y.scalar("", "plain", { own: false }, entryAt, entryAt);
        children.push(Object.assign(value, { key: keyText(key, r.text) }, y.where(entryAt)));
      }
    }
    flowSpace(r);
    if (r.ch() === ",") r.pos++;
    else if (r.ch() !== close) throw new YamlFail(r.pos, `Expected "," or "${close}".`);
  }
  node.to = r.pos;
}

/**
 * Blanks, line breaks and comments inside a flow collection.
 * @param {Reader} r
 */
export function flowSpace(r) {
  for (;;) {
    r.inlineSpace();
    r.comment();
    if (r.ch() === "\n" || r.ch() === "\r") r.pos++;
    else break;
  }
}

/**
 * @param {Composer} y
 * @param {number} n
 * @returns {DataNode | undefined}
 */
function flowNode(y, n) {
  const { r } = y;
  /** @type {Props} */
  const props = { own: true };
  y.props(props);
  flowSpace(r);
  const at = r.pos;
  const c = r.ch();
  if (c === "[" || c === "{") {
    /** @type {DataNode | undefined} */
    let node;
    flow(y, n, (x) => {
      node = x;
    });
    if (node) y.own(node, props);
    return node;
  }
  if (c === "*") return y.alias(r.name(), at);
  if (c === '"' || c === "'") return y.scalar(quoted(r), "quoted", props, at, r.pos);
  const first = r.plainLine(true);
  if (first === "")
    return props.tag || props.anchor ? y.scalar("", "plain", props, at, at) : undefined;
  return y.scalar(r.plainMore(first, n, true), "plain", props, at, r.pos);
}
