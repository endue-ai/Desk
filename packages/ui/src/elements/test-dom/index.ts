// A small DOM for the element tests, so they run in Node without a browser or a new dependency:
// elements, attributes, shadow roots, slots, events with bubbling and shadow retargeting, focus and
// custom elements. It is not a browser; people check the demo page in one. Import it before the
// elements: it installs itself on `globalThis`.
import { FakeCustomEvent, FakeEvent, FakeFocusEvent, FakeKeyboardEvent } from "./events";
import { descendants, FakeDocument, FakeElement, type FakeNode, focus } from "./nodes";

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

const doc = new FakeDocument((name) => registry.get(name));
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
  focus.element = null;
}

/** The element that has focus, inside shadow roots too (`document.activeElement` stops at hosts). */
export function focused(): Element | null {
  return focus.element as unknown as Element | null;
}

/** Press a key where focus is: keydown, then keyup. Returns whether keydown was prevented. */
export function press(key: string, init: { shiftKey?: boolean } = {}): boolean {
  const target = focus.element ?? doc.body;
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

/** Every element under `root` (a shadow root or an element) that `predicate` keeps, in tree order. */
export function queryAll(
  root: Node | Element | ShadowRoot | null,
  predicate: (element: HTMLElement) => boolean,
): HTMLElement[] {
  if (!root) return [];
  const all = [...descendants(root as unknown as FakeNode)] as unknown as HTMLElement[];
  return all.filter(predicate);
}

/** Give an element the box `getBoundingClientRect` reports. */
export function place(element: Element, rect: Partial<FakeElement["rect"]>): void {
  const fake = element as unknown as FakeElement;
  fake.rect = { ...fake.rect, ...rect };
}
