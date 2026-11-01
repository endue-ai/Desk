// Opens a document off the main thread. A worker has no DOMParser, so it gets its own: a parser that
// checks well-formedness and namespaces as the browser's does, and the part of the DOM the readers
// walk (names, namespaces, attributes, siblings, textContent, getElementsByTagName(NS), closest by
// element names). A document that does not parse is one <parsererror> element, as DOMParser
// answers, so a file opens alike on either thread. The model goes back in parts, so no message
// takes long to receive. Only relative imports: import maps do not reach a module worker.
import { openDocument } from "./open.js";

const XMLNS = "http://www.w3.org/2000/xmlns/";
const PREDEFINED = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

class XmlError extends Error {}
/** @returns {never} */
const fail = (/** @type {string} */ why) => {
  throw new XmlError(why);
};

class XNode {
  constructor(type, name, doc) {
    this.nodeType = type;
    this.nodeName = name;
    this.ownerDocument = doc;
    this.parentNode = this.parentElement = this.previousSibling = this.nextSibling = null;
  }
}

/** Text (3), CDATA (4), a processing instruction (7) or a comment (8). */
class XData extends XNode {
  constructor(type, name, data, doc) {
    super(type, name, doc);
    this.data = this.nodeValue = this.textContent = data;
  }
}

class XParent extends XNode {
  constructor(type, name, doc) {
    super(type, name, doc);
    this.childNodes = [];
    this.children = [];
    this.firstChild = this.lastChild = this.firstElementChild = this.lastElementChild = null;
    this.childElementCount = 0;
    this.nodeValue = null;
    /** Descendants by namespace and local name: the tree never changes, so answers are kept. */
    this.found = new Map();
  }
  /** Add `child` last, linking its siblings. */
  append(child) {
    child.parentNode = this;
    child.parentElement = this.nodeType === 1 ? this : null;
    child.previousSibling = this.lastChild;
    if (this.lastChild) this.lastChild.nextSibling = child;
    this.firstChild ??= child;
    this.lastChild = child;
    this.childNodes.push(child);
    if (child.nodeType !== 1) return child;
    child.previousElementSibling = this.lastElementChild;
    if (this.lastElementChild) this.lastElementChild.nextElementSibling = child;
    this.firstElementChild ??= child;
    this.lastElementChild = child;
    this.childElementCount = this.children.push(child);
    return child;
  }
  /** The descendant elements that pass `test`, in document order. */
  descendants(test) {
    const out = [];
    const stack = this.children.toReversed();
    while (stack.length) {
      const el = stack.pop();
      if (test(el)) out.push(el);
      for (let i = el.children.length - 1; i >= 0; i--) stack.push(el.children[i]);
    }
    return out;
  }
  getElementsByTagNameNS(ns, local) {
    const key = `${ns ?? ""} ${local}`;
    let hit = this.found.get(key);
    if (!hit) {
      const uri = ns === "" ? null : ns;
      const ok = (el) =>
        (uri === "*" || el.namespaceURI === uri) && (local === "*" || el.localName === local);
      hit = this.descendants(ok);
      this.found.set(key, hit);
    }
    return hit;
  }
  getElementsByTagName(name) {
    return this.descendants((el) => name === "*" || el.nodeName === name);
  }
}

class XElement extends XParent {
  constructor(name, prefix, local, ns, doc) {
    super(1, name, doc);
    this.tagName = name;
    this.prefix = prefix;
    this.localName = local;
    this.namespaceURI = ns;
    this.attributes = [];
    this.previousElementSibling = this.nextElementSibling = null;
  }
  getAttribute(name) {
    return this.attributes.find((a) => a.name === name)?.value ?? null;
  }
  get textContent() {
    const parts = [];
    const stack = [this];
    while (stack.length) {
      const node = stack.pop();
      if (node.nodeType === 3 || node.nodeType === 4) parts.push(node.data);
      else if (node.nodeType === 1)
        for (let i = node.childNodes.length - 1; i >= 0; i--) stack.push(node.childNodes[i]);
    }
    return parts.join("");
  }
  /** Selectors of element names only ("foot, endnote"), matched by local name as CSS does in XML. */
  matches(selector) {
    return selector.split(",").some((part) => part.trim() === this.localName);
  }
  closest(selector) {
    let at = this;
    while (at && !at.matches(selector)) at = at.parentElement;
    return at;
  }
}

class XDocument extends XParent {
  constructor() {
    super(9, "#document", null);
    this.documentElement = this.textContent = null;
  }
}

const character = (n, ref) =>
  Number.isInteger(n) && n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff)
    ? String.fromCodePoint(n)
    : fail(`the character reference ${ref}`);

/** Expand character and entity references; a bare & or an undeclared entity is an error. */
function expand(text, entities) {
  if (!text.includes("&")) return text;
  let out = "";
  let at = 0;
  for (let amp = text.indexOf("&"); amp >= 0; amp = text.indexOf("&", at)) {
    const semi = text.indexOf(";", amp);
    if (semi < 0) fail("an & that starts no reference");
    const ref = text.slice(amp + 1, semi);
    const value = ref.startsWith("#x")
      ? character(Number.parseInt(ref.slice(2), 16), ref)
      : ref.startsWith("#")
        ? character(Number(ref.slice(1)), ref)
        : (entities[ref] ?? fail(`the undeclared entity ${ref}`));
    out += text.slice(at, amp) + value;
    at = semi + 1;
  }
  return out + text.slice(at);
}

/** Skip a DOCTYPE, keeping the simple general entities of its internal subset. */
function doctype(s, at, entities) {
  let depth = 0;
  for (let i = at; i < s.length; i++) {
    const c = s[i];
    if (c === "[") depth++;
    else if (c === "]") depth--;
    else if (c === '"' || c === "'") i = s.indexOf(c, i + 1) < 0 ? s.length : s.indexOf(c, i + 1);
    else if (c === ">" && depth <= 0) {
      for (const m of s
        .slice(at, i)
        .matchAll(/<!ENTITY\s+([^\s%]+)\s+(?:"([^"]*)"|'([^']*)')\s*>/g))
        entities[m[1]] ??= m[2] ?? m[3] ?? "";
      return i + 1;
    }
  }
  return fail("an unclosed DOCTYPE");
}

/** A qualified name's prefix (or null) and local name. */
function split(name) {
  const colon = name.indexOf(":");
  if (colon < 0) return [null, name];
  if (colon === 0 || colon === name.length - 1 || name.includes(":", colon + 1))
    fail(`${name} is not a qualified name`);
  return [name.slice(0, colon), name.slice(colon + 1)];
}

const isSpace = (c) => c === " " || c === "\n" || c === "\t";
const NAME_END = new Set([" ", "\n", "\t", ">", "/", "="]);

/** Parse a whole XML text into an XDocument; throws XmlError where it is not well-formed. */
function parse(source) {
  let s = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  if (s.includes("\r")) s = s.replace(/\r\n?/g, "\n");
  const n = s.length;
  const doc = new XDocument();
  const entities = Object.assign(Object.create(null), PREDEFINED);
  const open = [];
  /** Prefix -> namespace, one prototype link per element that declares any; "" is the default. */
  let scope = Object.assign(Object.create(null), { xml: "http://www.w3.org/XML/1998/namespace" });
  const scopes = [];
  let parent = doc;
  const spaces = (at) => {
    while (at < n && isSpace(s[at])) at++;
    return at;
  };
  const nameEnd = (at) => {
    while (at < n && !NAME_END.has(s[at])) at++;
    return at;
  };
  const resolve = (prefix, own) => own[prefix] ?? fail(`the prefix ${prefix} is not declared`);

  const startTag = (from) => {
    let at = nameEnd(from);
    const name = s.slice(from, at);
    if (!name) fail("a tag without a name");
    const raw = [];
    let empty = false;
    for (;;) {
      const before = at;
      at = spaces(at);
      if (at >= n) fail(`the tag ${name} is not closed`);
      if (s[at] === ">" || (s[at] === "/" && s[at + 1] === ">")) {
        empty = s[at] === "/";
        at += empty ? 2 : 1;
        break;
      }
      if (at === before) fail(`no space before an attribute of ${name}`);
      const start = at;
      at = spaces(nameEnd(at));
      const key = s.slice(start, nameEnd(start));
      if (!key || s[at] !== "=") fail(`the attribute ${key} has no value`);
      at = spaces(at + 1);
      const quote = s[at];
      const close = quote === '"' || quote === "'" ? s.indexOf(quote, at + 1) : -1;
      if (close < 0) fail(`the attribute ${key} is not quoted`);
      const value = s.slice(at + 1, close);
      if (value.includes("<")) fail(`a < in the attribute ${key}`);
      if (raw.some(([k]) => k === key)) fail(`the attribute ${key} is repeated`);
      raw.push([key, expand(value.replace(/[\t\n]/g, " "), entities)]);
      at = close + 1;
    }
    // Declarations first: they hold for the element's own name and attributes.
    let own = scope;
    for (const [key, value] of raw) {
      if (key !== "xmlns" && !key.startsWith("xmlns:")) continue;
      if (own === scope) own = Object.create(scope);
      own[key === "xmlns" ? "" : key.slice(6)] = value === "" ? null : value;
    }
    const [prefix, local] = split(name);
    const el = new XElement(
      name,
      prefix,
      local,
      prefix ? resolve(prefix, own) : (own[""] ?? null),
      doc,
    );
    for (const [key, value] of raw) {
      const [p, l] = key === "xmlns" ? [null, "xmlns"] : split(key);
      const ns = key === "xmlns" || p === "xmlns" ? XMLNS : p ? resolve(p, own) : null;
      el.attributes.push({ name: key, prefix: p, localName: l, namespaceURI: ns, value });
    }
    if (open.length === 0) {
      if (doc.documentElement) fail("a second root element");
      doc.documentElement = el;
    }
    parent.append(el);
    if (!empty) {
      open.push(el);
      scopes.push(scope);
      scope = own;
      parent = el;
    }
    return at;
  };

  for (let i = 0; i < n; ) {
    const lt = s.indexOf("<", i);
    const end = lt < 0 ? n : lt;
    if (end > i) {
      const text = s.slice(i, end);
      if (open.length) parent.append(new XData(3, "#text", expand(text, entities), doc));
      else if (text.trim()) fail("text outside the root element");
    }
    if (lt < 0) break;
    if (s[lt + 1] === "/") {
      const gt = s.indexOf(">", lt);
      const name = gt < 0 ? "" : s.slice(lt + 2, gt).trimEnd();
      if (open.pop()?.nodeName !== name) fail(`the end tag ${name} does not match`);
      scope = scopes.pop();
      parent = open.at(-1) ?? doc;
      i = gt + 1;
    } else if (s.startsWith("<!--", lt)) {
      const close = s.indexOf("-->", lt + 4);
      if (close < 0) fail("an unclosed comment");
      parent.append(new XData(8, "#comment", s.slice(lt + 4, close), doc));
      i = close + 3;
    } else if (s.startsWith("<![CDATA[", lt)) {
      const close = s.indexOf("]]>", lt + 9);
      if (close < 0 || !open.length) fail("a CDATA section out of place");
      parent.append(new XData(4, "#cdata-section", s.slice(lt + 9, close), doc));
      i = close + 3;
    } else if (s.startsWith("<!DOCTYPE", lt) && !doc.documentElement) {
      i = doctype(s, lt + 9, entities);
    } else if (s[lt + 1] === "?") {
      const close = s.indexOf("?>", lt + 2);
      if (close < 0) fail("an unclosed processing instruction");
      const target = s.slice(lt + 2, nameEnd(lt + 2));
      if (target.toLowerCase() !== "xml")
        parent.append(new XData(7, target, s.slice(lt + 2 + target.length, close).trim(), doc));
      i = close + 2;
    } else if (s[lt + 1] === "!") fail("markup that is not XML");
    else i = startTag(lt + 1);
  }
  if (open.length) fail(`the element ${open.at(-1).nodeName} is not closed`);
  if (!doc.documentElement) fail("no root element");
  return doc;
}

/** DOMParser for XML, for a worker. */
export class XmlDomParser {
  parseFromString(text, _type) {
    try {
      return parse(text);
    } catch (error) {
      if (!(error instanceof XmlError)) throw error;
      const doc = new XDocument();
      const ns = "http://www.mozilla.org/newlayout/xml/parsererror.xml";
      doc.documentElement = doc.append(new XElement("parsererror", null, "parsererror", ns, doc));
      doc.documentElement.append(new XData(3, "#text", error.message, doc));
      return doc;
    }
  }
}

/** About how many bytes a value takes to send: its strings (pictures' data: URLs) and a little more. */
function weight(value) {
  if (typeof value === "string") return value.length;
  if (!value || typeof value !== "object") return 8;
  let sum = 16;
  for (const item of Array.isArray(value) ? value : Object.values(value)) sum += weight(item);
  return sum;
}

/** One message holds at most this many blocks, or about this many bytes. */
const PART = { items: 400, bytes: 4 * 1024 * 1024 };

/**
 * Open `bytes` and send the model: the document without its blocks, notes and comments ("head"),
 * then those in parts ("part"), then "done" (which carries a details model whole).
 * @param {{ bytes: Uint8Array, path: string }} request
 * @param {(message: Record<string, unknown>) => void} send
 */
export async function handleOpen({ bytes, path }, send) {
  const doc = await openDocument(bytes, path);
  if (doc.kind !== "document") return send({ type: "done", doc });
  const empty = {
    sections: doc.sections.map((s) => ({ ...s, blocks: [] })),
    notes: [],
    comments: [],
  };
  send({ type: "head", doc: { ...doc, ...empty } });
  const parts = (/** @type {unknown[]} */ list, /** @type {number | string} */ at) => {
    let items = [];
    let bytes = 0;
    for (const item of list) {
      items.push(item);
      bytes += weight(item);
      if (items.length < PART.items && bytes < PART.bytes) continue;
      send({ type: "part", at, items });
      items = [];
      bytes = 0;
    }
    if (items.length) send({ type: "part", at, items });
  };
  for (const [index, section] of doc.sections.entries()) parts(section.blocks, index);
  parts(doc.notes, "notes");
  parts(doc.comments, "comments");
  send({ type: "done" });
}

if (typeof document === "undefined" && typeof postMessage === "function") {
  globalThis.DOMParser ??= /** @type {typeof DOMParser} */ (/** @type {unknown} */ (XmlDomParser));
  globalThis.onmessage = ({ data }) =>
    handleOpen(data, (message) => postMessage(message)).catch((error) =>
      postMessage({
        type: "failed",
        message: error instanceof Error ? error.message : String(error),
      }),
    );
}
