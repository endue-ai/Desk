// What the software player holds between the worker and the screen and speaker: decoded pictures
// waiting for their time, and decoded sound waiting to be heard. Each queue counts what it used up,
// so the element can tell the worker (flow control: the worker decodes ahead only that far).

/**
 * @typedef {import("./screen.js").Screen} Screen
 * @typedef {import("./screen.js").Picture} Picture
 * @typedef {import("./speaker.js").Speaker} Speaker
 * @typedef {import("./clock.js").Clock} Clock
 * @typedef {{ time: number, picture: Picture }} Frame
 * @typedef {{ time: number, duration: number, sampleRate: number, channels: Float32Array[],
 *   buffer?: AudioBuffer | null, playing?: import("./speaker.js").Playing | null }} Chunk
 */

/** Dropped pictures are counted over this window; more than DROP_SHARE of them, and it says so. */
const DROP_WINDOW_MS = 2000;
const DROP_SHARE = 0.1;
const DROP_MIN = 8;
/** Pictures this far behind the clock with none waiting: the decoder cannot keep up. */
export const LATE_S = 0.25;

/**
 * A worker's video message as a frame.
 * @param {any} data
 * @returns {Frame}
 */
export const frameOf = (data) => ({
  time: data.time,
  picture: {
    width: data.width,
    height: data.height,
    planes: data.planes.map((/** @type {ArrayBuffer} */ b) => new Uint8Array(b)),
    widths: data.widths,
    heights: data.heights,
    full: Boolean(data.full),
    matrix: data.matrix === "bt709" ? "bt709" : "bt601",
  },
});

/**
 * A worker's audio message as a chunk.
 * @param {any} data
 * @returns {Chunk}
 */
export function chunkOf(data) {
  const channels = data.data.map((/** @type {ArrayBuffer} */ b) => new Float32Array(b));
  const duration = (channels[0]?.length ?? 0) / (data.sampleRate || 1);
  return { time: data.time, duration, sampleRate: data.sampleRate, channels };
}

/** Keep a queue in time order: decoders give pictures in order, a demuxer may not. */
function insert(/** @type {{ time: number }[]} */ list, /** @type {any} */ item) {
  let at = list.length;
  while (at > 0 && (list[at - 1]?.time ?? 0) > item.time) at--;
  list.splice(at, 0, item);
}

/**
 * The pictures: the last one due is shown, the due ones before it dropped and counted.
 * @param {{ screen: Screen | null, now: () => number, late: (on: boolean) => void,
 *   dropping: () => void }} options
 */
export function createPictures(options) {
  /** @type {Frame[]} */
  let queue = [];
  let shown = 0;
  let dropped = 0;
  let used = 0;
  let late = false;
  let said = false;
  let last = Number.NEGATIVE_INFINITY;
  /** @type {{ at: number, dropped: boolean }[]} */
  const recent = [];

  const count = (/** @type {boolean} */ drop) => {
    used++;
    if (drop) dropped++;
    else shown++;
    const now = options.now();
    recent.push({ at: now, dropped: drop });
    while (recent[0] && now - recent[0].at > DROP_WINDOW_MS) recent.shift();
    if (said || recent.length < DROP_MIN) return;
    if (recent.filter((r) => r.dropped).length / recent.length <= DROP_SHARE) return;
    said = true;
    options.dropping();
  };
  const show = (/** @type {Frame} */ frame) => {
    try {
      options.screen?.draw(frame.picture);
    } catch {
      // A lost context draws nothing; the clock and the sound go on.
    }
    last = frame.time;
    count(false);
  };

  return {
    get length() {
      return queue.length;
    },
    /** The time of the picture on screen. */
    get last() {
      return last;
    },
    push(/** @type {Frame} */ frame) {
      insert(queue, frame);
    },
    /** Show the first picture at once (paused, after a seek or the first decode). */
    first() {
      const frame = queue.shift();
      if (frame) show(frame);
      return Boolean(frame);
    },
    /** Show what is due at `t`; while the clock runs, ask the decoder to hurry when far behind. */
    present(/** @type {number} */ t, /** @type {boolean} */ running) {
      /** @type {Frame | undefined} */
      let due;
      while (queue[0] && queue[0].time <= t) {
        if (due) count(true);
        due = queue.shift();
      }
      if (due) show(due);
      const behind = running && queue.length === 0 && Number.isFinite(last) && t - last > LATE_S;
      if (behind && !late) options.late(true);
      else if (late && queue.length > 0) options.late(false);
      if (behind) late = true;
      else if (queue.length > 0) late = false;
    },
    /** Forget the queue (a seek): what it held counts as used. */
    flush() {
      used += queue.length;
      queue = [];
      last = Number.NEGATIVE_INFINITY;
    },
    /** Forget the queue without counting it (a new worker). */
    clear() {
      queue = [];
      last = Number.NEGATIVE_INFINITY;
    },
    /** Pictures used since the last call: for the worker's ack. */
    used() {
      const n = used;
      used = 0;
      return n;
    },
    /** Count one picture of an old seek as used. */
    stale() {
      used++;
    },
    quality: () => ({ totalVideoFrames: shown + dropped, droppedVideoFrames: dropped }),
  };
}

/** The sound: chunks started at their time on the speaker, counted in seconds once heard. */
export function createSounds() {
  /** @type {Chunk[]} */
  let queue = [];
  let used = 0;
  /** Where the sound heard so far ends. */
  let heard = Number.NEGATIVE_INFINITY;

  const silence = () => {
    for (const chunk of queue) {
      chunk.playing?.stop();
      chunk.playing = null;
    }
  };

  return {
    get length() {
      return queue.length;
    },
    /** Where the sound decoded so far ends (-Infinity before any). */
    get end() {
      return queue.reduce((end, c) => Math.max(end, c.time + c.duration), heard);
    },
    push(/** @type {Chunk} */ chunk) {
      insert(queue, chunk);
    },
    /** Whether any sound is still to be heard after `t`. */
    ahead: (/** @type {number} */ t) => queue.some((c) => c.time + c.duration > t),
    /** Let go of the chunks heard by `t`. */
    retire(/** @type {number} */ t) {
      while (queue[0] && queue[0].time + queue[0].duration <= t) {
        const done = /** @type {Chunk} */ (queue.shift());
        used += done.duration;
        heard = done.time + done.duration;
      }
    },
    /**
     * Start every chunk not yet playing at the context time of its media time.
     * @param {number} t
     * @param {Speaker | null} speaker
     * @param {Clock} clock
     * @param {number} rate
     */
    schedule(t, speaker, clock, rate) {
      if (!speaker?.running()) return;
      for (const chunk of queue) {
        if (chunk.playing || chunk.time + chunk.duration <= t) continue;
        const when = clock.context(chunk.time);
        if (when === null) return;
        if (chunk.buffer === undefined) chunk.buffer = speaker.buffer(chunk);
        if (chunk.buffer) chunk.playing = speaker.play(chunk.buffer, when, rate);
      }
    },
    /** Stop what is playing; it starts again where the clock is on the next schedule. */
    silence,
    /** Forget the queue (a seek): what it held counts as used. */
    flush() {
      silence();
      used += queue.reduce((sum, c) => sum + c.duration, 0);
      queue = [];
      heard = Number.NEGATIVE_INFINITY;
    },
    clear() {
      silence();
      queue = [];
      heard = Number.NEGATIVE_INFINITY;
    },
    /** Seconds used since the last call: for the worker's ack. */
    used() {
      const n = used;
      used = 0;
      return n;
    },
    /** Count a chunk of an old seek as used. */
    stale(/** @type {number} */ seconds) {
      used += seconds;
    },
  };
}

/**
 * The ack for what both queues used since the last one, or null when they used nothing.
 * @param {{ used(): number }} pictures
 * @param {{ used(): number }} sounds
 */
export function ackOf(pictures, sounds) {
  const video = pictures.used();
  const audio = sounds.used();
  if (video === 0 && audio === 0) return null;
  /** @type {{ type: "ack", video?: number, audio?: number }} */
  const ack = { type: "ack" };
  if (video) ack.video = video;
  if (audio) ack.audio = audio;
  return ack;
}
