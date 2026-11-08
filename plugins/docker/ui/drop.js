// What a drop of paths from this computer onto the surface does (DOCK-22, ADR 0119): on a container
// row or a container's Files tab (which marks itself `data-drop="files"` with its container and
// folder), the person confirms the folder of the container first (the Files tab's, else the
// container's working folder), then each path is copied in with its own docker cp, the progress in
// the pane as an operation, and the pane comes back to the Files tab on that folder.

import { containerPath } from "./files.js";

/**
 * @typedef {{ kind: "files", container: string, path: string, name?: string } | { kind: string }} DropTarget
 * @typedef {{ command: string, args: Record<string, string> }} DropAction
 * @typedef {{ kind: "container", item: { kind: "container", id: string, name: string } }
 *   | { kind: "files", container: string, name?: string, path: string }} Target
 * @typedef {{
 *   pick(title: string, items: Array<{ id: string, label: string, detail?: string }>, free?: boolean,
 *     placeholder?: string): Promise<string | undefined>,
 *   say(text: string): void,
 *   pane: Pick<ReturnType<typeof import("./pane.js").createPane>, "track" | "copyIn" | "loadDetail" | "listFiles">,
 *   inspect(args: Record<string, unknown>, tab?: string): Promise<unknown>,
 *   show(name: import("./keys.js").ViewName): void,
 * }} App
 */

const messageOf = (/** @type {unknown} */ error) =>
  error instanceof Error ? error.message : String(error);
const nameOf = (/** @type {string} */ path) =>
  path.replace(/\/+$/, "").slice(path.replace(/\/+$/, "").lastIndexOf("/") + 1) || path;

/**
 * The commands a drop of `paths` onto `target` runs; none for a target that takes no drop or for
 * a path that is not absolute.
 * @param {DropTarget} target
 * @param {string[]} paths
 * @returns {DropAction[]}
 */
export function dropAction(target, paths) {
  if (target.kind !== "files" || !("container" in target)) return [];
  return paths
    .filter((source) => source.startsWith("/") && !source.includes("\0"))
    .map((source) => ({
      command: "endue.docker.copy-in",
      args: { container: target.container, source, path: target.path },
    }));
}

/** The drop target an element is in, read from the `data-drop` marks the Files tab sets. */
export function dropTargetOf(/** @type {Element | null} */ element) {
  const marked = /** @type {HTMLElement | null | undefined} */ (element?.closest("[data-drop]"));
  if (!marked) return { kind: "none" };
  const { drop = "none", container = "", path = "/", name = "" } = marked.dataset;
  return drop === "files" ? { kind: "files", container, path, name } : { kind: drop };
}

/** The container's own working folder, from its inspect; "" when it names none. */
async function workdirOf(/** @type {App} */ app, /** @type {string} */ ref) {
  try {
    const detail = await app.pane.loadDetail(ref);
    const fields = detail.sections.flatMap((section) => section.fields);
    return fields.find((field) => field.label === "Working dir")?.value ?? "";
  } catch {
    return "";
  }
}

/** @param {App} app */
export function createCopyIn(app) {
  /** Where the person wants the copies: the folders to offer first, or one they type. */
  const confirm = async (/** @type {Target} */ target, /** @type {string[]} */ sources) => {
    const ref = target.kind === "files" ? target.container : target.item.id;
    const name = (target.kind === "files" ? target.name : target.item.name) || ref.slice(0, 12);
    /** @type {Array<{ id: string, label: string, detail?: string }>} */
    const items = [];
    if (target.kind === "files")
      items.push({ id: target.path, label: target.path, detail: "the folder the Files tab shows" });
    else {
      const workdir = (await workdirOf(app, ref)) || "/";
      items.push({ id: workdir, label: workdir, detail: "the container's working folder" });
      if (workdir !== "/tmp") items.push({ id: "/tmp", label: "/tmp" });
    }
    const what = sources.length === 1 ? nameOf(sources[0] ?? "") : `${sources.length} items`;
    const answer = await app.pick(
      `Docker: copy ${what} into ${name}, into which folder?`,
      items,
      true,
      "or type a folder of the container, like /srv/data",
    );
    if (answer === undefined) return undefined;
    const folder = containerPath(answer.trim() === "" ? (items[0]?.id ?? "/") : answer.trim());
    return { ref, name, folder };
  };

  /** Copy each path in, its progress in the pane; the effect performed. */
  return async (/** @type {Target} */ target, /** @type {string[]} */ sources) => {
    /** @type {Awaited<ReturnType<typeof confirm>>} */
    let where;
    try {
      where = await confirm(target, sources);
    } catch (error) {
      app.say(messageOf(error));
      return "none";
    }
    if (!where) return "none";
    const { ref, name, folder } = where;
    const place = `${name}:${folder}`;
    const progress = { done: 0, total: sources.length, status: "" };
    const job = app.pane.track(`Copy into ${place}`, { feed: () => ({ ...progress }) });
    for (const source of sources) {
      progress.status = `Copying ${source}…`;
      job.line("stdout", progress.status);
      app.say(progress.status);
      try {
        const words = await app.pane.copyIn({ container: ref, path: folder }, source, true);
        progress.done += 1;
        progress.status = words;
        job.line("stdout", words);
      } catch (error) {
        const why = messageOf(error).replace(/\.$/, "");
        job.end("failed", why);
        app.say(
          progress.done
            ? `Copied ${progress.done} of ${progress.total} into ${place}; ${nameOf(source)} failed: ${why}.`
            : `Copied nothing into ${place}: ${why}.`,
        );
        return progress.done ? "copy" : "none";
      }
    }
    job.end("done");
    const what = sources.length === 1 ? nameOf(sources[0] ?? "") : `${sources.length} items`;
    // The Files tab on the folder they went to, so the person sees them there.
    try {
      await app.inspect({ container: ref }, "files");
      await app.pane.listFiles(folder);
      app.show("inspect");
    } catch {
      // The copy is done; a container that cannot be read again is said by the pane.
    }
    app.say(`Copied ${what} into ${place}.`);
    return "copy";
  };
}
