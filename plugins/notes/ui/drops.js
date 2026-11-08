// Drops on notes (ADR 0119). On the note on screen, dropped paths become links at the caret (Markdown
// links in a .md note, relative to its folder when they are inside it; plain paths in a .txt note)
// and dropped text is inserted as it is. With no note open, dropped paths open. A drop hands over
// paths only: notes reads nothing it is given here.

/**
 * @typedef {import("@endue-ai/plugin-sdk").PluginContext} PluginContext
 * @typedef {import("@endue-ai/plugin-sdk").DragOver} DragOver
 * @typedef {import("@endue-ai/plugin-sdk").Drop} Drop
 * @typedef {{ path: string, kind?: string }} DeskPath
 * @typedef {{ dropTarget?: object, landing?(element: unknown): unknown, insert?(text: string): void }} DropView
 */

const IMAGE = /\.(png|jpe?g|gif|webp|avif|svg)$/i;
const MARKDOWN = /\.(md|markdown)$/i;
const nameOf = (/** @type {string} */ path) => path.slice(path.lastIndexOf("/") + 1);
const folderOf = (/** @type {string} */ path) => path.slice(0, path.lastIndexOf("/"));

/** A link to `target` from the note at `note`: relative inside the note's folder, else the path. */
export function linkTo(/** @type {DeskPath} */ target, /** @type {string} */ note) {
  const folder = `${folderOf(note)}/`;
  const href = target.path.startsWith(folder) ? target.path.slice(folder.length) : target.path;
  const url = /[\s()<>]/.test(href) ? `<${href}>` : href;
  const label = `${nameOf(target.path)}${target.kind === "folder" ? "/" : ""}`.replace(
    /[[\]]/g,
    "\\$&",
  );
  return `${IMAGE.test(target.path) ? "!" : ""}[${label}](${url})`;
}

/** What a drop puts in the note at `path`: links or paths, the link to a URI, or the text. */
export function snippetOf(/** @type {Drop} */ drop, /** @type {string} */ path) {
  const markdown = MARKDOWN.test(path);
  if (drop.paths) return drop.paths.map((p) => (markdown ? linkTo(p, path) : p.path)).join("\n");
  if (drop.uri && markdown) {
    const title = drop.items.find((item) => item.type === "desk/uri");
    const label = title && "title" in title ? title.title : undefined;
    return label ? `[${label}](<${drop.uri}>)` : `<${drop.uri}>`;
  }
  return drop.uri ?? drop.text ?? "";
}

/**
 * @param {Pick<PluginContext, "commands"> & { dnd?: PluginContext["dnd"] }} ctx
 * @param {DropView} view
 * @param {{ shown(): { path: string } | undefined, say(text: string): void }} notes
 */
export function createDrops({ commands, dnd }, view, notes) {
  /** @param {DragOver} over */
  const effect = (over) => {
    const paths = over.types.includes("desk/paths");
    const allowed = over.effectAllowed;
    if (!notes.shown()) return paths && allowed.includes("link") ? "link" : "none";
    // Paths become links to them; text is copied in.
    if (paths && allowed.includes("link")) return "link";
    return allowed.includes("copy") ? "copy" : "none";
  };

  /** @param {Drop} drop */
  const drop = async (drop) => {
    const note = notes.shown();
    if (note) {
      const text = snippetOf(drop, note.path);
      if (!text) return "none";
      view.insert?.(text);
      return undefined;
    }
    // No note on screen: the files open, each in the plugin the desk names for it.
    for (const { path } of drop.paths ?? []) {
      try {
        await commands.run("desk.files.open", { path });
      } catch (error) {
        notes.say(error instanceof Error ? error.message : String(error));
        return "none";
      }
    }
    return drop.paths ? undefined : "none";
  };

  dnd?.onDrop(view.dropTarget ?? {}, drop, {
    accept: ["desk/paths", "desk/text", "desk/uri", "text/plain"],
    at: (element) => view.landing?.(element) ?? element,
    effect,
  });
}
