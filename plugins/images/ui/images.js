// The images plugin without its DOM. It answers the desk's file and buffer requests for the images
// it holds (desk.files.visit, .revert, desk.buffers.show, .closed; .save is refused), opens them
// (opening.js: ranged reads with progress and Cancel, one ask for the folder, decoding in a worker
// for large files), follows them on disk, lists their folder for Left and Right (folder.js), keeps
// them across a sleep (keep.js), and loads a second image to compare. It only talks to
// ctx.commands, ctx.bridge, ctx.surface and a view, so the SDK's test host runs it.
import { webviewReason } from "./decode.js";
import { release } from "./decoding.js";
import { modelOf, rowsOf } from "./details.js";
import { createWalk, folderOf, listFolder, nameOf } from "./folder.js";
import { readPlace } from "./keep.js";
import { createOpening, scopeOf } from "./opening.js";
import { reveal as showInFolder } from "./reveal.js";

/**
 * @typedef {import("@endue-ai/plugin-sdk").PluginContext} PluginContext
 * @typedef {import("@endue-ai/bridge").BridgeEvent} BridgeEvent
 * @typedef {import("@endue-ai/bridge").Permission} Permission
 * @typedef {import("./details.js").ImageModel} ImageModel
 * @typedef {import("./decode.js").Decoded} Decoded
 * @typedef {import("./keep.js").ViewPlace} ViewPlace
 * @typedef {{ path: string, name: string }} Choice
 * @typedef {{ image: ImageModel | null, partner: ImageModel | null,
 *   position: { index: number, count: number } | null, choices: Choice[] }} ImagesState
 * @typedef {{ render(state: ImagesState): void, status(text: string): void, focus(): void,
 *   progress?(value: import("./opening.js").Progress | null): void,
 *   place?(): ViewPlace | null, restore?(place: ViewPlace): void }} View
 *   place and restore: the zoom, pan and turn of the image on screen, kept across a sleep.
 * @typedef {{ buffer: string, path: string, name: string, size: number, decoded: Decoded,
 *   model: ImageModel, watchId?: string, slice?: number }} Entry
 *   slice: the slice last asked for, while it decodes.
 * @typedef {import("./opening.js").Options & {
 *   keepFiles: typeof import("@endue-ai/plugin-sdk").keepFiles }} Options
 */

/** The buffer and path the desk sends with every request. */
const requested = (/** @type {unknown} */ args) => {
  const { buffer, path } = /** @type {{ buffer?: unknown, path?: unknown }} */ (args ?? {});
  return {
    buffer: typeof buffer === "string" ? buffer : "",
    path: typeof path === "string" && path !== "" ? path : undefined,
  };
};
const text = (/** @type {unknown} */ error) =>
  error instanceof Error ? error.message : String(error);

/**
 * @param {Pick<PluginContext, "bridge" | "commands" | "surface">} ctx
 * @param {View} view
 * @param {Options} options the SDK's readBytes, startWorker and keepFiles
 */
export function createImages({ bridge, commands, surface }, view, options) {
  const opening = createOpening(bridge, view, options);
  /** @type {Map<string, Entry>} */
  const images = new Map();
  /** Buffers closed in this frame cannot be restored by a late show request. */
  const forgotten = new Set();
  /** @type {Map<string, string>} */
  const watches = new Map();
  /** @type {string | null} */
  let shown = null;
  /** @type {Entry | null} */
  let partner = null;
  /** The shown image's folder: its path and its images in natural order. */
  /** @type {{ dir: string, names: string[] } | null} */
  let folder = null;
  let said = "";
  // Put to sleep while nobody sees it, Images keeps its files and comes back to them (ADR 0070).
  const kept = options.keepFiles(surface, {
    files: () =>
      [...images.values()].map(({ buffer, path, watchId }) => {
        const seen = buffer === shown ? view.place?.() : null;
        return {
          buffer,
          path,
          place: { ...(seen ? { view: seen } : {}), ...(watchId ? { watchId } : {}) },
        };
      }),
    shown: () => shown,
    readPlace,
  });
  /** The kept file of a buffer this frame does not hold yet. */
  const keptOf = (/** @type {string} */ buffer) => kept.files().find((f) => f.buffer === buffer);

  const say = (/** @type {string} */ words) => {
    if (words === said) return;
    said = words;
    view.status(words);
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
  const list = async (/** @type {string} */ path) => {
    folder = await listFolder(bridge, path);
  };

  const held = (/** @type {string} */ buffer) => images.get(buffer) ?? fail(`No image ${buffer}.`);
  /** @param {string} message @returns {never} */
  function fail(message) {
    throw new Error(message);
  }

  /** Read and decode one file. Decoding never throws: a file it cannot show is a details view. */
  const load = async (/** @type {string} */ buffer, /** @type {string} */ path, ask = true) => {
    const { size, decoded } = await opening.load(buffer, path, { ask });
    const file = { buffer, path, name: nameOf(path), size };
    return /** @type {Entry} */ ({ ...file, decoded, model: modelOf(file, decoded) });
  };
  /** Let go of an entry's blob: URL and worker once no buffer and no comparison shows it. */
  const drop = (/** @type {Entry | null | undefined} */ entry) => {
    if (!entry || partner === entry || [...images.values()].includes(entry)) return;
    release(entry.decoded);
  };

  const follow = (/** @type {Entry} */ entry, /** @type {string} */ watchId) => {
    entry.watchId = watchId;
    watches.set(watchId, entry.buffer);
  };
  const watch = async (/** @type {Entry} */ entry) => {
    await bridge.call("fs.watch", { path: entry.path, scope: scopeOf(entry.path) }).then(
      ({ watchId }) => {
        if (images.get(entry.buffer) === entry) follow(entry, watchId);
      },
      () => {},
    );
  };

  const forget = (/** @type {string} */ buffer) => {
    forgotten.add(buffer);
    kept.take(buffer);
    const entry = images.get(buffer);
    if (entry?.watchId) watches.delete(entry.watchId);
    images.delete(buffer);
    drop(entry);
  };

  /**
   * Open again a file the desk lists that this frame lost (a window that slept, a page loaded
   * again), with the watch it had; answers the view a sleep kept of it, if any.
   */
  const reopen = async (/** @type {string} */ buffer, /** @type {string} */ path, ask = true) => {
    const place = keptOf(buffer)?.place;
    const entry = await load(buffer, path, ask);
    images.set(buffer, entry);
    kept.take(buffer);
    if (place?.watchId) follow(entry, place.watchId);
    else await watch(entry);
    return place?.view;
  };
  const lost = (/** @type {string} */ buffer, /** @type {string | undefined} */ path) => {
    const from = path ?? keptOf(buffer)?.path;
    return !images.has(buffer) && !forgotten.has(buffer) ? from : undefined;
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
        say(text(error));
        throw error;
      }
    });

  /**
   * Loads of visits on their way, by buffer: a show that comes first waits for its image.
   * @type {Map<string, Promise<Entry>>}
   */
  const visiting = new Map();

  answer("desk.files.visit", async (args) => {
    const { buffer, path } = requested(args);
    if (!buffer || !path) throw new Error("A visit needs a buffer and a path.");
    const loading = load(buffer, path);
    visiting.set(buffer, loading);
    /** @type {Entry} */
    let entry;
    try {
      entry = await loading;
    } finally {
      if (visiting.get(buffer) === loading) visiting.delete(buffer);
    }
    forgotten.delete(buffer);
    kept.take(buffer);
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
    const from = lost(buffer, asked);
    if (from) {
      await reopen(buffer, from);
      if (shown === buffer) render();
      return;
    }
    const old = held(buffer);
    const entry = await load(buffer, asked ?? old.path);
    if (images.get(buffer) !== old) return drop(entry);
    entry.watchId = old.watchId;
    images.set(buffer, entry);
    if (shown === buffer) render();
    drop(old);
  });

  answer("desk.buffers.show", async (args) => {
    const { buffer, path } = requested(args);
    // The image on screen before a sleep, opening again as the window wakes: shown once it is; one
    // that could not open without asking opens now. The desk lists a buffer as its visit starts:
    // one still reading (or waiting for a permission prompt) is shown once it is read, never read
    // again, and a visit that failed says so itself.
    if (waking?.buffer === buffer) await waking.done;
    const visit = visiting.get(buffer);
    if (visit) await visit.catch(() => {});
    else if (opening.pending() !== buffer) opening.stop();
    // A window put away or unloaded may come back with a fresh frame. Its file buffer survives.
    const from = visit ? undefined : lost(buffer, path);
    const seen = from ? await reopen(buffer, from) : undefined;
    const entry = held(buffer);
    shown = buffer;
    if (folder?.dir !== folderOf(entry.path)) await list(entry.path);
    render();
    if (seen) view.restore?.(seen);
    view.focus();
  });

  answer("desk.buffers.closed", (args) => {
    const { buffer } = requested(args);
    if (opening.pending() === buffer) {
      opening.stop();
      if (!images.has(buffer)) return;
    }
    if (kept.take(buffer) && !images.has(buffer)) return void forgotten.add(buffer);
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

  // Back from a sleep, the image that was on screen opens again as the person left it, without
  // asking for its folder or taking the focus; the others open when they are shown.
  const back = kept.shown === null ? undefined : keptOf(kept.shown);
  /** @type {{ buffer: string, done: Promise<void> } | undefined} */
  const waking = back && {
    buffer: back.buffer,
    done: (async () => {
      try {
        const seen = await reopen(back.buffer, back.path, false);
        // The person showed another image meanwhile: that one stays.
        if (shown !== null && shown !== back.buffer) return;
        shown = back.buffer;
        await list(back.path);
        render();
        if (seen) view.restore?.(seen);
      } catch (error) {
        if (shown === null) say(text(error));
      }
    })(),
  };

  const go = createWalk(commands, {
    current,
    folder: () => folder,
    left: (buffer) => images.has(buffer) && shown !== buffer,
    say,
  });

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
        say(text(error));
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
        say(text(error));
      }
    },
    /** The webview could not decode an image: show its details with that reason. */
    failed(/** @type {ImageModel} */ model) {
      for (const entry of owners(model)) {
        const { id, format, mime } = entry.decoded;
        remodel(entry, {
          ...entry.decoded,
          kind: "details",
          reason: webviewReason(id, format, mime),
        });
      }
      render();
    },
    /** Show a card's file in the file manager, for another app to open. */
    reveal(/** @type {ImageModel} */ model) {
      return showInFolder(bridge, model.path).catch((error) => say(error.message));
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
