/**
 * Reading the pane tree inside a window, as the window manager publishes it: its panes first to
 * last and one by id. Splitting, closing, showing another view and resizing a split are the window
 * manager's (crates/desk-wm `panes.rs`, #83); the page only draws what it is given.
 */
import type { PaneLeaf, PaneNode, SurfacePlacement } from "../modes/types";

export const LAUNCHER = "launcher";

/** A surface's panes; a surface saved without panes is one pane showing the view named by its id. */
export function panesOf(p: Pick<SurfacePlacement, "id" | "panes">): PaneNode {
  return p.panes ?? { kind: "view", id: "p1", view: p.id };
}

export function leaves(node: PaneNode): PaneLeaf[] {
  return node.kind === "view" ? [node] : [...leaves(node.a), ...leaves(node.b)];
}

export function findLeaf(node: PaneNode, id: string): PaneLeaf | undefined {
  return leaves(node).find((l) => l.id === id);
}
