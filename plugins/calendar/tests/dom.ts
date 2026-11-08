// A small DOM for the view tests, so they run in Node without a browser or a new dependency: it reads
// the plugin's own index.html (well-formed markup only), and has what the view and the editor use:
// ids, simple selectors (tag, .class, [attr], [attr="v"], :checked, comma lists), closest, form fields,
// dialogs, focus and events that bubble. It is not a browser; the runtime e2e and people are.
type Listener = (event: FakeEvent) => void;

export class FakeEvent {
  target: El | null = null;
  defaultPrevented = false;
  stopped = false;
  constructor(
    readonly type: string,
    init: Record<string, unknown> = {},
  ) {
    Object.assign(this, init);
  }
  preventDefault() {
    this.defaultPrevented = true;
  }
  stopPropagation() {
    this.stopped = true;
  }
}

const VOID = new Set(["meta", "link", "input", "br", "img"]);

export class El {
  parent: El | null = null;
  children: Array<El | string> = [];
  attrs = new Map<string, string>();
  style: Record<string, string> = {};
  listeners = new Map<string, Listener[]>();
  #value = "";
  checked = false;
  scrollTop = 0;
  scrollHeight = 0;
  constructor(
    readonly tagName: string,
    readonly doc: FakeDoc,
  ) {}

  getAttribute(name: string) {
    return this.attrs.get(name) ?? null;
  }
  setAttribute(name: string, value: string) {
    this.attrs.set(name, String(value));
    if (name === "value") this.value = String(value);
    if (name === "checked") this.checked = true;
  }
  removeAttribute(name: string) {
    this.attrs.delete(name);
  }
  get value() {
    return this.#value;
  }
  set value(text: string) {
    this.#value = text;
  }
  get id() {
    return this.getAttribute("id") ?? "";
  }
  get className() {
    return this.getAttribute("class") ?? "";
  }
  set className(value: string) {
    this.setAttribute("class", value);
  }
  get hidden() {
    return this.attrs.has("hidden");
  }
  set hidden(on: boolean) {
    if (on) this.attrs.set("hidden", "");
    else this.attrs.delete("hidden");
  }
  get disabled() {
    return this.attrs.has("disabled");
  }
  set disabled(on: boolean) {
    if (on) this.attrs.set("disabled", "");
    else this.attrs.delete("disabled");
  }
  get open() {
    return this.attrs.has("open");
  }
  get tabIndex() {
    return Number(this.getAttribute("tabindex") ?? -1);
  }
  set tabIndex(n: number) {
    this.setAttribute("tabindex", String(n));
  }
  set placeholder(text: string) {
    this.setAttribute("placeholder", text);
  }
  set title(text: string) {
    this.setAttribute("title", text);
  }
  get textContent(): string {
    return this.children.map((c) => (typeof c === "string" ? c : c.textContent)).join("");
  }
  set textContent(text: string) {
    this.children = text ? [text] : [];
  }
  get elements() {
    return { namedItem: (name: string) => this.all().find((e) => e.getAttribute("name") === name) };
  }
  append(...items: Array<El | string>) {
    for (const item of items) {
      if (item instanceof El) item.parent = this;
      this.children.push(item);
    }
  }
  prepend(...items: Array<El | string>) {
    for (const item of items) if (item instanceof El) item.parent = this;
    this.children.unshift(...items);
  }
  replaceChildren(...items: Array<El | string>) {
    this.children = [];
    this.append(...items);
  }
  contains(other: El | null): boolean {
    for (let at = other; at; at = at.parent) if (at === this) return true;
    return false;
  }
  all(): El[] {
    return this.children.flatMap((c) => (typeof c === "string" ? [] : [c, ...c.all()]));
  }
  querySelectorAll(selector: string) {
    return this.all().filter((e) => e.matches(selector));
  }
  querySelector(selector: string) {
    return this.querySelectorAll(selector)[0] ?? null;
  }
  matches(selector: string): boolean {
    return selector.split(",").some((one) => {
      const text = one.trim();
      const tag = /^[a-z0-9-]+/i.exec(text)?.[0];
      if (tag && tag !== this.tagName) return false;
      for (const [, name, value] of text.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g))
        if (
          value === undefined
            ? !this.attrs.has(name ?? "")
            : this.getAttribute(name ?? "") !== value
        )
          return false;
      const classes = this.className.split(/\s+/);
      for (const [, name] of text.replace(/\[[^\]]*\]/g, "").matchAll(/\.([\w-]+)/g))
        if (!classes.includes(name ?? "")) return false;
      return !text.includes(":checked") || this.checked;
    });
  }
  closest(selector: string) {
    for (let at: El | null = this; at; at = at.parent) if (at.matches(selector)) return at;
    return null;
  }
  addEventListener(type: string, listener: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  dispatchEvent(event: FakeEvent) {
    event.target ??= this;
    for (let at: El | null = this; at && !event.stopped; at = at.parent)
      for (const listener of at.listeners.get(event.type) ?? []) listener(event);
    if (!event.stopped)
      for (const listener of this.doc.listeners.get(event.type) ?? []) listener(event);
    return !event.defaultPrevented;
  }
  click() {
    if (this.disabled) return;
    this.dispatchEvent(new FakeEvent("click"));
    if (this.tagName === "button" && this.getAttribute("type") === "submit")
      this.closest("form")?.dispatchEvent(new FakeEvent("submit"));
  }
  focus() {
    this.doc.activeElement = this;
  }
  getBoundingClientRect() {
    return { top: 0, left: 0, width: 100, height: 1440 };
  }
  showModal() {
    this.attrs.set("open", "");
  }
  close() {
    this.attrs.delete("open");
  }
}

/** Selects take their value from their options, as a browser does. */
class Select extends El {
  #value: string | undefined;
  override get value() {
    const options = this.querySelectorAll("option");
    const chosen = options.find((o) => o.value === this.#value) ?? options[0];
    return chosen?.value ?? "";
  }
  override set value(v: string) {
    this.#value = v;
  }
}

class Option extends El {
  override get value() {
    return this.getAttribute("value") ?? this.textContent;
  }
  override set value(_: string) {}
}

export class FakeDoc {
  body = new El("body", this);
  activeElement: El | null = null;
  listeners = new Map<string, Listener[]>();
  createElement(tag: string): El {
    return tag === "select"
      ? new Select(tag, this)
      : tag === "option"
        ? new Option(tag, this)
        : new El(tag, this);
  }
  getElementById(id: string) {
    return this.body.querySelector(`[id="${id}"]`);
  }
  querySelectorAll(selector: string) {
    return this.body.querySelectorAll(selector);
  }
  querySelector(selector: string) {
    return this.body.querySelector(selector);
  }
  addEventListener(type: string, listener: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
}

/** A document holding the <body> of well-formed HTML. */
export function documentOf(html: string): FakeDoc {
  const doc = new FakeDoc();
  const body = html.slice(html.indexOf("<body>") + 6, html.indexOf("</body>"));
  const stack: El[] = [doc.body];
  for (const [, close, tag, attrs, text] of body.matchAll(/<(\/?)([a-z0-9-]+)([^>]*)>|([^<]+)/gi)) {
    const top = stack.at(-1) as El;
    if (text !== undefined) {
      if (text.trim()) top.append(text.trim());
      continue;
    }
    if (close) {
      stack.pop();
      continue;
    }
    const el = doc.createElement((tag ?? "").toLowerCase());
    for (const [, name, , value] of (attrs ?? "").matchAll(/([\w-]+)(="([^"]*)")?/g))
      el.setAttribute(name ?? "", value ?? "");
    top.append(el);
    if (!VOID.has(el.tagName) && !(attrs ?? "").trim().endsWith("/")) stack.push(el);
  }
  return doc;
}

export const key = (k: string, more: Record<string, unknown> = {}) =>
  new FakeEvent("keydown", { key: k, metaKey: false, ctrlKey: false, altKey: false, ...more });
