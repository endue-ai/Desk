// The player without its DOM. It answers the desk's file and buffer requests for the files it holds,
// opens each by what it is (load.js), keeps the subtitles, playlist and position of each, and says
// what happened. It only talks to ctx.commands, ctx.bridge and a view, so the SDK's test host runs
// it with a recording view.
import { codeOf, createAccess, nameOf } from "./access.js";
import { detect, familyByName } from "./format.js";
import {
  capsOf,
  details,
  fallBack,
  findSubtitles,
  HEAD,
  openCues,
  openPlaylist,
  playDecoded,
  playMedia,
  SAYINGS,
  showSubtitles,
} from "./load.js";
import { modelOf } from "./model.js";
import { createResume } from "./resume.js";

/**
 * @typedef {import("@endue-ai/plugin-sdk").PluginContext} PluginContext
 * @typedef {import("@endue-ai/bridge").BridgeEvent} BridgeEvent
 * @typedef {import("./probe/index.js").Info} Info
 * @typedef {import("./subtitles.js").Cue} Cue
 * @typedef {import("./playlists.js").Entry} ListEntry
 * @typedef {{ title: string, start: number }} Chapter
 * @typedef {{ title: string, detail: string, state: "playing" | "queued" | "remote" | "missing" }} Row
 * @typedef {import("./route.js").Engine} Engine
 * @typedef {{ path: string, name: string, size: number, url?: string, blob?: string, info?: Info,
 *   problem?: string, format: string, element: "video" | "audio", engine?: Engine,
 *   engines?: Engine[], why?: string }} Item
 *   engine: what plays it now; engines: the ones to try after it; why: the details' sentence.
 * @typedef {{
 *   buffer: string, path: string, name: string, size: number, format: string,
 *   mode: "loading" | "media" | "details" | "cues", why?: string, message?: string,
 *   item?: Item, cues?: Cue[],
 *   subs?: { options: { id: string, label: string }[], selected: string, offset: number, cues: Cue[] },
 *   playlist?: { entries: ListEntry[], states: string[], index: number },
 *   position: number, resume: number | null, watchId?: string, token: number,
 * }} Entry
 * @typedef {{
 *   buffer: string, path: string, name: string, size: number, format: string,
 *   mode: Entry["mode"], why?: string, message?: string,
 *   element?: "video" | "audio", src?: string, start?: number, resume?: number,
 *   engine?: Engine, target?: { path: string, size: number, format: string },
 *   info?: Info, cover?: string, item?: { path: string, name: string }, cues?: Cue[],
 *   subtitles?: { options: { id: string, label: string }[], selected: string, offset: number },
 *   playlist?: { rows: Row[], index: number }, chapters?: Chapter[],
 * }} Model
 * @typedef {{ show(model: Model | null): void, status(text: string): void, focus(): void,
 *   canPlay(type: string): string, canRemux?(type: string): boolean, software?: boolean }} PlayerView
 *   canRemux: MSE's isTypeSupported; software: whether the decoder worker can run.
 * @typedef {{
 *   objectUrl(bytes: Uint8Array, type: string): string,
 *   revokeUrl(url: string): void,
 *   audioContext?: import("./synth.js").CreateContext,
 *   now?: () => number,
 * }} PlayerOptions
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
 * @param {Pick<PluginContext, "bridge" | "commands">} ctx
 * @param {PlayerView} view
 * @param {PlayerOptions} options
 */
export function createPlayer({ bridge, commands }, view, options) {
  const access = createAccess({ bridge });
  const resume = createResume(bridge, options.now ?? Date.now);
  const ready = resume.load();
  /** Open files by the buffer the desk named them with. @type {Map<string, Entry>} */
  const entries = new Map();
  /** Watch id -> the buffer it follows. @type {Map<string, string>} */
  const watches = new Map();
  /** @type {string | null} */
  let shown = null;
  let said = "";
  let sayings = 0;

  const say = (/** @type {string} */ words) => {
    sayings++;
    if (words === said) return;
    said = words;
    view.status(words);
  };
  const render = () => {
    const entry = shown === null ? undefined : entries.get(shown);
    view.show(entry ? modelOf(entry) : null);
  };
  /** Show an entry again when it is the one on screen (late facts, a rendered song). */
  const refresh = (/** @type {Entry} */ entry) => {
    if (entries.get(entry.buffer) === entry && shown === entry.buffer) render();
  };
  const present = (/** @type {string} */ buffer) => {
    shown = buffer;
    render();
    view.focus();
  };
  const held = (/** @type {string} */ buffer) => {
    const entry = entries.get(buffer);
    if (!entry) throw new Error(`No file ${buffer}.`);
    return entry;
  };
  const release = (/** @type {Entry} */ entry) => {
    if (entry.item?.blob) options.revokeUrl(entry.item.blob);
  };
  const forget = (/** @type {string} */ buffer) => {
    const entry = entries.get(buffer);
    if (!entry) return;
    if (entry.watchId) watches.delete(entry.watchId);
    release(entry);
    entries.delete(buffer);
  };

  /** @type {import("./load.js").Deps} */
  const deps = { access, caps: capsOf(view), options, show: refresh };

  /** Show the chosen subtitles ("" for none). */
  const choose = (/** @type {Entry} */ entry, /** @type {string} */ id) =>
    showSubtitles(deps, entry, id).catch((error) => say(text(error)));

  /** Play one item of the entry (its own file, or a playlist entry) and find its subtitles. */
  const play = async (/** @type {Entry} */ entry, /** @type {string} */ path) => {
    const token = ++entry.token;
    release(entry);
    entry.item = undefined;
    entry.subs = undefined;
    entry.why = undefined;
    await playMedia(entry, path, deps, { token });
    if (entry.token !== token) return;
    const item = entry.item;
    if (entry.mode === "details") say(entry.why ?? "");
    if (!entry.playlist) entry.resume = entry.position > 0 ? null : resume.offer(path);
    if (item && entry.mode === "media" && item.element === "video")
      await findSubtitles(entry, item, deps, choose);
  };

  /** Play the playlist's first playable local entry from `from` in direction `step`. */
  const playEntry = async (/** @type {Entry} */ entry, /** @type {number} */ from, step = 1) => {
    const list = entry.playlist;
    if (!list) return false;
    for (let i = from; i >= 0 && i < list.entries.length; i += step) {
      const target = list.entries[i];
      if (!target?.path || target.remote || list.states[i]) continue;
      const before = list.index;
      list.index = i;
      entry.position = 0;
      try {
        await play(entry, target.path);
        return true;
      } catch (error) {
        const code = codeOf(error);
        list.states[i] =
          code === "not_found"
            ? "Not found"
            : code === "permission_denied"
              ? "Not allowed"
              : "Could not open";
        list.index = before;
      }
    }
    return false;
  };

  /** Open the entry's file by what it is. */
  const load = async (/** @type {Entry} */ entry) => {
    const { path, name } = entry;
    if (familyByName(name) === "media") return play(entry, path);
    const token = ++entry.token;
    const head = await access.range(path, 0, HEAD, true);
    entry.size = head.size;
    const found = detect(head.bytes, name);
    if (found.family === "media") return play(entry, path);
    if (found.family === "midi" || found.family === "au")
      return playDecoded(entry, path, head.size, head.bytes, deps, { token });
    const all =
      head.size > head.bytes.length
        ? await access.all(path, head.size, 16 << 20, head.bytes)
        : head.bytes;
    if (found.family === "subtitles") return openCues(entry, all);
    if (found.family === "playlist") {
      openPlaylist(entry, all);
      if (entry.playlist && !(await playEntry(entry, 0)))
        details(
          entry,
          `Nothing in ${name} can be played here: its entries are remote, missing or not allowed.`,
          entry.format,
        );
      return;
    }
    details(entry, `${name} is not a file the player knows.`, "Unknown");
  };

  /**
   * Answer one of the desk's requests. A failure goes to the status line and ends the request with
   * the same words; a success clears an old message unless the request said something new.
   * @param {string} name
   * @param {(args: unknown) => unknown} handler
   */
  const answer = (name, handler) =>
    commands.on(name, async (args) => {
      const before = sayings;
      try {
        await handler(args);
        if (sayings === before) say("");
      } catch (error) {
        say(text(error));
        throw error;
      }
    });

  /** (Re)open a buffer's file: a visit, or a revert that keeps the position. */
  const open = async (/** @type {string} */ buffer, /** @type {string} */ path, position = 0) => {
    await ready;
    const existing = entries.get(buffer);
    if (existing) release(existing);
    /** @type {Entry} */
    const entry = {
      buffer,
      path,
      name: nameOf(path),
      size: 0,
      format: "",
      mode: "loading",
      position,
      resume: null,
      token: 0,
    };
    if (existing?.watchId) entry.watchId = existing.watchId;
    entries.set(buffer, entry);
    const before = shown;
    // A slow read (a large header, a question) shows the file loading, with the progress bar.
    const slow = setTimeout(() => {
      if (entries.get(buffer) !== entry || entry.mode !== "loading") return;
      shown = buffer;
      render();
    }, 300);
    try {
      await load(entry);
    } catch (error) {
      if (entries.get(buffer) === entry) entries.delete(buffer);
      if (shown === buffer) {
        shown = before !== null && entries.has(before) ? before : null;
        render();
      }
      throw error;
    } finally {
      clearTimeout(slow);
    }
    if (entries.get(buffer) !== entry) return;
    present(buffer);
    if (entry.watchId) return;
    const watchId = await access.watch(path);
    if (!watchId || entries.get(buffer) !== entry) return;
    entry.watchId = watchId;
    watches.set(watchId, buffer);
  };

  answer("desk.files.visit", async (args) => {
    const { buffer, path } = requested(args);
    if (!buffer || !path) throw new Error("A visit needs a buffer and a path.");
    await open(buffer, path);
  });
  answer("desk.files.save", () => {
    throw new Error("Player opens files read-only.");
  });
  answer("desk.files.revert", async (args) => {
    const { buffer, path } = requested(args);
    const entry = held(buffer);
    await open(buffer, path ?? entry.path, entry.position);
  });
  answer("desk.buffers.show", (args) => {
    const { buffer } = requested(args);
    held(buffer);
    present(buffer);
  });
  answer("desk.buffers.closed", (args) => {
    const { buffer } = requested(args);
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
    const entry = buffer === undefined ? undefined : entries.get(buffer);
    if (!entry) return;
    commands.run("desk.files.changed", { path: entry.path }).catch(() => {});
  });

  render();

  const current = () => (shown === null ? undefined : entries.get(shown));
  /** Run an action on the entry on screen, then show it again. */
  const act = (/** @type {(entry: Entry) => unknown} */ run) => {
    const entry = current();
    if (!entry) return;
    void Promise.resolve()
      .then(() => run(entry))
      .then(
        () => refresh(entry),
        (error) => say(text(error)),
      );
  };
  /** Say something about the item on screen. */
  const about = (/** @type {(name: string) => string} */ words) => () => {
    const name = current()?.item?.name;
    if (name) say(words(name));
  };
  const move = (/** @type {number} */ step) =>
    act(async (entry) => {
      const list = entry.playlist;
      if (!list || (await playEntry(entry, list.index + step, step))) return;
      say(step > 0 ? "That was the last entry." : "This is the first entry.");
    });

  return {
    /** The engine failed (an element's error, the remuxer's or the decoder's words): the next one. */
    failed: (reason = "") =>
      act((entry) => {
        const why = fallBack(entry, reason);
        if (why) say(why);
      }),
    /** A sentence from an engine (a sound it cannot play beside the picture). */
    say: (/** @type {string} */ words) => say(words),
    stalled: about(SAYINGS.stalled),
    dropping: about(SAYINGS.dropping),
    cancelled: about(SAYINGS.cancelled),
    /** Ask for the file again (a new URL, a new question when the grant is gone) where it was. */
    retry: () =>
      act(async (entry) => {
        if (!entry.item) return;
        await play(entry, entry.item.path);
        say("");
      }),
    /** Where the element is: kept per buffer, and for long files in the store. */
    progress: (/** @type {{ time: number, duration: number, paused: boolean }} */ at) => {
      const entry = current();
      if (!entry?.item) return;
      entry.position = at.time;
      resume.note(entry.item.path, at.time, at.duration, at.paused);
    },
    /** The item ended: nothing to resume, and a playlist goes on. */
    ended: () => {
      const entry = current();
      if (!entry?.item) return;
      resume.clear(entry.item.path);
      entry.position = 0;
      if (entry.playlist) move(1);
    },
    /** The person answered the resume offer. */
    resumed: () => {
      const entry = current();
      if (entry) entry.resume = null;
    },
    next: () => move(1),
    previous: () => move(-1),
    /** Play one playlist entry, by its index. */
    pick: (/** @type {number} */ index) =>
      act((entry) => entry.playlist && playEntry(entry, index)),
    /** Choose subtitles by id; "" turns them off. */
    subtitle: (/** @type {string} */ id) => act((entry) => choose(entry, id)),
    /** Move the subtitles later (positive) or earlier, in steps of a tenth of a second. */
    offset: (/** @type {number} */ delta) =>
      act((entry) => {
        if (!entry.subs) return;
        const value = Math.round((entry.subs.offset + delta) * 10) / 10;
        entry.subs.offset = value;
        say(
          value === 0
            ? "Subtitles in time."
            : `Subtitles ${Math.abs(value).toFixed(1)} s ${value > 0 ? "later" : "earlier"}.`,
        );
      }),
  };
}
