// Drag and drop on the Docker surface (ADR 0119), without the DOM. Containers and images drag as
// typed desk data (desk/json `docker/container`, `docker/image`) with their id as text, so a terminal
// or a note gets the id. A file of a container's Files tab has no path on this computer, so it drags
// as `docker/file` { container, path, name, kind } with `container:/path` as text; a folder target
// copies it out with endue.docker.copy-out { container, path, dest } (the explorer does). Paths of
// this computer dropped on a container, or on its Files tab, are copied in (drop.js). A drop hands
// over paths, not access: docker reads them under the plugin's one grant, after the person says where.

import { createCopyIn } from "./drop.js";

/**
 * @typedef {import("@endue-ai/plugin-sdk").PluginDnd} PluginDnd
 * @typedef {import("@endue-ai/plugin-sdk").DragStart} DragStart
 * @typedef {import("@endue-ai/plugin-sdk").DragOver} DragOver
 * @typedef {import("@endue-ai/plugin-sdk").DeskData} DeskData
 * @typedef {import("./actions.js").Item} Item
 * @typedef {import("./drop.js").Target} Target
 * @typedef {{ dropTarget?: object, landing?(element: unknown): unknown,
 *   targetOf?(element: unknown): unknown }} DropView
 */

export const CONTAINER_KIND = "docker/container";
export const IMAGE_KIND = "docker/image";
export const FILE_KIND = "docker/file";

/** A path docker can read here: absolute, or home-relative (files.js runs docker in the home folder). */
export const isLocal = (/** @type {string} */ path) =>
  (path.startsWith("/") || path === "~" || path.startsWith("~/")) && !path.includes("\0");

/**
 * What a row of a list drags: a container or an image as typed JSON, its id as text.
 * @param {Item | undefined} item
 * @returns {DragStart | undefined}
 */
export function itemDrag(item) {
  if (item?.kind === "container") {
    const { id, name, state, project } = item;
    return {
      items: [
        { type: "desk/json", kind: CONTAINER_KIND, value: { id, name, state, project } },
        { type: "desk/text", text: id },
      ],
      effectAllowed: ["copy", "link"],
      image: { label: name || id.slice(0, 12), detail: "container" },
    };
  }
  if (item?.kind === "image") {
    const { id, ref } = item;
    return {
      items: [
        { type: "desk/json", kind: IMAGE_KIND, value: { id, ref } },
        { type: "desk/text", text: id },
      ],
      effectAllowed: ["copy", "link"],
      image: { label: item.dangling ? "<none>" : ref, detail: "image" },
    };
  }
  return undefined;
}

/**
 * What an entry of the Files tab drags: the container's file, copied out where it lands.
 * @param {{ id: string, name: string }} container
 * @param {{ path: string, dir: boolean }} entry
 * @returns {DragStart}
 */
export function fileDrag(container, entry) {
  const name = entry.path.slice(entry.path.lastIndexOf("/") + 1) || "/";
  const kind = entry.dir ? "folder" : "file";
  const value = { container: container.id, path: entry.path, name, kind };
  return {
    items: [
      { type: "desk/json", kind: FILE_KIND, value },
      { type: "desk/text", text: `${container.name || container.id}:${entry.path}` },
    ],
    effectAllowed: ["copy"],
    image: { label: name, detail: container.name || container.id.slice(0, 12) },
  };
}

/**
 * Take paths dropped on a container row or on a container's Files tab.
 * @param {{ dnd?: PluginDnd }} ctx
 * @param {Parameters<typeof createCopyIn>[0]} app
 * @param {DropView} view
 */
export function createDockerDrops({ dnd }, app, view) {
  const copyIn = createCopyIn(app);
  const targetOf = (/** @type {unknown} */ element) =>
    /** @type {Target | undefined} */ (view.targetOf?.(element));

  /** A copy, on a container, of paths docker can read; nothing anywhere else. */
  const effect = (/** @type {DragOver} */ over) =>
    targetOf(over.element) && over.effectAllowed.includes("copy") ? "copy" : "none";

  dnd?.onDrop(
    view.dropTarget ?? {},
    async (drop) => {
      const target = targetOf(drop.element);
      const sources = (drop.paths ?? []).map((p) => p.path);
      if (!target || sources.length === 0) return "none";
      const outside = sources.find((path) => !isLocal(path));
      if (outside) {
        app.say(`Docker copies files of this computer only: ${outside} is not one.`);
        return "none";
      }
      return copyIn(target, sources);
    },
    { accept: ["desk/paths"], at: (element) => view.landing?.(element) ?? null, effect },
  );
}
