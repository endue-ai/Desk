// The software player's clock: media time from the audio context while it runs, so the pictures
// follow the sound, else from the wall clock (a context that stays suspended, a file without sound).
// The clock is anchored (this media time was at that reference time) at every start, seek and rate
// change, and again whenever its reference changes, so a context that starts late does not jump.

/**
 * @typedef {{ running(): boolean, time(): number }} AudioReference the context's time, in seconds
 * @typedef {"audio" | "wall"} Source
 * @typedef {{
 *   readonly running: boolean,
 *   time(): number,
 *   start(): void,
 *   stop(): void,
 *   set(media: number): void,
 *   rate(next: number): void,
 *   context(media: number): number | null,
 * }} Clock
 */

/**
 * @param {{ now: () => number, audio: () => AudioReference | null | undefined }} options `now` in
 *   milliseconds; `audio` the speaker, when there is one
 * @returns {Clock}
 */
export function createClock(options) {
  let running = false;
  let speed = 1;
  /** @type {{ media: number, ref: number, source: Source }} */
  let anchor = { media: 0, ref: 0, source: "wall" };

  /** @returns {Source} */
  const pick = () => (options.audio()?.running() ? "audio" : "wall");
  const ref = (/** @type {Source} */ source) =>
    source === "audio" ? (options.audio()?.time() ?? 0) : options.now() / 1000;
  const anchorAt = (/** @type {number} */ media) => {
    const source = pick();
    anchor = { media, ref: ref(source), source };
  };

  const time = () => {
    if (!running) return anchor.media;
    const t = anchor.media + (ref(anchor.source) - anchor.ref) * speed;
    // The context started or stopped: go on from here on the other reference.
    if (pick() !== anchor.source) anchorAt(t);
    return t;
  };

  return {
    get running() {
      return running;
    },
    /** The media time now, in seconds. */
    time,
    start() {
      if (running) return;
      anchorAt(anchor.media);
      running = true;
    },
    stop() {
      if (!running) return;
      anchor = { ...anchor, media: time() };
      running = false;
    },
    /** Move to `media` seconds (a seek); a running clock goes on from there. */
    set(media) {
      anchorAt(media);
    },
    rate(next) {
      const t = time();
      speed = next;
      anchorAt(t);
    },
    /**
     * The context time at which `media` is heard, while the clock runs on the audio context; null
     * otherwise (nothing can be scheduled then).
     */
    context(media) {
      if (!running) return null;
      time();
      if (anchor.source !== "audio") return null;
      return anchor.ref + (media - anchor.media) / speed;
    },
  };
}

/** requestAnimationFrame, and a timer for pages that draw no frames (hidden, or a locked screen). */
export function nextFrame(/** @type {() => void} */ callback) {
  let done = false;
  /** @type {number | undefined} */
  let raf;
  const stop = () => {
    clearTimeout(timer);
    if (raf !== undefined) globalThis.cancelAnimationFrame?.(raf);
  };
  const run = () => {
    if (done) return;
    done = true;
    stop();
    callback();
  };
  const timer = setTimeout(run, 16);
  raf = globalThis.requestAnimationFrame?.(run);
  return () => {
    done = true;
    stop();
  };
}
