// The player without its DOM. It answers the desk's file and buffer requests for the files it holds,
// opens each by what it is (playing.js), keeps the subtitles, playlist and position of each, also
// across a sleep (keep.js), and says what happened. It only talks to ctx.commands, ctx.bridge,
// ctx.surface and a view, so the SDK's test host runs it with a recording view.
import { createAccess, nameOf } from "./access.js";
import { placeOf, readPlace } from "./keep.js";
import { modelOf } from "./model.js";
import { cancel, capsOf, fallBack, SAYINGS } from "./outcome.js";
import { createPlaying } from "./playing.js";
import { createResume } from "./resume.js";
import { reveal as showInFolder } from "./reveal.js";

/**
 * @typedef {import("@endue-ai/plugin-sdk").PluginContext} PluginContext
 * @typedef {import("@endue-ai/bridge").BridgeEvent} BridgeEvent
 * @typedef {import("./probe/index.js").Info} Info
 * @typedef {import("./subtitles.js").Cue} Cue
 * @typedef {import("./playlists.js").Entry} ListEntry
 * @typedef {import("./keep.js").KeptPlace} KeptPlace
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
 *   info?: Info, cover?: string, item?: { path: string, name: string, size: number }, cues?: Cue[],
 *   subtitles?: { options: { id: string, label: string }[], selected: string, offset: number },
 *   playlist?: { rows: Row[], index: number }, chapters?: Chapter[],
 * }} Model
 * @typedef {{ show(model: Model | null): void, status(text: string): void, focus(): void,
 *   canPlay(type: string): string, canRemux?(type: string): boolean, software?: boolean,
 *   loadVolume?(bridge: PluginContext["bridge"]): Promise<void> }} PlayerView
 *   canRemux: MSE's isTypeSupported; software: whether the decoder worker can run.
 * @typedef {{
 *   objectUrl(bytes: Uint8Array, type: string): string,
 *   revokeUrl(url: string): void,
 *   keepFiles: typeof import("@endue-ai/plugin-sdk").keepFiles,
 *   audioContext?: import("./synth.js").CreateContext,
 *   now?: () => number,
 * }} PlayerOptions
 *   keepFiles: the SDK's, which main.js imports (ADR 0176).
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
 * @param {PlayerView} view
 * @param {PlayerOptions} options
 */
export function createPlayer({ bridge, commands, surface }, view, options) {
  const access = createAccess({ bridge });
  const resume = createResume(bridge, options.now ?? Date.now);
  const ready = Promise.all([resume.load(), view.loadVolume?.(bridge)]);
  /** Open files by the buffer the desk named them with. @type {Map<string, Entry>} */
  const entries = new Map();
  /** Watch id -> the buffer it follows. @type {Map<string, string>} */
  const watches = new Map();
  /** @type {string | null} */
  let shown = null;
  let said = "";
  let sayings = 0;
  // Put to sleep while nobody sees it, the player keeps its files and comes back to them (ADR 0070).
  const kept = options.keepFiles(surface, {
    files: () =>
      [...entries.values()].map((e) => ({ buffer: e.buffer, path: e.path, place: placeOf(e) })),
    shown: () => shown,
    readPlace,
  });
  /** Buffers this frame closed: a show of one does not open it again. @type {Set<string>} */
  const closed = new Set();
  /** The kept file of a buffer this frame does not hold yet. */
  const keptOf = (/** @type {string} */ buffer) => kept.files().find((f) => f.buffer === buffer);

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
  const { choose, load, play, playEntry } = createPlaying({ deps, resume, say });

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

  /**
   * (Re)open a buffer's file: a visit, a revert that keeps the position, or a file the desk lists
   * that this frame lost, where a sleep kept it. Coming back from a sleep it neither asks for the
   * folder nor takes the focus, and gives way to a file the person shows meanwhile.
   * @param {string} buffer
   * @param {string} path
   * @param {{ position?: number, place?: KeptPlace, waking?: boolean }} [how]
   */
  const open = async (buffer, path, { place, waking = false, ...how } = {}) => {
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
      position: how.position ?? place?.position ?? 0,
      resume: null,
      token: 0,
    };
    // The watch the file had before the sleep still follows it.
    const watchId = existing?.watchId ?? place?.watchId;
    if (watchId) {
      entry.watchId = watchId;
      watches.set(watchId, buffer);
    }
    entries.set(buffer, entry);
    const before = shown;
    const mine = () =>
      entries.get(buffer) === entry && (!waking || shown === null || shown === buffer);
    // A slow read (a large header, a question) shows the file loading, with the progress bar.
    const slow = setTimeout(() => {
      if (!mine() || entry.mode !== "loading") return;
      shown = buffer;
      render();
    }, 300);
    try {
      await load(entry, { ask: !waking, place });
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
    kept.take(buffer);
    closed.delete(buffer);
    if (!mine()) return;
    if (waking) {
      shown = buffer;
      render();
    } else present(buffer);
    if (entry.watchId) return;
    const watched = await access.watch(path);
    if (!watched || entries.get(buffer) !== entry) return;
    entry.watchId = watched;
    watches.set(watched, buffer);
  };
  /** Open again a file the desk lists that this frame lost, unless it closed it itself. */
  const lost = (/** @type {string} */ buffer, /** @type {string | undefined} */ path) => {
    const from = path ?? keptOf(buffer)?.path;
    const missing = !entries.has(buffer) && !closed.has(buffer);
    return from && missing ? open(buffer, from, { place: keptOf(buffer)?.place }) : undefined;
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
    const reopening = lost(buffer, path);
    if (reopening) return reopening;
    const entry = held(buffer);
    await open(buffer, path ?? entry.path, { position: entry.position });
  });
  answer("desk.buffers.show", async (args) => {
    const { buffer, path } = requested(args);
    // The file on screen before a sleep, still opening as the window wakes: shown once it is. One
    // that did not open as it woke (a folder it may not read without asking) opens now.
    if (waking?.buffer === buffer) await waking.done;
    const reopening = lost(buffer, path);
    if (reopening) return reopening;
    held(buffer);
    present(buffer);
  });
  answer("desk.buffers.closed", (args) => {
    const { buffer } = requested(args);
    closed.add(buffer);
    if (kept.take(buffer) && !entries.has(buffer)) return;
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

  // Back from a sleep, the file that was on screen opens again where it was, paused; the others
  // open when they are shown.
  const back = kept.shown === null ? undefined : keptOf(kept.shown);
  /** @type {{ buffer: string, done: Promise<unknown> } | undefined} */
  const waking = back && {
    buffer: back.buffer,
    done: open(back.buffer, back.path, { place: back.place, waking: true }).catch((error) => {
      if (shown === null) say(text(error));
    }),
  };

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
      if (!list || (await playEntry(entry, list.index + step, step)) === null) return;
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
    /** Show the file on screen (a playlist's entry) in the file manager, for another app. */
    reveal: () => act((entry) => showInFolder(bridge, entry.item?.path ?? entry.path)),
    stalled: about(SAYINGS.stalled),
    dropping: about(SAYINGS.dropping),
    cancelled: () => act((entry) => say(cancel(entry))),
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
    /** Play one playlist entry, by its index; one that cannot be read leaves the last, and says why. */
    pick: (/** @type {number} */ index) =>
      act(async (entry) => {
        const why = entry.playlist ? await playEntry(entry, index, 0) : null;
        if (why) say(why);
      }),
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
