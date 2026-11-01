// A remuxed file through Media Source Extensions: ManagedMediaSource where WebKit has it (it says when
// to fetch and may evict on its own), MediaSource otherwise. The fragments come from openRemux; this
// side appends them ahead of the play position, removes what lies far behind, and starts again from
// the key frame before a seek that lands outside what is buffered. One operation on the buffer runs
// at a time.

/**
 * @typedef {import("./index.js").Remuxed} Remuxed
 * @typedef {{ busy(label: string | null): void, fail(reason: string): void }} Hooks
 */

/** Seconds kept ahead of the play position, and behind it. */
const AHEAD = 30;
const BEHIND = 20;
/** How long the pump waits before it looks at the position again (ms). */
const NAP = 400;

/** The MediaSource class this window has, managed first. */
export const mediaSourceOf = (/** @type {any} */ win) =>
  win.ManagedMediaSource ?? win.MediaSource ?? null;

/**
 * @param {HTMLMediaElement} element
 * @param {Remuxed} remuxed
 * @param {Hooks & { win: any, start?: number }} options
 * @returns {{ close(): void }}
 */
export function playRemuxed(element, remuxed, options) {
  const { win, busy, fail } = options;
  const Source = mediaSourceOf(win);
  const managed = Source === win.ManagedMediaSource;
  const ms = new Source();
  if (managed) /** @type {any} */ (element).disableRemotePlayback = true;
  // A sandboxed frame's blob: URLs name an opaque origin, and WebKit will not attach a MediaSource
  // through one (MEDIA_ERR_SRC_NOT_SUPPORTED at once): srcObject attaches it directly.
  const direct = "srcObject" in element;
  const url = direct ? "" : win.URL.createObjectURL(ms);
  if (direct) /** @type {any} */ (element).srcObject = ms;
  else element.src = url;
  let closed = false;
  let generation = 0;
  /** @type {SourceBuffer | null} */
  let sb = null;
  /** The buffer's operations, one after another. @type {Promise<unknown>} */
  let queue = Promise.resolve();
  /** @type {AsyncGenerator<import("./index.js").Fragment> | null} */
  let fragments = null;
  /** @type {(() => void) | null} */
  let wake = null;

  const nap = () =>
    new Promise((resolve) => {
      const timer = win.setTimeout(() => {
        wake = null;
        resolve(null);
      }, NAP);
      wake = () => {
        win.clearTimeout(timer);
        wake = null;
        resolve(null);
      };
    });
  const poke = () => wake?.();

  /** One operation on the buffer: run it, then wait for updateend (or error). */
  const operate = (/** @type {(buffer: SourceBuffer) => void} */ run) =>
    new Promise((resolve, reject) => {
      const buffer = sb;
      if (!buffer || closed) return resolve(null);
      const done = () => {
        buffer.removeEventListener("updateend", done);
        buffer.removeEventListener("error", bad);
        resolve(null);
      };
      const bad = () => {
        buffer.removeEventListener("updateend", done);
        buffer.removeEventListener("error", bad);
        reject(new Error("WebKit could not decode the remuxed stream."));
      };
      buffer.addEventListener("updateend", done);
      buffer.addEventListener("error", bad);
      try {
        run(buffer);
      } catch (error) {
        buffer.removeEventListener("updateend", done);
        buffer.removeEventListener("error", bad);
        reject(error);
      }
    });
  const serially = (/** @type {() => Promise<unknown>} */ step) => {
    const next = queue.then(step);
    queue = next.catch(() => {});
    return next;
  };

  const ranges = () => {
    const out = [];
    const b = sb?.buffered;
    for (let i = 0; b && i < b.length; i++) out.push([b.start(i), b.end(i)]);
    return out;
  };
  const ahead = () => {
    const now = element.currentTime;
    const range = ranges().find(([s, e]) => s <= now + 0.3 && e >= now);
    return range ? (range[1] ?? now) - now : 0;
  };
  const buffered = (/** @type {number} */ time) =>
    ranges().some(([s, e]) => (s ?? 0) <= time + 0.1 && (e ?? 0) > time + 0.1);

  /** Make room behind the position; true when something was removed. */
  const trim = async () => {
    const before = element.currentTime - BEHIND;
    const first = ranges()[0];
    if (!first || (first[0] ?? 0) >= before) return false;
    await serially(() => operate((b) => b.remove(0, before)));
    return true;
  };

  const append = async (/** @type {Uint8Array} */ data) => {
    for (let tries = 0; ; tries++) {
      try {
        await serially(() => operate((b) => b.appendBuffer(/** @type {BufferSource} */ (data))));
        return;
      } catch (error) {
        const full = /** @type {{ name?: string }} */ (error)?.name === "QuotaExceededError";
        if (!full || tries >= 20) throw error;
        if (!(await trim())) await nap();
      }
    }
  };

  /** Append from the key frame before `from` until the end, staying about AHEAD seconds ahead. */
  const pump = async (/** @type {number} */ from) => {
    const mine = ++generation;
    void fragments?.return(undefined);
    fragments = remuxed.fragments(from);
    const current = fragments;
    let first = true;
    for (;;) {
      if (closed || mine !== generation) return;
      // ManagedMediaSource says when it wants data; MediaSource always does.
      const waiting = managed && ms.streaming === false;
      if (!first && (ahead() > AHEAD || waiting)) {
        await trim();
        await nap();
        continue;
      }
      const next = await current.next();
      if (closed || mine !== generation) return;
      if (next.done) {
        await serially(async () => {
          if (ms.readyState === "open" && !sb?.updating) ms.endOfStream();
        });
        return;
      }
      await append(next.value.data);
      if (first) {
        first = false;
        busy(null);
        // A stream whose first frame comes after 0 (FLV, MPEG-TS) starts at that frame.
        const start = ranges()[0]?.[0] ?? 0;
        if (element.currentTime < start && start < from + 1) element.currentTime = start;
      }
    }
  };
  const run = (/** @type {number} */ from) =>
    pump(from).catch((error) => {
      if (!closed) fail(error instanceof Error ? error.message : String(error));
    });

  const onSeeking = () => {
    const time = element.currentTime;
    if (!sb || buffered(time)) return;
    generation++;
    busy("Buffering…");
    void serially(async () => {
      if (ms.readyState === "open" && sb?.updating) sb.abort();
    }).then(() => run(time));
  };
  element.addEventListener("seeking", onSeeking);
  element.addEventListener("timeupdate", poke);
  ms.addEventListener("startstreaming", poke);

  ms.addEventListener(
    "sourceopen",
    () => {
      if (closed) return;
      try {
        if (remuxed.duration > 0) ms.duration = remuxed.duration;
        sb = ms.addSourceBuffer(remuxed.mime);
      } catch (error) {
        fail(error instanceof Error ? error.message : String(error));
        return;
      }
      void append(remuxed.init).then(
        () => run(options.start ?? 0),
        (error) => !closed && fail(error instanceof Error ? error.message : String(error)),
      );
    },
    { once: true },
  );
  busy("Remuxing…");

  return {
    close() {
      if (closed) return;
      closed = true;
      generation++;
      void fragments?.return(undefined);
      element.removeEventListener("seeking", onSeeking);
      element.removeEventListener("timeupdate", poke);
      element.pause();
      if (direct) /** @type {any} */ (element).srcObject = null;
      element.removeAttribute("src");
      element.load();
      if (url) win.URL.revokeObjectURL(url);
    },
  };
}
