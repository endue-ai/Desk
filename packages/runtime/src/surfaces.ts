import { type Edges, edgeOf } from "./edges";
import type { Cell } from "./layout";

/** A surface to show: a sandboxed iframe with a title. */
export interface SurfaceSpec {
  id: string;
  title: string;
  /** A URL to load, or inline HTML in `srcdoc`. */
  src?: string;
  srcdoc?: string;
  /**
   * `overlay` covers the whole desk; `left`, `right` and `bottom` sit on that edge of the desk. Both
   * have no title bar. Everything else sits on the grid.
   */
  placement?: string;
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

  /** Without `edges`, edge surfaces sit in `container` like the rest. */
  constructor(container: HTMLElement, onFocus: (id: string) => void, edges?: Edges) {
    this.#container = container;
    this.#onFocus = onFocus;
    this.#edges = edges;
  }

  open(spec: SurfaceSpec): HTMLElement {
    const existing = this.#surfaces.get(spec.id);
    if (existing) return existing;
    const doc = this.#container.ownerDocument;
    const overlay = spec.placement === "overlay";
    const edges = this.#edges;
    const edge = edges ? edgeOf(spec.placement) : undefined;
    const section = doc.createElement("section");
    section.className = overlay
      ? "desk-surface desk-surface--overlay"
      : edge
        ? "desk-surface desk-surface--edge"
        : "desk-surface";
    section.dataset.surface = spec.id;
    section.tabIndex = -1;
    section.addEventListener("focusin", () => this.#onFocus(spec.id));

    const title = doc.createElement("header");
    title.className = "desk-surface-title";
    title.textContent = spec.title;

    const frame = doc.createElement("iframe");
    frame.className = "desk-surface-frame";
    frame.title = spec.title;
    frame.setAttribute("sandbox", "allow-scripts");
    if (spec.srcdoc !== undefined) frame.srcdoc = spec.srcdoc;
    else if (spec.src !== undefined) frame.src = spec.src;

    if (overlay || edge) section.append(frame);
    else section.append(title, frame);
    (edges && edge ? edges.bar(edge) : this.#container).append(section);
    this.#surfaces.set(spec.id, section);
    return section;
  }

  close(id: string): void {
    this.#surfaces.get(id)?.remove();
    this.#surfaces.delete(id);
    this.#edges?.prune();
  }

  /** Load a new URL in one surface's frame; nothing else on the desk changes. */
  reload(id: string, src: string): void {
    const frame = this.#surfaces.get(id)?.querySelector("iframe");
    if (frame) frame.src = src;
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
