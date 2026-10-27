import type { Cell } from "./layout";

/** A surface to show: a sandboxed iframe with a title. */
export interface SurfaceSpec {
  id: string;
  title: string;
  /** A URL to load, or inline HTML in `srcdoc`. */
  src?: string;
  srcdoc?: string;
}

/**
 * Sandboxed iframe containers. Frames get `allow-scripts` only: no same-origin access to the desk,
 * no top navigation, no forms or popups. Plugins talk to the desk through the bridge alone.
 */
export class SurfaceHost {
  readonly #container: HTMLElement;
  readonly #surfaces = new Map<string, HTMLElement>();
  readonly #onFocus: (id: string) => void;

  constructor(container: HTMLElement, onFocus: (id: string) => void) {
    this.#container = container;
    this.#onFocus = onFocus;
  }

  open(spec: SurfaceSpec): HTMLElement {
    const existing = this.#surfaces.get(spec.id);
    if (existing) return existing;
    const doc = this.#container.ownerDocument;
    const section = doc.createElement("section");
    section.className = "desk-surface";
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

    section.append(title, frame);
    this.#container.append(section);
    this.#surfaces.set(spec.id, section);
    return section;
  }

  close(id: string): void {
    this.#surfaces.get(id)?.remove();
    this.#surfaces.delete(id);
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
