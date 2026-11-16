// Branches and tags as the graph and the panels draw them: the refs on each commit (a local branch
// and its upstream on the same commit become one pill), and the pill itself, which drags its ref.

import { h, icon } from "./dom.js";
import { chartColor } from "./format.js";

/**
 * @typedef {import("./parse.js").Ref} Ref
 * @typedef {Ref & { alsoRemote?: string[] }} ShownRef
 */

/** Refs by the commit they point at: the current branch first, then local, remote, tags. */
export function refsByCommit(/** @type {Ref[]} */ refs) {
  /** @type {Map<string, ShownRef[]>} */
  const map = new Map();
  const remoteAt = new Map(refs.filter((r) => r.kind === "remote").map((r) => [r.name, r]));
  const merged = new Set();
  for (const ref of refs) {
    if (ref.kind !== "head") continue;
    /** @type {ShownRef} */
    const shown = { ...ref };
    const upstream = ref.upstream ? remoteAt.get(ref.upstream) : undefined;
    if (upstream && upstream.sha === ref.sha) {
      shown.alsoRemote = [upstream.name];
      merged.add(upstream.name);
    }
    push(map, shown);
  }
  for (const ref of refs) {
    if (ref.kind === "remote" && !merged.has(ref.name)) push(map, ref);
    if (ref.kind === "tag") push(map, ref);
  }
  const rank = (/** @type {ShownRef} */ r) =>
    r.current ? 0 : r.kind === "head" ? 1 : r.kind === "remote" ? 2 : 3;
  for (const list of map.values())
    list.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  return map;
}

/** @param {Map<string, ShownRef[]>} map @param {ShownRef} ref */
function push(map, ref) {
  const list = map.get(ref.sha) ?? [];
  list.push(ref);
  map.set(ref.sha, list);
}

/**
 * A ref as a pill in lane colour `color`. Draggable pills carry `application/x-git-ref`, which a
 * graph row or a branch takes as "merge or rebase this onto me".
 * @param {ShownRef} ref
 * @param {number} color
 * @param {{ draggable?: boolean }} [options]
 */
export function refPill(ref, color, options = {}) {
  const kindIcon = ref.kind === "tag" ? "tag" : ref.kind === "remote" ? "cloud" : "laptop";
  const el = h(
    "span.ref-pill",
    {
      class: `is-${ref.kind}${ref.current ? " is-current" : ""}`,
      style: { "--ref-color": chartColor(color) },
      title: `${ref.kind === "tag" ? "Tag" : ref.kind === "remote" ? "Remote branch" : "Branch"} ${ref.name}`,
      draggable: options.draggable && ref.kind !== "tag" ? "true" : undefined,
      onDragstart: (/** @type {DragEvent} */ event) => {
        event.dataTransfer?.setData("application/x-git-ref", ref.name);
        event.dataTransfer?.setData("text/plain", ref.name);
      },
    },
    ref.current ? icon("check", 12) : icon(kindIcon, 12),
    h("span.ref-name", null, ref.name),
    ref.alsoRemote
      ? h("span.ref-also", { title: `Also ${ref.alsoRemote.join(", ")}` }, icon("cloud", 12))
      : null,
  );
  return el;
}
