/**
 * The pane tree inside a surface: split a pane right or down, close one, resize a split.
 * Pure functions over plain data, so layouts stay JSON and every change is easy to test.
 */
import type { PaneLeaf, PaneNode, PaneSplit, SurfacePlacement } from "../modes/types";

export const MIN_RATIO = 0.15;
export const LAUNCHER = "launcher";

const leaf = (id: string, view: string): PaneLeaf => ({ kind: "view", id, view });

/** A surface's panes; a surface saved without panes is one pane showing the view named by its id. */
export function panesOf(p: Pick<SurfacePlacement, "id" | "panes">): PaneNode {
  return p.panes ?? leaf("p1", p.id);
}

export function leaves(node: PaneNode): PaneLeaf[] {
  return node.kind === "view" ? [node] : [...leaves(node.a), ...leaves(node.b)];
}

export function findLeaf(node: PaneNode, id: string): PaneLeaf | undefined {
  return leaves(node).find((l) => l.id === id);
}

function* allIds(node: PaneNode): Generator<string> {
  yield node.id;
  if (node.kind === "split") {
    yield* allIds(node.a);
    yield* allIds(node.b);
  }
}

/** The next free pane id: p1, p2, ... never reusing one that exists. */
export function nextPaneId(node: PaneNode): string {
  const numbers = [...allIds(node)].map((id) => Number(/^[ps](\d+)$/.exec(id)?.[1] ?? 0));
  return `p${Math.max(0, ...numbers) + 1}`;
}

function map(node: PaneNode, change: (n: PaneNode) => PaneNode | undefined): PaneNode {
  const changed = change(node);
  if (changed) return changed;
  if (node.kind === "view") return node;
  return { ...node, a: map(node.a, change), b: map(node.b, change) };
}

/** Split pane `id` in two: it keeps the first half, a new pane showing `view` takes the second. */
export function split(
  node: PaneNode,
  id: string,
  dir: PaneSplit["dir"],
  view = LAUNCHER,
): { node: PaneNode; added: string } {
  const added = nextPaneId(node);
  const next = map(node, (n) =>
    n.kind === "view" && n.id === id
      ? { kind: "split", id: `s${added.slice(1)}`, dir, ratio: 0.5, a: n, b: leaf(added, view) }
      : undefined,
  );
  return { node: next, added };
}

/** Close pane `id`; its sibling takes the whole split. Returns null when it was the last pane. */
export function close(node: PaneNode, id: string): PaneNode | null {
  if (node.kind === "view") return node.id === id ? null : node;
  if (node.a.kind === "view" && node.a.id === id) return node.b;
  if (node.b.kind === "view" && node.b.id === id) return node.a;
  return { ...node, a: close(node.a, id) ?? node.a, b: close(node.b, id) ?? node.b };
}

export function setView(node: PaneNode, id: string, view: string): PaneNode {
  return map(node, (n) => (n.kind === "view" && n.id === id ? { ...n, view } : undefined));
}

export function setRatio(node: PaneNode, splitId: string, ratio: number): PaneNode {
  const clamped = Math.round(Math.min(1 - MIN_RATIO, Math.max(MIN_RATIO, ratio)) * 1000) / 1000;
  return map(node, (n) =>
    n.kind === "split" && n.id === splitId ? { ...n, ratio: clamped } : undefined,
  );
}
