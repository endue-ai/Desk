import { type Edges, edgeOf } from "./edges";
import { framePages } from "./pages/frames";
import type { SurfacePages } from "./pages/types";

/** The stacking level of overlays in desk.css; one shown later is raised above it. */
const OVERLAY_Z = 10;

/** A surface to show: a plugin's page with a title. */
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
   * have no title bar. Everything else goes to the window host, or, without one, side by side.
   */
  placement?: string;
  /** Mounted but not shown until `show` (a palette waits for its command). */
  hidden?: boolean;
}

/**
 * The sections of the surfaces the desk shows: each holds its surface's page as `pages` shows it, a
 * place the compositor draws a browser of its own at in the app, or a sandboxed frame without the
 * compositor (ADR 0160). Plugins talk to the desk through the bridge alone.
 */
export class SurfaceHost {
  readonly #container: HTMLElement;
  readonly #surfaces = new Map<string, HTMLElement>();
  readonly #onFocus: (id: string) => void;
  readonly #edges: Edges | undefined;
  readonly #pages: SurfacePages;
  /** How many times an overlay was shown: each one shown goes above those shown before it. */
  #raised = 0;
  /** Each surface's page view, in its section or out of the page while unloaded (ADR 0070). */
  readonly #views = new Map<string, HTMLElement>();
  readonly #parked = new Set<string>();
  /** The surfaces a saved session puts back that have not opened yet (`returning`). */
  readonly #returning = new Set<string>();
  readonly #listeners = new Set<() => void>();

  /** Without `edges`, edge surfaces sit in `container` like the rest; without `pages`, frames. */
  constructor(
    container: HTMLElement,
    onFocus: (id: string) => void,
    edges?: Edges,
    pages: SurfacePages = framePages(),
  ) {
    this.#container = container;
    this.#onFocus = onFocus;
    this.#edges = edges;
    this.#pages = pages;
  }

  /**
   * Make a surface's section. By default it goes in the container (or its edge bar); `into: null`
   * leaves it detached, with no title bar of its own, for a window host that places it (ADR 0040).
   */
  open(spec: SurfaceSpec, into?: HTMLElement | null): HTMLElement {
    const existing = this.#surfaces.get(spec.id);
    if (existing) return existing;
    const doc = this.#container.ownerDocument;
    const overlay = spec.placement === "overlay";
    const edges = this.#edges;
    const windowed = into === null;
    const edge = edges && !windowed ? edgeOf(spec.placement) : undefined;
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
      if (this.#pages.focusin(spec.id, event, section)) return;
      this.#onFocus(spec.id);
    });

    const title = doc.createElement("header");
    title.className = "desk-surface-title";
    title.textContent = spec.title;

    const view = this.#pages.make(spec, doc, this.#returning.delete(spec.id));
    this.#views.set(spec.id, view);
    if (overlay || edge || windowed) section.append(view);
    else section.append(title, view);
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
    this.#views.delete(id);
    this.#parked.delete(id);
    this.#pages.close(id);
    this.#edges?.prune();
    this.#changed();
  }

  /** Load a new URL in one surface's page (an unloaded one loads it when it shows again). */
  reload(id: string, src: string): void {
    const view = this.#views.get(id);
    if (view) this.#pages.load(id, view, src);
  }

  /** Take a surface's page out of the page, which frees it; `placeholder` stands in (ADR 0070). */
  unload(id: string, placeholder: HTMLElement): boolean {
    const section = this.#surfaces.get(id);
    const view = this.#views.get(id);
    if (!section || !view || this.#parked.has(id) || !section.contains(view)) return false;
    view.replaceWith(placeholder);
    this.#parked.add(id);
    this.#pages.away(id, view);
    return true;
  }

  /**
   * Put an unloaded surface's page back: it loads again. A surface with the focus gives it to its
   * page; otherwise a frame may not take it while it settles (`frames/settle.ts`).
   */
  remount(id: string): boolean {
    const section = this.#surfaces.get(id);
    const view = this.#views.get(id);
    if (!section || !view || !this.#parked.has(id)) return false;
    this.#parked.delete(id);
    const focused = section.contains(section.ownerDocument.activeElement);
    const placeholder = section.querySelector(".desk-surface-placeholder");
    if (placeholder) placeholder.replaceWith(view);
    else section.append(view);
    this.#pages.back(id, view, focused);
    return true;
  }

  unloaded(id: string): boolean {
    return this.#parked.has(id);
  }

  /**
   * The surfaces a saved session puts back (#76; undefined: none) come back as an unloaded page
   * does: as each opens, its frame may not take the focus while it loads (`frames/settle.ts`), so
   * the surface in use keeps it when every window comes back. Returns `ids`.
   */
  returning(ids: ReadonlySet<string> | undefined): ReadonlySet<string> | undefined {
    this.#returning.clear();
    for (const id of ids ?? []) this.#returning.add(id);
    return ids;
  }

  /** Hear surfaces open, close, show and hide. */
  onChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #changed(): void {
    for (const listener of [...this.#listeners]) listener();
  }

  /**
   * Show or hide a surface without unloading it; a shown surface takes the keyboard focus. An
   * overlay with the focus that hides gives it to the overlay still shown in front (a permission
   * question answered over the palette leaves the keys with the palette, not with the window under
   * them both).
   */
  show(id: string, visible: boolean): void {
    const section = this.#surfaces.get(id);
    if (!section) return;
    const had = !visible && section.contains(section.ownerDocument.activeElement);
    section.hidden = !visible;
    this.#changed();
    if (!visible) {
      const front = had ? this.#frontOverlay() : undefined;
      if (front) this.#focusView(front);
      return;
    }
    // An overlay shown over another (the palette over a view) is drawn above it.
    if (section.classList.contains("desk-surface--overlay"))
      section.style.zIndex = String(OVERLAY_Z + ++this.#raised);
    this.#focusView(id);
  }

  #focusView(id: string): void {
    const view = this.#views.get(id);
    if (view && !this.#parked.has(id)) view.focus();
  }

  /** The overlay shown in front of the others, if one is shown. */
  #frontOverlay(): string | undefined {
    let front: string | undefined;
    let top = Number.NEGATIVE_INFINITY;
    for (const [id, section] of this.#surfaces) {
      if (!section.classList.contains("desk-surface--overlay") || !this.visible(id)) continue;
      const z = Number(section.style.zIndex) || 0;
      if (z >= top) [front, top] = [id, z];
    }
    return front;
  }

  /** Shown and on the page: a section a window host put away is not one to cycle to. */
  visible(id: string): boolean {
    const section = this.#surfaces.get(id);
    return section !== undefined && !section.hidden && section.isConnected;
  }

  /** The window a surface's messages go to and come from, to tell plugin messages apart. */
  frame(id: string): Window | null {
    const view = this.#views.get(id);
    return view && !this.#parked.has(id) ? this.#pages.port(id, view) : null;
  }

  /**
   * The desk gives surface `id` the focus. That ends its frame's settling, and a frame settling
   * gives the focus back here, also in a window in the background, where no focus event comes.
   */
  focus(id: string): void {
    const section = this.#surfaces.get(id);
    if (!section) return;
    section.focus();
    this.#pages.focused(id, section);
  }

  get(id: string): HTMLElement | undefined {
    return this.#surfaces.get(id);
  }

  ids(): string[] {
    return [...this.#surfaces.keys()];
  }
}
