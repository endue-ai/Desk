// A small DOM for the element tests, so they run in Node without a browser or a new dependency:
// elements, attributes, shadow roots, slots, events with bubbling and shadow retargeting, focus and
// custom elements. It is not a browser; people check the demo page in one. Import it before the
// elements: it installs itself on `globalThis`.

type Listener = (event: FakeEvent) => void;
type Init = { bubbles?: boolean; cancelable?: boolean; composed?: boolean };

class FakeEvent {
  readonly type: string;
  readonly bubbles: boolean;
  readonly cancelable: boolean;
  readonly composed: boolean;
  target: FakeNode | null = null;
  currentTarget: FakeNode | null = null;
  relatedTarget: FakeNode | null = null;
  defaultPrevented = false;
  stopped = false;
  stoppedNow = false;
  path: FakeNode[] = [];

  constructor(type: string, init: Init = {}) {
    this.type = type;
    this.bubbles = init.bubbles ?? false;
    this.cancelable = init.cancelable ?? false;
    this.composed = init.composed ?? false;
  }

  preventDefault(): void {
    if (this.cancelable) this.defaultPrevented = true;
  }

  stopPropagation(): void {
    this.stopped = true;
  }

  stopImmediatePropagation(): void {
    this.stopped = true;
    this.stoppedNow = true;
  }

  composedPath(): FakeNode[] {
    return [...this.path];
  }
}

class FakeCustomEvent extends FakeEvent {
  readonly detail: unknown;
  constructor(type: string, init: Init & { detail?: unknown } = {}) {
    super(type, init);
    this.detail = init.detail ?? null;
  }
}

class FakeKeyboardEvent extends FakeEvent {
  readonly key: string;
  readonly shiftKey: boolean;
  constructor(type: string, init: Init & { key?: string; shiftKey?: boolean } = {}) {
    super(type, init);
    this.key = init.key ?? "";
    this.shiftKey = init.shiftKey ?? false;
  }
}

class FakeFocusEvent extends FakeEvent {
  constructor(type: string, init: Init & { relatedTarget?: FakeNode | null } = {}) {
    super(type, init);
    this.relatedTarget = init.relatedTarget ?? null;
  }
}

class FakeNode {
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
      if (doc.focused && hosts(this, doc.focused)) doc.focused = null;
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

class FakeElement extends FakeNode {
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
      doc.moveFocus(this);
    }
  }

  blur(): void {
    if (doc.focused === this) doc.moveFocus(null);
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

class FakeShadowRoot extends FakeNode {
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

class FakeRegistry {
  readonly #byName = new Map<string, new () => FakeElement>();
  readonly #byClass = new Map<unknown, string>();

  define(name: string, element: new () => FakeElement): void {
    if (this.#byName.has(name) || this.#byClass.has(element)) {
      throw new Error(`"${name}" has already been defined`);
    }
    this.#byName.set(name, element);
    this.#byClass.set(element, name);
  }

  get(name: string): (new () => FakeElement) | undefined {
    return this.#byName.get(name);
  }

  nameOf(element: unknown): string | undefined {
    return this.#byClass.get(element);
  }
}

const registry = new FakeRegistry();

class FakeHTMLElement extends FakeElement {
  constructor() {
    const name = registry.nameOf(new.target);
    if (!name) throw new TypeError("Illegal constructor");
    super(name);
  }
}

class FakeDocument extends FakeNode {
  readonly body = new FakeElement("body");
  focused: FakeElement | null = null;

  get activeElement(): FakeElement | null {
    return activeIn(this) ?? this.body;
  }

  createElement(name: string): FakeElement {
    const element = registry.get(name);
    if (element) return new element();
    return name === "input" ? new FakeInput() : new FakeElement(name);
  }

  createTextNode(data: string): FakeText {
    return new FakeText(data);
  }

  moveFocus(next: FakeElement | null): void {
    const previous = this.focused;
    if (previous === next) return;
    this.focused = next;
    previous?.dispatchEvent(new FakeFocusEvent("blur", { composed: true, relatedTarget: next }));
    previous?.dispatchEvent(
      new FakeFocusEvent("focusout", { bubbles: true, composed: true, relatedTarget: next }),
    );
    next?.dispatchEvent(new FakeFocusEvent("focus", { composed: true, relatedTarget: previous }));
    next?.dispatchEvent(
      new FakeFocusEvent("focusin", { bubbles: true, composed: true, relatedTarget: previous }),
    );
  }
}

/** Every node under `root` in tree order, without entering shadow roots. */
function* descendants(root: FakeNode): Generator<FakeElement> {
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
  const focused = doc.focused;
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
  for (const element of elements) (element as { [callback]?: () => void })[callback]?.();
}

const doc = new FakeDocument();
doc.append(doc.body);

Object.assign(globalThis, {
  document: doc,
  customElements: registry,
  HTMLElement: FakeHTMLElement,
  Event: FakeEvent,
  CustomEvent: FakeCustomEvent,
  KeyboardEvent: FakeKeyboardEvent,
  FocusEvent: FakeFocusEvent,
});

/** Empty the page and drop focus, for a fresh start in each test. */
export function reset(): void {
  doc.body.replaceChildren();
  doc.focused = null;
}

/** The element that has focus, inside shadow roots too (`document.activeElement` stops at hosts). */
export function focused(): Element | null {
  return doc.focused as unknown as Element | null;
}

/** Press a key where focus is: keydown, then keyup. Returns whether keydown was prevented. */
export function press(key: string, init: { shiftKey?: boolean } = {}): boolean {
  const target = doc.focused ?? doc.body;
  const options = { bubbles: true, cancelable: true, composed: true, key, ...init };
  const down = new FakeKeyboardEvent("keydown", options);
  target.dispatchEvent(down);
  target.dispatchEvent(new FakeKeyboardEvent("keyup", options));
  return down.defaultPrevented;
}

/** Fire a pointer event that is not a click (`pointerdown`, `pointerenter`, `pointerleave`). */
export function pointer(target: Node, type: string): void {
  const bubbles = type === "pointerdown";
  (target as unknown as FakeNode).dispatchEvent(
    new FakeEvent(type, { bubbles, composed: bubbles }),
  );
}

/** The first element called `localName` under `root`, shadow root or not. */
export function query(root: Node | null, localName: string): HTMLElement {
  const found =
    root && [...descendants(root as unknown as FakeNode)].find((el) => el.localName === localName);
  if (!found) throw new Error(`no <${localName}> found`);
  return found as unknown as HTMLElement;
}

/** Give an element the box `getBoundingClientRect` reports. */
export function place(element: Element, rect: Partial<FakeElement["rect"]>): void {
  const fake = element as unknown as FakeElement;
  fake.rect = { ...fake.rect, ...rect };
}
