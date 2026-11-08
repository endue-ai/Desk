// Nodes, elements, shadow roots and the document of the test DOM, with events that bubble and
// retarget through shadow roots, focus, and custom element callbacks.
import { FakeEvent, FakeFocusEvent } from "./events";

type Listener = (event: FakeEvent) => void;

/** Where focus is, for the whole test DOM. */
export const focus: { element: FakeElement | null } = { element: null };

export class FakeNode {
  parentNode: FakeNode | null = null;
  readonly childNodes: FakeNode[] = [];
  readonly #listeners = new Map<string, Listener[]>();

  get parentElement(): FakeElement | null {
    return this.parentNode instanceof FakeElement ? this.parentNode : null;
  }

  get textContent(): string {
    return this.childNodes.map((node) => node.textContent).join("");
  }

  set textContent(value: string) {
    this.replaceChildren(...(value ? [value] : []));
  }

  get isConnected(): boolean {
    const root = this.getRootNode();
    if (root instanceof FakeShadowRoot) return root.host.isConnected;
    return root instanceof FakeDocument;
  }

  append(...items: (FakeNode | string)[]): void {
    for (const item of items) {
      const node = typeof item === "string" ? new FakeText(item) : item;
      node.remove();
      node.parentNode = this;
      this.childNodes.push(node);
      if (this.isConnected) react(node, "connectedCallback");
    }
    this.childrenChanged();
  }

  replaceChildren(...items: (FakeNode | string)[]): void {
    for (const child of [...this.childNodes]) child.remove();
    this.append(...items);
  }

  remove(): void {
    const parent = this.parentNode;
    if (!parent) return;
    const wasConnected = this.isConnected;
    parent.childNodes.splice(parent.childNodes.indexOf(this), 1);
    this.parentNode = null;
    if (wasConnected) {
      if (focus.element && hosts(this, focus.element)) focus.element = null;
      react(this, "disconnectedCallback");
    }
    parent.childrenChanged();
  }

  contains(other: FakeNode | null): boolean {
    for (let node = other; node; node = node.parentNode) if (node === this) return true;
    return false;
  }

  getRootNode(): FakeNode {
    let node: FakeNode = this;
    while (node.parentNode) node = node.parentNode;
    return node;
  }

  addEventListener(type: string, listener: Listener): void {
    const listeners = this.#listeners.get(type) ?? [];
    if (!listeners.includes(listener)) listeners.push(listener);
    this.#listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: Listener): void {
    const listeners = this.#listeners.get(type) ?? [];
    this.#listeners.set(
      type,
      listeners.filter((entry) => entry !== listener),
    );
  }

  dispatchEvent(event: FakeEvent): boolean {
    const path: FakeNode[] = [];
    for (let node: FakeNode | null = this; node; ) {
      path.push(node);
      if (node instanceof FakeShadowRoot) node = event.composed ? node.host : null;
      else node = node.parentNode;
    }
    event.path = path;
    const related = event.relatedTarget;
    for (const node of path) {
      const target = retarget(this, node);
      if (!event.bubbles && target !== node) continue;
      event.target = target;
      event.currentTarget = node;
      event.relatedTarget = related && retarget(related, node);
      for (const listener of [...(node.#listeners.get(event.type) ?? [])]) {
        listener.call(node, event);
        if (event.stoppedNow) break;
      }
      if (event.stopped) break;
    }
    event.currentTarget = null;
    return !event.defaultPrevented;
  }

  childrenChanged(): void {}
}

class FakeText extends FakeNode {
  constructor(public data: string) {
    super();
  }

  override get textContent(): string {
    return this.data;
  }

  override set textContent(value: string) {
    this.data = value;
  }
}

const NATIVE_FOCUSABLE = new Set(["button", "input", "select", "textarea"]);

export class FakeElement extends FakeNode {
  readonly localName: string;
  shadowRoot: FakeShadowRoot | null = null;
  style: Record<string, string> = {};
  rect = { top: 0, right: 0, bottom: 0, left: 0, width: 0, height: 0 };
  readonly #attributes = new Map<string, string>();

  constructor(localName: string) {
    super();
    this.localName = localName;
  }

  get tagName(): string {
    return this.localName.toUpperCase();
  }

  get children(): FakeElement[] {
    return this.childNodes.filter((node): node is FakeElement => node instanceof FakeElement);
  }

  get id(): string {
    return this.getAttribute("id") ?? "";
  }

  set id(value: string) {
    this.setAttribute("id", value);
  }

  get hidden(): boolean {
    return this.hasAttribute("hidden");
  }

  set hidden(value: boolean) {
    this.toggleAttribute("hidden", value);
  }

  get tabIndex(): number {
    const value = this.getAttribute("tabindex");
    if (value !== null && /^-?\d+$/.test(value)) return Number(value);
    return NATIVE_FOCUSABLE.has(this.localName) ? 0 : -1;
  }

  set tabIndex(value: number) {
    this.setAttribute("tabindex", String(value));
  }

  getAttribute(name: string): string | null {
    return this.#attributes.get(name) ?? null;
  }

  hasAttribute(name: string): boolean {
    return this.#attributes.has(name);
  }

  setAttribute(name: string, value: string): void {
    const old = this.getAttribute(name);
    this.#attributes.set(name, String(value));
    this.#changed(name, old, String(value));
  }

  removeAttribute(name: string): void {
    const old = this.getAttribute(name);
    if (old === null) return;
    this.#attributes.delete(name);
    this.#changed(name, old, null);
  }

  toggleAttribute(name: string, force?: boolean): boolean {
    const on = force ?? !this.hasAttribute(name);
    if (on && !this.hasAttribute(name)) this.setAttribute(name, "");
    if (!on) this.removeAttribute(name);
    return on;
  }

  attachShadow(init: { mode: string; delegatesFocus?: boolean }): FakeShadowRoot {
    if (this.shadowRoot) throw new Error("the element already has a shadow root");
    this.shadowRoot = new FakeShadowRoot(this, init.delegatesFocus ?? false);
    return this.shadowRoot;
  }

  getBoundingClientRect() {
    return { ...this.rect, x: this.rect.left, y: this.rect.top };
  }

  scrollIntoView(): void {}

  focus(): void {
    if (this.shadowRoot?.delegatesFocus) {
      [...descendants(this.shadowRoot)].find(focusable)?.focus();
    } else if (focusable(this)) {
      moveFocus(this);
    }
  }

  blur(): void {
    if (focus.element === this) moveFocus(null);
  }

  click(): void {
    if (NATIVE_FOCUSABLE.has(this.localName) && this.hasAttribute("disabled")) return;
    this.dispatchEvent(new FakeEvent("click", { bubbles: true, cancelable: true, composed: true }));
  }

  override childrenChanged(): void {
    if (!this.shadowRoot) return;
    for (const node of descendants(this.shadowRoot)) {
      if (node.localName === "slot")
        node.dispatchEvent(new FakeEvent("slotchange", { bubbles: true }));
    }
  }

  #changed(name: string, old: string | null, value: string | null): void {
    const { observedAttributes } = this.constructor as { observedAttributes?: readonly string[] };
    const self = this as { attributeChangedCallback?: (...args: (string | null)[]) => void };
    if (observedAttributes?.includes(name)) self.attributeChangedCallback?.(name, old, value);
  }
}

class FakeInput extends FakeElement {
  value = "";

  constructor() {
    super("input");
  }

  get type(): string {
    return this.getAttribute("type") ?? "text";
  }

  set type(value: string) {
    this.setAttribute("type", value);
  }

  get disabled(): boolean {
    return this.hasAttribute("disabled");
  }

  set disabled(value: boolean) {
    this.toggleAttribute("disabled", value);
  }
}

export class FakeShadowRoot extends FakeNode {
  constructor(
    readonly host: FakeElement,
    readonly delegatesFocus: boolean,
  ) {
    super();
  }

  get activeElement(): FakeElement | null {
    return activeIn(this);
  }
}

export class FakeDocument extends FakeNode {
  readonly body = new FakeElement("body");

  constructor(readonly lookup: (name: string) => (new () => FakeElement) | undefined) {
    super();
  }

  get activeElement(): FakeElement | null {
    return activeIn(this) ?? this.body;
  }

  createElement(name: string): FakeElement {
    const element = this.lookup(name);
    if (element) return new element();
    return name === "input" ? new FakeInput() : new FakeElement(name);
  }

  createTextNode(data: string): FakeText {
    return new FakeText(data);
  }
}

/** Move focus, firing blur, focusout, focus and focusin as a browser does. */
export function moveFocus(next: FakeElement | null): void {
  const previous = focus.element;
  if (previous === next) return;
  focus.element = next;
  previous?.dispatchEvent(new FakeFocusEvent("blur", { composed: true, relatedTarget: next }));
  previous?.dispatchEvent(
    new FakeFocusEvent("focusout", { bubbles: true, composed: true, relatedTarget: next }),
  );
  next?.dispatchEvent(new FakeFocusEvent("focus", { composed: true, relatedTarget: previous }));
  next?.dispatchEvent(
    new FakeFocusEvent("focusin", { bubbles: true, composed: true, relatedTarget: previous }),
  );
}

/** Every node under `root` in tree order, without entering shadow roots. */
export function* descendants(root: FakeNode): Generator<FakeElement> {
  for (const node of root.childNodes) {
    if (node instanceof FakeElement) yield node;
    yield* descendants(node);
  }
}

/** Whether `ancestor` holds `node`, looking through shadow roots to their hosts. */
function hosts(ancestor: FakeNode, node: FakeNode): boolean {
  for (let at: FakeNode | null = node; at; ) {
    if (at === ancestor) return true;
    at = at instanceof FakeShadowRoot ? at.host : at.parentNode;
  }
  return false;
}

/** The DOM's retargeting: `node` as a listener on `listener` may see it. */
function retarget(node: FakeNode, listener: FakeNode): FakeNode {
  let at = node;
  for (;;) {
    const root = at.getRootNode();
    if (!(root instanceof FakeShadowRoot) || hosts(root, listener)) return at;
    at = root.host;
  }
}

function activeIn(root: FakeNode): FakeElement | null {
  const focused = focus.element;
  if (!focused || !hosts(root, focused)) return null;
  const active = retarget(focused, root);
  return active instanceof FakeElement && active.getRootNode() === root ? active : null;
}

function focusable(element: FakeElement): boolean {
  if (!element.isConnected || element.hasAttribute("disabled")) return false;
  for (let at: FakeNode | null = element; at; ) {
    if (at instanceof FakeElement && (at.hidden || at.hasAttribute("inert"))) return false;
    at = at instanceof FakeShadowRoot ? at.host : at.parentNode;
  }
  return element.hasAttribute("tabindex") || NATIVE_FOCUSABLE.has(element.localName);
}

/** Call `callback` on every element in the subtree (shadow trees too) that has one. */
function react(root: FakeNode, callback: "connectedCallback" | "disconnectedCallback"): void {
  const elements: FakeElement[] = [];
  const collect = (node: FakeNode) => {
    if (node instanceof FakeElement) elements.push(node);
    for (const child of node.childNodes) collect(child);
    if (node instanceof FakeElement && node.shadowRoot) collect(node.shadowRoot);
  };
  collect(root);
  for (const element of elements)
    (element as unknown as Record<typeof callback, (() => void) | undefined>)[callback]?.();
}
