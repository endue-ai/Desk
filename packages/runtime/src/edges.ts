/** The desk's edges, where its chrome sits: the left bar, the right status panel and the dock. */
export type Edge = "left" | "right" | "bottom";

const EDGES: ReadonlySet<string> = new Set<Edge>(["left", "right", "bottom"]);

/** The edge a placement puts its surface on; undefined for grid surfaces and overlays. */
export function edgeOf(placement: string | undefined): Edge | undefined {
  return placement !== undefined && EDGES.has(placement) ? (placement as Edge) : undefined;
}

/** Only grid surfaces take a layout cell; edges and overlays sit outside the grid. */
export function takesCell(placement: string | undefined): boolean {
  return placement !== "overlay" && edgeOf(placement) === undefined;
}

/**
 * The edge bars around the compositor. A bar exists only while a surface sits on it, so a desk
 * without edge surfaces keeps the whole window for its grid.
 */
export class Edges {
  readonly #compositor: HTMLElement;
  readonly #bars = new Map<Edge, HTMLElement>();

  constructor(compositor: HTMLElement) {
    this.#compositor = compositor;
  }

  /** The bar for `edge`, created on first use, in reading order: left, grid, right, bottom. */
  bar(edge: Edge): HTMLElement {
    const existing = this.#bars.get(edge);
    if (existing) return existing;
    const bar = this.#compositor.ownerDocument.createElement("aside");
    bar.className = `desk-edge desk-edge--${edge}`;
    if (edge === "left") this.#compositor.before(bar);
    else if (edge === "right") this.#compositor.after(bar);
    else (this.#bars.get("right") ?? this.#compositor).after(bar);
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
