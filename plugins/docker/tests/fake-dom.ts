// Just enough of a document for the renderers and the tree (tests run without jsdom): elements with
// attributes, classes, dataset and style, children, focus, `closest` and `querySelector` for the
// simple selectors the plugin uses (tag, .class, [attr], tag.class).

type Listener = (event: FakeEvent) => void;
export interface FakeEvent {
  type: string;
  target: FakeNode;
  key?: string;
  defaultPrevented: boolean;
  preventDefault(): void;
  [more: string]: unknown;
}

export class FakeNode {
  children: FakeNode[] = [];
  attributes: Record<string, string> = {};
  dataset: Record<string, string> = {};
  style: Record<string, string> = {};
  className = "";
  tabIndex = -1;
  hidden = false;
  value = "";
  parent: FakeNode | null = null;
  listeners: Record<string, Listener[]> = {};
  constructor(
    readonly doc: FakeDocument,
    readonly tag: string,
    readonly text = "",
  ) {}
  get id() {
    return this.attributes.id ?? "";
  }
  get tagName() {
    return this.tag.toUpperCase();
  }
  addEventListener(type: string, fn: Listener) {
    this.listeners[type] = [...(this.listeners[type] ?? []), fn];
  }
  /** Fire an event at this node; it bubbles up to the document. */
  fire(type: string, init: Record<string, unknown> = {}): FakeEvent {
    const event: FakeEvent = {
      type,
      target: this,
      defaultPrevented: false,
      preventDefault() {
        event.defaultPrevented = true;
      },
      ...init,
    };
    for (let at: FakeNode | null = this; at; at = at.parent)
      for (const fn of at.listeners[type] ?? []) fn(event);
    for (const fn of this.doc.listeners[type] ?? []) fn(event);
    return event;
  }
  /** A key press, as the view reads it. */
  key(key: string, shift = key.length === 1 && key !== key.toLowerCase()) {
    return this.fire("keydown", {
      key,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      shiftKey: shift,
    });
  }
  querySelectorAll(selector: string) {
    return this.all(selector);
  }
  get classList() {
    const names = () => this.className.split(/\s+/).filter(Boolean);
    return {
      contains: (name: string) => names().includes(name),
      toggle: (name: string, on?: boolean) => {
        const has = names().includes(name);
        const want = on ?? !has;
        this.className = want
          ? has
            ? this.className
            : [...names(), name].join(" ")
          : names()
              .filter((n) => n !== name)
              .join(" ");
        return want;
      },
    };
  }
  setAttribute(name: string, value: string) {
    this.attributes[name] = String(value);
    if (name === "class") this.className = String(value);
    if (name.startsWith("data-"))
      this.dataset[name.slice(5).replace(/-(\w)/g, (_, c: string) => c.toUpperCase())] =
        String(value);
  }
  getAttribute(name: string) {
    return this.attributes[name] ?? null;
  }
  append(...nodes: FakeNode[]) {
    for (const node of nodes) {
      node.parent = this;
      this.children.push(node);
    }
  }
  replaceChildren(...nodes: FakeNode[]) {
    this.children = [];
    this.append(...nodes);
  }
  get firstChild(): FakeNode | null {
    return this.children[0] ?? null;
  }
  get childElementCount() {
    return this.children.filter((c) => c.tag !== "#text").length;
  }
  get textContent(): string {
    return this.text + this.children.map((c) => c.textContent).join(" ");
  }
  set textContent(value: string) {
    this.replaceChildren(new FakeNode(this.doc, "#text", value));
  }
  focus() {
    if (this.doc.activeElement === this) return;
    this.doc.activeElement = this;
    this.fire("focusin");
  }
  scrollIntoView() {}
  contains(node: FakeNode | null): boolean {
    for (let at = node; at; at = at.parent) if (at === this) return true;
    return false;
  }
  matches(selector: string): boolean {
    const found = /^(\w+)?(?:\.([\w-]+))?(?:\[([\w-]+)\])?$/.exec(selector);
    if (!found) return false;
    const [, tag, cls, attr] = found;
    if (tag && this.tag !== tag) return false;
    if (cls && !this.classList.contains(cls)) return false;
    if (attr) {
      const key = attr.startsWith("data-")
        ? attr.slice(5).replace(/-(\w)/g, (_, c: string) => c.toUpperCase())
        : "";
      if (!(attr in this.attributes) && !(key && key in this.dataset)) return false;
    }
    return true;
  }
  closest(selector: string): FakeNode | null {
    for (let at: FakeNode | null = this; at; at = at.parent) if (at.matches(selector)) return at;
    return null;
  }
  querySelector(selector: string): FakeNode | null {
    for (const child of this.children) {
      if (child.matches(selector)) return child;
      const deeper = child.querySelector(selector);
      if (deeper) return deeper;
    }
    return null;
  }
  /** Every descendant matching, in document order. */
  all(selector: string): FakeNode[] {
    return this.children.flatMap((c) => [...(c.matches(selector) ? [c] : []), ...c.all(selector)]);
  }
}

export class FakeDocument {
  activeElement: FakeNode | null = null;
  listeners: Record<string, Listener[]> = {};
  body = new FakeNode(this, "body");
  createElement(tag: string) {
    return new FakeNode(this, tag);
  }
  createElementNS(_ns: string, tag: string) {
    return new FakeNode(this, tag);
  }
  createTextNode(text: string) {
    return new FakeNode(this, "#text", text);
  }
  addEventListener(type: string, fn: Listener) {
    this.listeners[type] = [...(this.listeners[type] ?? []), fn];
  }
  getElementById(id: string): FakeNode | null {
    const find = (node: FakeNode): FakeNode | null => {
      if (node.id === id) return node;
      for (const child of node.children) {
        const found = find(child);
        if (found) return found;
      }
      return null;
    };
    return find(this.body);
  }
}

/** A fresh document, typed as the DOM's for the code under test. */
export const fakeDocument = () => new FakeDocument() as unknown as Document & FakeDocument;

const VOID = new Set(["input", "meta", "link", "br", "img"]);

/** A document whose body is `html`'s: tags, attributes and nesting, without scripts or text. */
export function documentOf(html: string) {
  const doc = new FakeDocument();
  const body = html.slice(html.indexOf("<body>") + 6, html.indexOf("</body>"));
  const stack = [doc.body];
  for (const [, close, tag = "", attrs = ""] of body
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .matchAll(/<(\/?)(\w+)([^>]*)>/g)) {
    if (close) {
      stack.pop();
      continue;
    }
    const node = doc.createElement(tag);
    for (const [, name = "", value = ""] of attrs.matchAll(/([\w-]+)(?:="([^"]*)")?/g))
      if (name === "hidden") node.hidden = true;
      else node.setAttribute(name, value);
    stack.at(-1)?.append(node);
    if (!VOID.has(tag) && !attrs.trim().endsWith("/")) stack.push(node);
  }
  return doc as unknown as Document & FakeDocument;
}

/** The rows' text, with runs of space as one. */
export const texts = (rows: Array<{ el: unknown }>) =>
  rows.map((r) => (r.el as FakeNode).textContent.replace(/\s+/g, " ").trim());
