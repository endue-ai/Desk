// The folder an image is in, for Left and Right: its images in natural order (img2 before img10),
// listed with fs.list under the file's folder scope, and the walk through them. Without a listing
// there is no walk.
import { scopeOf } from "./opening.js";

/** Every extension the plugin opens, as the folder walk filters names. */
export const EXTENSIONS = new Set(
  (
    "png apng jpg jpeg jpe jfif pjpeg gif webp avif heic heif jxl bmp dib tif tiff ico cur icns " +
    "svg svgz tga pnm pbm pgm ppm pam qoi dds hdr exr ktx eps wmf emf dng cr2 cr3 crw nef nrw " +
    "arw srf sr2 orf rw2 raf pef srw 3fr erf kdc mrw dcm fits fit fts nii"
  ).split(" "),
);

export const nameOf = (/** @type {string} */ path) => path.slice(path.lastIndexOf("/") + 1);
export const folderOf = (/** @type {string} */ path) => {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? path : path.slice(0, slash);
};
const imageName = (/** @type {string} */ name) => {
  const dot = name.lastIndexOf(".");
  return !name.startsWith(".") && dot > 0 && EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
};
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
/** Natural name order: img2 before img10, case aside; ties in code-unit order. */
export const natural = (/** @type {string} */ a, /** @type {string} */ b) =>
  collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);

/**
 * The folder of `path`: its path and its images in natural order; the file alone when the folder
 * cannot be listed.
 * @param {Pick<import("@endue-ai/plugin-sdk").PluginBridge, "call">} bridge
 * @param {string} path
 * @returns {Promise<{ dir: string, names: string[] }>}
 */
export async function listFolder(bridge, path) {
  const dir = folderOf(path);
  try {
    const { entries } = await bridge.call("fs.list", { path: dir, scope: scopeOf(path) });
    const names = entries.filter((e) => e.kind !== "dir" && imageName(e.name)).map((e) => e.name);
    return { dir, names: names.sort(natural) };
  } catch {
    return { dir, names: [nameOf(path)] };
  }
}

/**
 * The walk through the folder: show its image at `where(index, count)` (0-based) in place of the one
 * on screen, through the desk, one step at a time.
 * @param {Pick<import("@endue-ai/plugin-sdk").PluginContext["commands"], "run">} commands
 * @param {{ current(): { buffer: string, name: string } | undefined,
 *   folder(): { dir: string, names: string[] } | null,
 *   left(buffer: string): boolean, say(words: string): void }} parts
 *   left: whether the image walked away from is still open, but not on screen
 */
export function createWalk(commands, { current, folder: listed, left, say }) {
  let moving = false;
  return async (/** @type {(index: number, count: number) => number} */ where) => {
    const entry = current();
    const folder = listed();
    if (!entry || !folder || moving) return;
    const index = folder.names.indexOf(entry.name);
    const target = where(index, folder.names.length);
    if (target < 0) return say("This is the first image in the folder.");
    if (target >= folder.names.length) return say("This is the last image in the folder.");
    if (target === index) return;
    moving = true;
    try {
      await commands.run("desk.files.open", {
        path: `${folder.dir}/${folder.names[target]}`,
        plugin: "endue.images",
      });
      // Like find-alternate-file: the image walked away from closes, so the walk leaves one buffer.
      if (left(entry.buffer)) await commands.run("desk.buffers.close", { id: entry.buffer });
    } catch (error) {
      say(error instanceof Error ? error.message : String(error));
    } finally {
      moving = false;
    }
  };
}
