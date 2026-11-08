// What the desk draws for a drag between frames (ADR 0119): the drag image under the pointer, above
// every frame, with the effect the frame under it answered (+ copy, ↗ link, ⊘ refused), and a
// transparent shield over the frames, so a pointer the source frame no longer holds reaches the desk
// and no frame under it reacts on its own. Colours, type and corners come from the theme's tokens.
import { LAYER_ATTRIBUTE } from "./frames";
import type { DragImage, DragKeys, DropAnswer, Point } from "./types";

const CSS = `
.desk-dnd-shield { position: fixed; inset: 0; z-index: 2147483646; background: transparent;
  cursor: grabbing; touch-action: none; }
.desk-dnd-shield[data-effect="copy"] { cursor: copy; }
.desk-dnd-shield[data-effect="link"] { cursor: alias; }
.desk-dnd-shield[data-effect="none"] { cursor: no-drop; }
.desk-dnd-image { position: fixed; left: 0; top: 0; z-index: 2147483647; pointer-events: none;
  display: flex; align-items: center; gap: var(--desk-space-2); max-width: 18rem;
  padding: var(--desk-space-1) var(--desk-space-3); color: var(--desk-text);
  background: var(--desk-popover, var(--desk-background)); border: var(--desk-border-width) solid
  var(--desk-border); border-radius: var(--desk-radius-md); box-shadow: var(--desk-shadow-md);
  font: var(--desk-text-sm) var(--desk-font-sans); white-space: nowrap; }
.desk-dnd-image[data-effect="none"] { opacity: 0.6; }
.desk-dnd-image img { max-width: 8rem; max-height: 6rem; border-radius: var(--desk-radius-sm); }
.desk-dnd-label { overflow: hidden; text-overflow: ellipsis; }
.desk-dnd-detail { color: var(--desk-text-muted); overflow: hidden; text-overflow: ellipsis; }
.desk-dnd-count, .desk-dnd-effect { flex: none; min-width: 1.25em; padding: 0 var(--desk-space-1);
  text-align: center; color: var(--desk-primary-foreground); background: var(--desk-primary);
  border-radius: var(--desk-radius-full); font-size: var(--desk-text-xs); }
.desk-dnd-effect:empty { display: none; }
`;
const MARKS: Record<DropAnswer, string> = { copy: "+", link: "↗", move: "", none: "⊘" };
const OFFSET = 12;

export interface LayerHandlers {
  move(at: Point, keys: DragKeys): void;
  up(at: Point, keys: DragKeys): void;
  cancel(): void;
}

const keysOf = (event: PointerEvent | KeyboardEvent): DragKeys => ({
  alt: event.altKey,
  shift: event.shiftKey,
  ctrl: event.ctrlKey,
  meta: event.metaKey,
});

export function dragLayer(doc: Document, handlers: LayerHandlers) {
  const win = doc.defaultView as Window;
  let image: HTMLElement | undefined;
  let shield: HTMLElement | undefined;
  const element = (tag: string, className: string) => {
    const made = doc.createElement(tag);
    made.className = className;
    made.setAttribute(LAYER_ATTRIBUTE, "");
    return made;
  };
  const style = () => {
    if (doc.getElementById("desk-dnd-style")) return;
    const sheet = doc.createElement("style");
    sheet.id = "desk-dnd-style";
    sheet.textContent = CSS;
    doc.head.append(sheet);
  };
  const point = (event: PointerEvent) => ({ x: event.clientX, y: event.clientY });
  const onMove = (event: PointerEvent) => handlers.move(point(event), keysOf(event));
  const onUp = (event: PointerEvent) => handlers.up(point(event), keysOf(event));
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopImmediatePropagation();
    handlers.cancel();
  };

  const hide = () => {
    image?.remove();
    shield?.remove();
    image = shield = undefined;
    win.removeEventListener("keydown", onKey, { capture: true });
  };

  return {
    show(shown: DragImage & { count: number }, at: Point, withShield: boolean) {
      hide();
      style();
      image = element("div", "desk-dnd-image");
      image.setAttribute("aria-hidden", "true");
      if (shown.src) {
        const picture = doc.createElement("img");
        picture.alt = "";
        picture.src = shown.src;
        image.append(picture);
      }
      const label = element("span", "desk-dnd-label");
      label.textContent = shown.label ?? "";
      image.append(label);
      if (shown.detail) {
        const detail = element("span", "desk-dnd-detail");
        detail.textContent = shown.detail;
        image.append(detail);
      }
      if (shown.count > 1) {
        const count = element("span", "desk-dnd-count");
        count.textContent = String(shown.count);
        image.append(count);
      }
      image.append(element("span", "desk-dnd-effect"));
      doc.body.append(image);
      if (withShield) {
        shield = element("div", "desk-dnd-shield");
        shield.addEventListener("pointermove", onMove);
        shield.addEventListener("pointerup", onUp);
        shield.addEventListener("pointercancel", () => handlers.cancel());
        doc.body.append(shield);
      }
      win.addEventListener("keydown", onKey, { capture: true });
      this.move(at, "none");
    },
    move(at: Point, effect: DropAnswer) {
      if (!image) return;
      image.style.transform = `translate(${at.x + OFFSET}px, ${at.y + OFFSET}px)`;
      image.dataset.effect = effect;
      if (shield) shield.dataset.effect = effect;
      const mark = image.querySelector(".desk-dnd-effect");
      if (mark) mark.textContent = MARKS[effect];
    },
    hide,
  };
}
