/** The desk's edges, where its chrome sits: the left bar, the right status panel and the dock. */
export type Edge = "left" | "right" | "bottom";

const EDGES: ReadonlySet<string> = new Set<Edge>(["left", "right", "bottom"]);

/** The edge a placement puts its surface on; undefined for windows and overlays. */
export function edgeOf(placement: string | undefined): Edge | undefined {
  return placement !== undefined && EDGES.has(placement) ? (placement as Edge) : undefined;
}

/**
 * The edge bars of the desk's system surface (ADR 0028, ADR 0160): the dock's at the bottom, and
 * without a window host the left and right ones too. A bar exists only while a surface sits on it,
 * so a desk without edge surfaces keeps the whole window for its surfaces.
 */
export class Edges {
  readonly #surfaces: HTMLElement;
  readonly #bars = new Map<Edge, HTMLElement>();

  constructor(surfaces: HTMLElement) {
    this.#surfaces = surfaces;
  }

  /** The bar for `edge`, created on first use, in reading order: left, surfaces, right, bottom. */
  bar(edge: Edge): HTMLElement {
    const existing = this.#bars.get(edge);
    if (existing) return existing;
    const bar = this.#surfaces.ownerDocument.createElement("aside");
    bar.className = `desk-edge desk-edge--${edge}`;
    if (edge === "left") this.#surfaces.before(bar);
    else if (edge === "right") this.#surfaces.after(bar);
    else (this.#bars.get("right") ?? this.#surfaces).after(bar);
    this.#bars.set(edge, bar);
    return bar;
  }

  /** Remove the bars that no longer hold a surface. */
  prune(): void {
    for (const [edge, bar] of this.#bars) {
      if (bar.childElementCount > 0) continue;
      bar.remove();
      this.#bars.delete(edge);
    }
  }
}
