// YAML 1.2 into the typed tree: documents, block and flow collections, explicit keys, anchors and
// aliases (an alias shows the node it points to), tags, and the core schema's null, bool, int and
// float, with timestamps as dates. Every node is attached to its parent before it is filled, so
// after an error the tree keeps what parsed before it.

import { errorAt, lineStarts, positionOf } from "../lines.js";
import { flow } from "./yaml-flow.js";
import { block as blockScalar, keyText, quoted, resolve } from "./yaml-scalars.js";
import { Reader, YamlFail } from "./yaml-scan.js";

/**
 * @typedef {import("../tree.js").DataNode} DataNode
 * @typedef {import("../tree.js").DataDoc} DataDoc
 * @typedef {(node: DataNode) => void} Place
 * @typedef {{ anchor?: string, tag?: string, own: boolean }} Props
 * @typedef {{ text: string, at: number }} Key
 */

/** @param {string} text @returns {DataDoc} */
export function parseYaml(text) {
  return new Composer(text).stream();
}

export class Composer {
  /** @param {string} text */
  constructor(text) {
    this.r = new Reader(text);
    this.lines = lineStarts(text);
    /** @type {Map<string, DataNode>} */
    this.anchors = new Map();
    /** Collections being filled: an alias to one of them cannot show it. */
    this.building = new Set();
    /** @type {import("../tree.js").ParseError[]} */
    this.warnings = [];
  }

  /** @param {number} at */
  where(at) {
    return positionOf(this.lines, at);
  }

  /** @returns {DataDoc} */
  stream() {
    const { r } = this;
    /** @type {DataNode[]} */
    const roots = [];
    const errors = [];
    try {
      for (;;) {
        let line = r.peek(r.pos);
        while (!line.eof && r.ch(line.lineStart) === "%") line = r.peek(r.nextLine(line.lineStart));
        if (line.eof) break;
        if (r.isMarker(line.lineStart, "...")) {
          r.pos = r.nextLine(line.lineStart);
          continue;
        }
        this.anchors = new Map();
        const place = (/** @type {DataNode} */ node) => roots.push(node);
        if (r.isMarker(line.lineStart, "---")) {
          r.pos = line.lineStart + 3;
          this.node(-1, place, { inline: true, compact: true, at: line.lineStart });
        } else {
          r.pos = line.lineStart;
          this.node(-1, place, { inline: false, at: line.contentAt });
        }
        const after = r.peek(r.pos);
        if (after.eof) break;
        if (after.marker) {
          r.pos = after.lineStart;
          continue;
        }
        throw new YamlFail(after.contentAt, "Unexpected content: is it indented right?");
      }
    } catch (error) {
      if (!(error instanceof YamlFail)) throw error;
      errors.push(errorAt(this.lines, error.offset, error.message));
    }
    return { roots, errors, warnings: this.warnings, rootLabel: "Document" };
  }

  /**
   * Anchors and tags at the cursor, in any order.
   * @param {Props} props
   */
  props(props) {
    const { r } = this;
    for (;;) {
      r.inlineSpace();
      if (r.ch() === "&") props.anchor = r.name();
      else if (r.ch() === "!") props.tag = r.tag();
      else break;
    }
  }

  /**
   * A node inside a parent indented `n`: on the rest of this line (inline) or on the lines after.
   * The cursor ends at the start of the line after the node.
   * @param {number} n
   * @param {Place} place
   * @param {{ inline: boolean, compact?: boolean, seqAtN?: boolean, at: number }} opts
   */
  node(n, place, opts) {
    const { r } = this;
    /** @type {Props} */
    const props = { own: false };
    if (opts.inline) {
      this.props(props);
      r.inlineSpace();
      r.comment();
      if (!r.eolAt()) return this.content(n, place, props, false, opts.compact === true);
      r.pos = r.nextLine();
      props.own = true;
    }
    let line = r.peek(r.pos);
    const fits = (/** @type {import("./yaml-scan.js").Line} */ l) =>
      !l.eof &&
      !l.marker &&
      (l.indent > n || (opts.seqAtN === true && l.indent === n && r.isIndicator(l.contentAt, "-")));
    if (fits(line) && "&!".includes(r.ch(line.contentAt))) {
      r.pos = line.contentAt;
      this.props(props);
      r.inlineSpace();
      r.comment();
      if (!r.eolAt()) return this.content(n, place, props, true, false);
      r.pos = r.nextLine();
      line = r.peek(r.pos);
    }
    if (!fits(line)) {
      const empty = this.scalar("", "plain", props, opts.at, opts.at);
      place(empty);
      return;
    }
    r.pos = line.contentAt;
    this.content(n, place, props, true, false);
  }

  /**
   * The node that starts at the cursor. `block`: it starts its line, so it may be a block
   * collection; `compact`: it follows `- `, `? ` or `: ` on the same line, which allows one too.
   * @param {number} n
   * @param {Place} place
   * @param {Props} props
   * @param {boolean} block
   * @param {boolean} compact
   */
  content(n, place, props, block, compact) {
    const { r } = this;
    const at = r.pos;
    const col = r.col(at);
    const c = r.ch();
    const structural = block || compact;
    if (structural && r.isIndicator(at, "-")) return this.sequence(col, place, props);
    if (structural && r.isIndicator(at, "?")) return this.mapping(col, place, props, null);
    if (c === "|" || c === ">") {
      const { value, from } = blockScalar(r, n);
      place(this.scalar(value, "block", props, from, r.pos));
      return;
    }
    /** @type {DataNode | undefined} */
    let node;
    let style = "plain";
    let text = "";
    if (c === "[" || c === "{") {
      style = "flow";
      flow(this, n, (x) => {
        node = x;
      });
    } else if (c === "*") {
      style = "alias";
      node = this.alias(r.name(), at);
    } else if (c === '"' || c === "'") {
      text = quoted(r);
      node = this.scalar(text, "quoted", props, at, r.pos);
      style = "quoted";
    } else {
      text = r.plainLine(false);
      if (text === "" && !r.isKeyColon())
        throw new YamlFail(at, `Unexpected ${JSON.stringify(c)}.`);
      node = this.scalar(text, "plain", props, at, r.pos);
    }
    r.inlineSpace();
    if (r.isKeyColon()) {
      if (!structural) throw new YamlFail(r.pos, "A mapping value is not allowed here.");
      const key = {
        text: node && (node.alias || style === "flow") ? keyText(node, this.r.text) : text,
        at,
      };
      return this.mapping(col, place, props.own ? props : { own: false }, key);
    }
    if (!node) throw new YamlFail(at, "Unexpected text.");
    if (style === "plain" && node.kind !== "object" && node.kind !== "array" && !node.alias) {
      node = this.scalar(r.plainMore(text, n), "plain", props, at, r.pos);
    }
    this.own(node, props);
    place(node);
    r.endLine();
  }

  /** Apply anchors and tags to a collection or alias read at the cursor. */
  own(/** @type {DataNode} */ node, /** @type {Props} */ props) {
    if (node.kind !== "object" && node.kind !== "array" && !node.alias) return;
    if (props.tag && !node.alias) node.tag = props.tag;
    if (props.anchor && !node.alias) {
      node.anchor = props.anchor;
      this.anchors.set(props.anchor, node);
    }
  }

  /**
   * A block sequence whose `-` is at column `s`.
   * @param {number} s
   * @param {Place} place
   * @param {Props} props
   */
  sequence(s, place, props) {
    const { r } = this;
    /** @type {DataNode[]} */
    const children = [];
    const node = this.collection("array", children, props, r.pos);
    place(node);
    for (;;) {
      const dash = r.pos;
      r.pos = dash + 1;
      const index = children.length;
      this.node(s, (child) => children.push(Object.assign(child, { key: index })), {
        inline: true,
        compact: true,
        at: dash,
      });
      const line = r.peek(r.pos);
      if (line.eof || line.marker || line.indent < s) break;
      if (line.indent > s) throw new YamlFail(line.contentAt, "Bad indentation in a sequence.");
      if (!r.isIndicator(line.contentAt, "-")) break;
      r.pos = line.contentAt;
    }
    this.building.delete(node);
    node.to = r.pos;
  }

  /**
   * A block mapping whose keys are at column `m`. `first` is the key already read, or null when
   * the cursor is at a `?`.
   * @param {number} m
   * @param {Place} place
   * @param {Props} props
   * @param {Key | null} first
   */
  mapping(m, place, props, first) {
    const { r } = this;
    /** @type {DataNode[]} */
    const children = [];
    const node = this.collection("object", children, props, first ? first.at : r.pos);
    place(node);
    const seen = new Set();
    let key = first;
    for (;;) {
      let explicitValue = false;
      const explicitKey = key === null;
      if (key === null) {
        const at = r.pos;
        r.pos++;
        /** @type {DataNode | undefined} */
        let complex;
        this.node(
          m,
          (k) => {
            complex = k;
          },
          { inline: true, compact: true, at },
        );
        key = { text: complex ? keyText(complex, this.r.text) : "", at };
        const line = r.peek(r.pos);
        if (!line.eof && line.indent === m && r.isIndicator(line.contentAt, ":")) {
          r.pos = line.contentAt;
          explicitValue = true;
        }
      } else explicitValue = true;
      const { text, at } = key;
      const member = (/** @type {DataNode} */ child) => {
        Object.assign(child, { key: text }, this.where(at));
        if (seen.has(text)) {
          child.duplicate = true;
          this.warnings.push(errorAt(this.lines, at, `Duplicate key ${JSON.stringify(text)}.`));
        }
        seen.add(text);
        children.push(child);
      };
      if (explicitValue) {
        r.pos++;
        this.node(m, member, { inline: true, compact: explicitKey, seqAtN: true, at });
      } else member(this.scalar("", "plain", { own: false }, at, at));
      const line = r.peek(r.pos);
      if (line.eof || line.marker || line.indent < m) break;
      if (line.indent > m) throw new YamlFail(line.contentAt, "Bad indentation in a mapping.");
      r.pos = line.contentAt;
      if (r.isIndicator(r.pos, "?")) key = null;
      else if (r.isIndicator(r.pos, "-"))
        throw new YamlFail(r.pos, "A sequence entry is not allowed here.");
      else key = this.key();
    }
    this.building.delete(node);
    node.to = r.pos;
  }

  /** An implicit key at the cursor and its `:`; the cursor ends on the `:`. */
  key() {
    const { r } = this;
    const at = r.pos;
    this.props({ own: false });
    const c = r.ch();
    let text;
    if (c === '"' || c === "'") text = quoted(r);
    else if (c === "*") text = keyText(this.alias(r.name(), at), this.r.text);
    else if (c === "[" || c === "{") {
      let found = /** @type {DataNode | undefined} */ (undefined);
      flow(this, -1, (x) => {
        found = x;
      });
      text = found ? keyText(found, this.r.text) : "";
    } else text = r.plainLine(false);
    r.inlineSpace();
    if (!r.isKeyColon()) throw new YamlFail(r.pos, 'Expected a key and ":".');
    return { text, at };
  }

  /**
   * @param {"object" | "array"} kind
   * @param {DataNode[]} children
   * @param {Props} props
   * @param {number} at
   */
  collection(kind, children, props, at) {
    /** @type {DataNode} */
    const node = { kind, children, ...this.where(at), from: at };
    if (props.own) this.own(node, props);
    this.building.add(node);
    return node;
  }

  /** The node an alias points to, shown again where the alias is. */
  alias(/** @type {string} */ name, /** @type {number} */ at) {
    const target = this.anchors.get(name);
    if (!target) throw new YamlFail(at, `Unknown alias *${name}.`);
    /** @type {DataNode} */
    const node = { kind: target.kind, alias: name, ...this.where(at), from: at, to: this.r.pos };
    if (this.building.has(target)) {
      node.children = [];
      this.warnings.push(errorAt(this.lines, at, `*${name} points to a node that contains it.`));
    } else if (target.children) node.children = target.children;
    else node.value = target.value;
    if (target.tag) node.tag = target.tag;
    return node;
  }

  /**
   * A scalar node, resolved by its tag or, plain, by the core schema.
   * @param {string} text
   * @param {"plain" | "quoted" | "block"} style
   * @param {Props} props
   * @param {number} from
   * @param {number} to
   * @returns {DataNode}
   */
  scalar(text, style, props, from, to) {
    /** @type {DataNode} */
    const node = { kind: "string", value: text, ...this.where(from), from, to };
    const tag = props.tag;
    resolve(node, text, style, tag);
    if (tag) node.tag = tag;
    if (props.anchor) {
      node.anchor = props.anchor;
      this.anchors.set(props.anchor, node);
    }
    return node;
  }
}
