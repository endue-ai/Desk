// The images plugin without its DOM. It answers the desk's file and buffer requests for the images
// it holds (desk.files.visit, .revert, desk.buffers.show, .closed; .save is refused), opens them
// (opening.js: ranged reads with progress and Cancel, one ask for the folder, decoding in a worker
// for large files), follows them on disk, lists their folder for Left and Right, and loads a second
// image to compare. It only talks to ctx.commands, ctx.bridge and a view, so the SDK's test host
// runs it.
import { webviewReason } from "./decode.js";
import { release } from "./decoding.js";
import { modelOf, rowsOf } from "./details.js";
import { createOpening, scopeOf } from "./opening.js";

/**
 * @typedef {import("@endue-ai/plugin-sdk").PluginContext} PluginContext
 * @typedef {import("@endue-ai/bridge").BridgeEvent} BridgeEvent
 * @typedef {import("@endue-ai/bridge").Permission} Permission
 * @typedef {import("./details.js").ImageModel} ImageModel
 * @typedef {import("./decode.js").Decoded} Decoded
 * @typedef {{ path: string, name: string }} Choice
 * @typedef {{ image: ImageModel | null, partner: ImageModel | null,
 *   position: { index: number, count: number } | null, choices: Choice[] }} ImagesState
 * @typedef {{ render(state: ImagesState): void, status(text: string): void, focus(): void,
 *   progress?(value: import("./opening.js").Progress | null): void }} View
 * @typedef {{ buffer: string, path: string, name: string, size: number, decoded: Decoded,
 *   model: ImageModel, watchId?: string, slice?: number }} Entry
 *   slice: the slice last asked for, while it decodes.
 */

const PLUGIN = "endue.images";

/** Every extension the plugin opens, as the folder walk filters names. */
export const EXTENSIONS = new Set(
  (
    "png apng jpg jpeg jpe jfif pjpeg gif webp avif heic heif jxl bmp dib tif tiff ico cur icns " +
    "svg svgz tga pnm pbm pgm ppm pam qoi dds hdr exr ktx eps wmf emf dng cr2 cr3 crw nef nrw " +
    "arw srf sr2 orf rw2 raf pef srw 3fr erf kdc mrw dcm fits fit fts nii"
  ).split(" "),
);

const nameOf = (/** @type {string} */ path) => path.slice(path.lastIndexOf("/") + 1);
const folderOf = (/** @type {string} */ path) => {
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

/** The buffer and path the desk sends with every request. */
const requested = (/** @type {unknown} */ args) => {
  const { buffer, path } = /** @type {{ buffer?: unknown, path?: unknown }} */ (args ?? {});
  return {
    buffer: typeof buffer === "string" ? buffer : "",
    path: typeof path === "string" && path !== "" ? path : undefined,
  };
};

/**
 * @param {Pick<PluginContext, "bridge" | "commands">} ctx
 * @param {View} view
 * @param {import("./opening.js").Options} options the SDK's readBytes, and its startWorker
 */
export function createImages({ bridge, commands }, view, options) {
  const opening = createOpening(bridge, view, options);
  /** @type {Map<string, Entry>} */
  const images = new Map();
  /** @type {Map<string, string>} */
  const watches = new Map();
  /** @type {string | null} */
  let shown = null;
  /** @type {Entry | null} */
  let partner = null;
  /** The shown image's folder: its path and its images in natural order. */
  /** @type {{ dir: string, names: string[] } | null} */
  let folder = null;
  let moving = false;
  let said = "";

  const say = (/** @type {string} */ text) => {
    if (text === said) return;
    said = text;
    view.status(text);
  };
  const current = () => (shown === null ? undefined : images.get(shown));

  /** @returns {ImagesState} */
  const state = () => {
    const entry = current();
    const names = entry && folder?.dir === folderOf(entry.path) ? folder.names : [];
    const index = entry ? names.indexOf(entry.name) : -1;
    /** @type {Choice[]} */
    const choices = [];
    const seen = new Set(entry ? [entry.path] : []);
    const offer = (/** @type {string} */ path) => {
      if (seen.has(path)) return;
      seen.add(path);
      choices.push({ path, name: nameOf(path) });
    };
    for (const other of images.values()) offer(other.path);
    if (folder) for (const name of folder.names) offer(`${folder.dir}/${name}`);
    return {
      image: entry?.model ?? null,
      partner: entry ? (partner?.model ?? null) : null,
      position: index >= 0 ? { index: index + 1, count: names.length } : null,
      choices,
    };
  };
  const render = () => view.render(state());

  const held = (/** @type {string} */ buffer) => images.get(buffer) ?? fail(`No image ${buffer}.`);
  /** @param {string} message @returns {never} */
  function fail(message) {
    throw new Error(message);
  }

  /** Read and decode one file. Decoding never throws: a file it cannot show is a details view. */
  const load = async (/** @type {string} */ buffer, /** @type {string} */ path) => {
    const { size, decoded } = await opening.load(buffer, path);
    const file = { buffer, path, name: nameOf(path), size };
    return /** @type {Entry} */ ({ ...file, decoded, model: modelOf(file, decoded) });
  };
  /** Let go of an entry's blob: URL and worker once no buffer and no comparison shows it. */
  const drop = (/** @type {Entry | null | undefined} */ entry) => {
    if (!entry || partner === entry || [...images.values()].includes(entry)) return;
    release(entry.decoded);
  };

  /** List the folder of `path`: its images, in natural order. Without a listing there is no walk. */
  const list = async (/** @type {string} */ path) => {
    const dir = folderOf(path);
    try {
      const { entries } = await bridge.call("fs.list", { path: dir, scope: scopeOf(path) });
      const names = entries.filter((e) => e.kind !== "dir" && imageName(e.name)).map((e) => e.name);
      folder = { dir, names: names.sort(natural) };
    } catch {
      folder = { dir, names: [nameOf(path)] };
    }
  };

  const watch = async (/** @type {Entry} */ entry) => {
    await bridge.call("fs.watch", { path: entry.path, scope: scopeOf(entry.path) }).then(
      ({ watchId }) => {
        if (images.get(entry.buffer) !== entry) return;
        entry.watchId = watchId;
        watches.set(watchId, entry.buffer);
      },
      () => {},
    );
  };

  const forget = (/** @type {string} */ buffer) => {
    const entry = images.get(buffer);
    if (entry?.watchId) watches.delete(entry.watchId);
    images.delete(buffer);
    drop(entry);
  };

  /**
   * Answer one of the desk's requests: a failure goes to the status line and ends the request with
   * the same words; a success clears the status line.
   * @param {string} name
   * @param {(args: unknown) => unknown} handler
   */
  const answer = (name, handler) =>
    commands.on(name, async (args) => {
      try {
        await handler(args);
        say("");
      } catch (error) {
        say(error instanceof Error ? error.message : String(error));
        throw error;
      }
    });

  answer("desk.files.visit", async (args) => {
    const { buffer, path } = requested(args);
    if (!buffer || !path) throw new Error("A visit needs a buffer and a path.");
    const entry = await load(buffer, path);
    const old = images.get(buffer);
    images.set(buffer, entry);
    if (old?.watchId) watches.delete(old.watchId);
    drop(old);
    shown = buffer;
    render();
    view.focus();
    await watch(entry);
    await list(path);
    render();
  });

  answer("desk.files.save", () => fail("Images opens files read-only."));

  answer("desk.files.revert", async (args) => {
    const { buffer, path: asked } = requested(args);
    const old = held(buffer);
    const entry = await load(buffer, asked ?? old.path);
    if (images.get(buffer) !== old) return drop(entry);
    entry.watchId = old.watchId;
    images.set(buffer, entry);
    if (shown === buffer) render();
    drop(old);
  });

  answer("desk.buffers.show", async (args) => {
    const { buffer } = requested(args);
    if (opening.pending() !== buffer) opening.stop();
    const entry = held(buffer);
    shown = buffer;
    if (folder?.dir !== folderOf(entry.path)) await list(entry.path);
    render();
    view.focus();
  });

  answer("desk.buffers.closed", (args) => {
    const { buffer } = requested(args);
    if (opening.pending() === buffer) {
      opening.stop();
      if (!images.has(buffer)) return;
    }
    held(buffer);
    forget(buffer);
    if (shown !== buffer) return;
    // The desk shows the buffer used before this one itself, with desk.buffers.show.
    shown = null;
    render();
  });

  bridge.onEvent((/** @type {BridgeEvent} */ event) => {
    if (event.event !== "fs.changed") return;
    const buffer = watches.get(event.data.watchId);
    const entry = buffer === undefined ? undefined : images.get(buffer);
    if (!entry) return;
    commands.run("desk.files.changed", { path: entry.path }).catch(() => {});
  });

  render();

  /** Show the folder's image at `target` (0-based) in place of the one on screen. */
  const go = async (/** @type {(index: number, count: number) => number} */ where) => {
    const entry = current();
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
        plugin: PLUGIN,
      });
      // Like find-alternate-file: the image walked away from closes, so the walk leaves one buffer.
      if (images.has(entry.buffer) && shown !== entry.buffer)
        await commands.run("desk.buffers.close", { id: entry.buffer });
    } catch (error) {
      say(error instanceof Error ? error.message : String(error));
    } finally {
      moving = false;
    }
  };

  /** Rebuild an entry's model after its decoded image changed. */
  const remodel = (/** @type {Entry} */ entry, /** @type {Decoded} */ decoded) => {
    entry.decoded = decoded;
    entry.model = modelOf(entry, decoded);
  };
  const owners = (/** @type {ImageModel} */ model) =>
    [...images.values(), ...(partner ? [partner] : [])].filter((e) => e.model === model);

  return {
    next: () => go((i) => i + 1),
    previous: () => go((i) => i - 1),
    first: () => go(() => 0),
    last: () => go((_, n) => n - 1),
    /** Move through a volume's slices; a large volume's worker decodes them. */
    async slice(/** @type {number} */ delta) {
      const entry = current();
      const slices = entry?.decoded.slices;
      if (!entry || !slices) return;
      const from = entry.slice ?? slices.index;
      const index = Math.max(0, Math.min(slices.count - 1, from + delta));
      if (index === from) return;
      entry.slice = index;
      try {
        const rgba = await slices.at(index);
        // A later key press, or another image, won while this slice decoded.
        if (entry.slice !== index || !entry.decoded.slices) return;
        remodel(entry, { ...entry.decoded, rgba, slices: { ...entry.decoded.slices, index } });
        if (current() === entry) render();
        say(`Slice ${index + 1} of ${slices.count}.`);
      } catch (error) {
        say(error instanceof Error ? error.message : String(error));
      }
    },
    /** Split the surface with another image, by path; null ends the comparison. */
    async compare(/** @type {string | null} */ path) {
      const before = partner;
      if (!path) {
        partner = null;
        render();
        drop(before);
        return;
      }
      try {
        partner = [...images.values()].find((e) => e.path === path) ?? (await load("", path));
        render();
        drop(before);
        say(`Comparing with ${partner.name}.`);
      } catch (error) {
        say(error instanceof Error ? error.message : String(error));
      }
    },
    /** The webview could not decode an image: show its details with that reason. */
    failed(/** @type {ImageModel} */ model) {
      for (const entry of owners(model)) {
        const reason = webviewReason(entry.decoded.id, entry.decoded.format);
        remodel(entry, { ...entry.decoded, kind: "details", reason });
      }
      render();
    },
    /** The webview decoded an image whose header gave no size. */
    loaded(/** @type {ImageModel} */ model, /** @type {{ width: number, height: number }} */ size) {
      for (const entry of owners(model)) {
        if (entry.model.width) continue;
        entry.model = { ...entry.model, ...size, details: rowsOf(entry.decoded, entry.size, size) };
      }
      render();
    },
  };
}
