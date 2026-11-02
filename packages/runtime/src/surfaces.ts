import { type Edges, edgeOf } from "./edges";
import { Settling } from "./frames/settle";
import type { Cell } from "./layout";

/** The stacking level of overlays in desk.css; one shown later is raised above it. */
const OVERLAY_Z = 10;

/** A surface to show: a sandboxed iframe with a title. */
export interface SurfaceSpec {
  id: string;
  title: string;
  /** The surface's id in its plugin's manifest; display rules can match on it. */
  surface?: string;
  /** A URL to load, or inline HTML in `srcdoc`. */
  src?: string;
  srcdoc?: string;
  /**
   * `overlay` covers the whole desk; `left`, `right` and `bottom` sit on that edge of the desk. Both
   * have no title bar. Everything else sits on the grid.
   */
  placement?: string;
  /** Mounted but not shown until `show` (a palette waits for its command). */
  hidden?: boolean;
}

/**
 * Sandboxed iframe containers. Frames get `allow-scripts` only: no same-origin access to the desk,
 * no top navigation, no forms or popups. Plugins talk to the desk through the bridge alone.
 */
export class SurfaceHost {
  readonly #container: HTMLElement;
  readonly #surfaces = new Map<string, HTMLElement>();
  readonly #onFocus: (id: string) => void;
  readonly #edges: Edges | undefined;
  /** How many times an overlay was shown: each one shown goes above those shown before it. */
  #raised = 0;
  /** The frames of unloaded surfaces, out of the page until they show again (ADR 0070). */
  readonly #parked = new Map<string, HTMLIFrameElement>();
  readonly #settling = new Settling();
  readonly #listeners = new Set<() => void>();

  /** Without `edges`, edge surfaces sit in `container` like the rest. */
  constructor(container: HTMLElement, onFocus: (id: string) => void, edges?: Edges) {
    this.#container = container;
    this.#onFocus = onFocus;
    this.#edges = edges;
  }

  /**
   * Make a surface's section. By default it goes on the grid (or its edge bar); `into: null` leaves
   * it detached, with no title bar of its own, for a window host that places it (ADR 0040).
   */
  open(spec: SurfaceSpec, into?: HTMLElement | null): HTMLElement {
    const existing = this.#surfaces.get(spec.id);
    if (existing) return existing;
    const doc = this.#container.ownerDocument;
    const overlay = spec.placement === "overlay";
    const edges = this.#edges;
    const edge = edges ? edgeOf(spec.placement) : undefined;
    const windowed = into === null;
    const section = doc.createElement("section");
    section.className = overlay
      ? "desk-surface desk-surface--overlay"
      : edge
        ? "desk-surface desk-surface--edge"
        : windowed
          ? "desk-surface desk-surface--windowed"
          : "desk-surface";
    if (spec.hidden) section.classList.add("desk-surface--transient");
    section.dataset.surface = spec.id;
    section.tabIndex = -1;
    section.hidden = spec.hidden === true;
    section.addEventListener("focusin", (event) => {
      // The desk focusing the surface itself ends a frame's settling; the frame taking it does not.
      if (event.target === section) this.#settling.forget(spec.id);
      else if (this.#settling.refocus(spec.id, doc)) return;
      this.#onFocus(spec.id);
    });

    const title = doc.createElement("header");
    title.className = "desk-surface-title";
    title.textContent = spec.title;

    const frame = doc.createElement("iframe");
    frame.className = "desk-surface-frame";
    frame.title = spec.title;
    frame.setAttribute("sandbox", "allow-scripts");
    if (spec.srcdoc !== undefined) frame.srcdoc = spec.srcdoc;
    else if (spec.src !== undefined) frame.src = spec.src;

    if (overlay || edge || windowed) section.append(frame);
    else section.append(title, frame);
    if (into) into.append(section);
    else if (into === undefined)
      (edges && edge ? edges.bar(edge) : this.#container).append(section);
    this.#surfaces.set(spec.id, section);
    this.#changed();
    return section;
  }

  close(id: string): void {
    this.#surfaces.get(id)?.remove();
    this.#surfaces.delete(id);
    this.#parked.delete(id);
    this.#settling.forget(id);
    this.#edges?.prune();
    this.#changed();
  }

  /** Load a new URL in one surface's frame (an unloaded one loads it when it shows again). */
  reload(id: string, src: string): void {
    const frame = this.#surfaces.get(id)?.querySelector("iframe") ?? this.#parked.get(id);
    if (frame) frame.src = src;
  }

  /** Take a surface's frame out of the page, which frees it; `placeholder` stands in (ADR 0070). */
  unload(id: string, placeholder: HTMLElement): boolean {
    const section = this.#surfaces.get(id);
    const frame = section?.querySelector("iframe");
    if (!section || !frame) return false;
    frame.replaceWith(placeholder);
    this.#parked.set(id, frame);
    return true;
  }

  /**
   * Put an unloaded surface's frame back: it loads its page again. A surface with the focus gives it
   * to the frame; otherwise the frame may not take it while it settles (`frames/settle.ts`).
   */
  remount(id: string): boolean {
    const section = this.#surfaces.get(id);
    const frame = this.#parked.get(id);
    if (!section || !frame) return false;
    this.#parked.delete(id);
    const focused = section.contains(section.ownerDocument.activeElement);
    const placeholder = section.querySelector(".desk-surface-placeholder");
    if (placeholder) placeholder.replaceWith(frame);
    else section.append(frame);
    if (focused) frame.focus();
    else this.#settling.start(id, frame);
    return true;
  }

  unloaded(id: string): boolean {
    return this.#parked.has(id);
  }

  /** Hear surfaces open, close, show and hide. */
  onChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #changed(): void {
    for (const listener of [...this.#listeners]) listener();
  }

  /** Show or hide a surface without unloading it; a shown surface takes the keyboard focus. */
  show(id: string, visible: boolean): void {
    const section = this.#surfaces.get(id);
    if (!section) return;
    section.hidden = !visible;
    this.#changed();
    if (!visible) return;
    // An overlay shown over another (the palette over a view) is drawn above it.
    if (section.classList.contains("desk-surface--overlay"))
      section.style.zIndex = String(OVERLAY_Z + ++this.#raised);
    section.querySelector("iframe")?.focus();
  }

  /** Shown and on the page: a section a window host put away is not one to cycle to. */
  visible(id: string): boolean {
    const section = this.#surfaces.get(id);
    return section !== undefined && !section.hidden && section.isConnected;
  }

  /** The window inside a surface's frame, to tell plugin messages apart. */
  frame(id: string): Window | null {
    return this.#surfaces.get(id)?.querySelector("iframe")?.contentWindow ?? null;
  }

  get(id: string): HTMLElement | undefined {
    return this.#surfaces.get(id);
  }

  ids(): string[] {
    return [...this.#surfaces.keys()];
  }

  /** Put a surface on its grid cell. */
  position(id: string, cell: Cell): void {
    const section = this.#surfaces.get(id);
    if (!section) return;
    section.style.gridColumn = `${cell.col} / span ${cell.colSpan}`;
    section.style.gridRow = `${cell.row} / span ${cell.rowSpan}`;
  }
}
