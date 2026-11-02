// The software player's media element, for a file this system's WebKit cannot decode: a worker
// (worker.js) decodes it with FFmpeg in WebAssembly; this side keeps the clock on the audio context
// (clock.js), shows each picture when its time comes and drops late ones (queues.js, screen.js),
// plays the sound (speaker.js), seeks, and speaks HTMLMediaElement's events and properties.
import { createClock, nextFrame } from "./clock.js";
import { createLink } from "./link.js";
import { ackOf, chunkOf, createPictures, createSounds, frameOf, LATE_S } from "./queues.js";
import { createScreen } from "./screen.js";
import { openSpeaker } from "./speaker.js";

/**
 * @typedef {import("./screen.js").Screen} Screen
 * @typedef {{ canvas?: HTMLCanvasElement, startWorker: () => Worker, wasm: string, url: string,
 *   size: number, readAll?: () => Promise<ArrayBuffer>, audioContext?: () => AudioContext,
 *   screen?: (canvas: HTMLCanvasElement) => Screen, now?: () => number,
 *   frame?: (callback: () => void) => () => void }} SoftwareOptions
 * @typedef {{ type: "ready", duration: number, video: { width: number, height: number,
 *   codec: string } | null, audio: { sampleRate: number, channels: number, codec: string } | null }} Ready
 */

/** How often timeupdate fires while playing, like WebKit's media elements. */
const TIMEUPDATE_MS = 250;

export class SoftwareMedia extends EventTarget {
  /** @param {SoftwareOptions} options */
  constructor(options) {
    super();
    this.#o = options;
    this.#now = options.now ?? (() => performance.now());
    this.#frame = options.frame ?? nextFrame;
    this.#clock = createClock({ now: this.#now, audio: () => this.#speaker });
    const { canvas, audioContext } = options;
    this.#screen = canvas ? (options.screen ?? createScreen)(canvas) : null;
    this.#pictures = createPictures({
      screen: this.#screen,
      now: this.#now,
      late: (on) => this.#link?.post({ type: "late", on }),
      dropping: () => this.#emit("dropping"),
    });
    const on = {
      message: (/** @type {any} */ data) => this.#message(data),
      reopen: () => this.#reopen(),
      fail: (/** @type {string} */ words) => this.#fail(words),
    };
    this.#link = createLink(
      { ...options, video: Boolean(canvas), audio: Boolean(audioContext) },
      on,
    );
  }

  /** @type {SoftwareOptions} */ #o;
  /** @type {() => number} */ #now;
  /** @type {(callback: () => void) => () => void} */ #frame;
  /** @type {import("./clock.js").Clock} */ #clock;
  /** @type {ReturnType<typeof createPictures>} */ #pictures;
  #sounds = createSounds();
  /** @type {Screen | null} */ #screen = null;
  /** @type {import("./speaker.js").Speaker | null} */ #speaker = null;
  /** @type {ReturnType<typeof createLink>} */ #link;
  /** @type {Ready | null} */ #info = null;
  /** @type {{ code: number, message: string } | null} */ #error = null;
  /** A seek asked for before the worker was ready. @type {number | null} */ #pending = null;
  /** @type {(() => void) | null} */ #cancel = null;
  #duration = Number.NaN;
  #seq = 0;
  #seekTo = 0;
  #paused = true;
  #ended = false;
  #seeking = false;
  #closed = false;
  #loaded = false;
  #endSeen = false;
  #lastUpdate = Number.NEGATIVE_INFINITY;
  #volume = 1;
  #muted = false;
  #rate = 1;
  #width = 0;
  #height = 0;
  loop = false;
  defaultPlaybackRate = 1; // Kept for the transport, which sets it with playbackRate.

  get paused() {
    return this.#paused;
  }
  get ended() {
    return this.#ended;
  }
  get seeking() {
    return this.#seeking;
  }
  get duration() {
    return this.#duration;
  }
  get error() {
    return this.#error;
  }
  get videoWidth() {
    return this.#width;
  }
  get videoHeight() {
    return this.#height;
  }
  get hasVideo() {
    return Boolean(this.#info?.video && this.#screen);
  }
  get hasAudio() {
    return Boolean(this.#info?.audio && this.#speaker);
  }
  /** True while probing, building the decoder, seeking or buffering. */
  get waiting() {
    if (this.#error || this.#closed) return false;
    if (!this.#info || this.#seeking || this.#pending !== null) return true;
    return !this.#paused && !this.#ended && !this.#clock.running;
  }
  get readyState() {
    if (!this.#info) return 0;
    if (this.#seeking) return 1;
    if (this.#pictures.length > 0 || this.#sounds.length > 0 || this.#endSeen) return 4;
    return this.#loaded ? 2 : 1;
  }
  get currentTime() {
    if (this.#pending !== null) return this.#pending;
    if (this.#seeking) return this.#seekTo;
    const t = Math.max(0, this.#clock.time());
    return Number.isFinite(this.#duration) ? Math.min(t, this.#duration) : t;
  }
  set currentTime(time) {
    this.#seek(Number(time));
  }
  get volume() {
    return this.#volume;
  }
  set volume(value) {
    this.#volume = Math.max(0, Math.min(1, Number(value) || 0));
    this.#gain();
  }
  get muted() {
    return this.#muted;
  }
  set muted(on) {
    this.#muted = Boolean(on);
    this.#gain();
  }
  get playbackRate() {
    return this.#rate;
  }
  set playbackRate(value) {
    const rate = Number(value);
    if (!(rate > 0) || rate === this.#rate) return;
    this.#rate = rate;
    this.#clock.rate(rate);
    // The sources play at the old rate: they start again at the new one.
    this.#sounds.silence();
    this.#emit("ratechange");
    this.#update();
  }

  play() {
    if (this.#error)
      return Promise.reject(new DOMException(this.#error.message, "NotSupportedError"));
    if (this.#closed || !this.#paused) return Promise.resolve();
    if (this.#ended) this.#seek(0);
    this.#paused = false;
    this.#ended = false;
    void this.#speaker?.resume();
    this.#emit("play");
    this.#update();
    if (!this.#clock.running) this.#emit("waiting");
    this.#loop();
    return Promise.resolve();
  }

  pause() {
    if (this.#paused || this.#closed) return;
    this.#paused = true;
    this.#clock.stop();
    this.#sounds.silence();
    this.#stopLoop();
    this.#emit("timeupdate");
    this.#emit("pause");
  }

  getVideoPlaybackQuality() {
    return this.#pictures.quality();
  }

  /** Stop the worker and the sound; the element plays nothing after this. */
  close() {
    if (this.#closed) return;
    this.#closed = true;
    this.#stopLoop();
    this.#sounds.clear();
    this.#pictures.clear();
    this.#link.close();
    this.#speaker?.close();
    this.#screen?.close();
  }

  /** @param {any} data */
  #message(data) {
    if (data?.type === "ready") return this.#ready(data);
    if (data?.type === "error") return this.#fail(data.message || "The file could not be decoded.");
    // Output of an old seek is dropped, and counted as used so that the worker decodes on.
    const current = data?.seq === this.#seq;
    if (data?.type === "video") {
      this.#width = data.width;
      this.#height = data.height;
      if (current) this.#pictures.push(frameOf(data));
      else this.#pictures.stale();
    } else if (data?.type === "audio") {
      const chunk = chunkOf(data);
      if (current) this.#sounds.push(chunk);
      else this.#sounds.stale(chunk.duration);
    } else if (data?.type === "end") {
      if (current) this.#endSeen = true;
    } else return;
    if (current) this.#arrived();
    else this.#acks();
  }

  /** @param {Ready} data */
  #ready(data) {
    this.#info = data;
    const first = Number.isNaN(this.#duration);
    this.#duration = data.duration > 0 ? data.duration : Number.POSITIVE_INFINITY;
    this.#width = data.video?.width ?? this.#width;
    this.#height = data.video?.height ?? this.#height;
    if (data.audio && !this.#speaker) {
      this.#speaker = openSpeaker(this.#o.audioContext);
      this.#speaker?.volume(this.#muted ? 0 : this.#volume);
    }
    // A new worker on the file's bytes is not news to the transport.
    if (first) {
      this.#emit("loadedmetadata");
      this.#emit("durationchange");
    }
    if (!this.#paused) void this.#speaker?.resume();
    const at = this.#pending;
    this.#pending = null;
    if (at !== null && at > 0) this.#seek(at);
    this.#update();
  }

  /** Output of the current seek arrived: the seek is done; a paused element shows its picture. */
  #arrived() {
    if (this.#seeking) {
      this.#seeking = false;
      this.#emit("seeked");
      this.#emit("timeupdate");
    }
    if (!this.#loaded && (this.#pictures.length > 0 || this.#sounds.length > 0)) {
      this.#loaded = true;
      this.#emit("loadeddata");
    }
    // Nothing on screen since the last seek: a paused element shows the first picture.
    if (this.#paused && this.#screen && !Number.isFinite(this.#pictures.last))
      this.#pictures.first();
    this.#update();
    this.#acks();
    this.#loop();
  }

  /** Start the clock when there is something to play, stop it when there is nothing. */
  #update() {
    if (this.#closed || this.#error || !this.#info || this.#paused || this.#seeking) return;
    const t = this.#clock.time();
    // The sound leads when there is sound; else the pictures, with a little slack between them.
    const ahead = this.#speaker
      ? this.#sounds.ahead(t)
      : this.#pictures.length > 0 || t < this.#pictures.last + LATE_S;
    if (this.#clock.running && !ahead && !this.#endSeen) {
      this.#clock.stop();
      // Wait where the sound ran out, not where the frame loop noticed.
      const end = this.#sounds.end;
      if (this.#speaker && Number.isFinite(end) && end < t) this.#clock.set(end);
      this.#sounds.silence();
      this.#emit("waiting");
    } else if (!this.#clock.running && (ahead || this.#endSeen)) {
      this.#clock.start();
      this.#emit("playing");
    }
    // Sound is started as soon as it can be, not on the next frame.
    if (this.#clock.running)
      this.#sounds.schedule(this.#clock.time(), this.#speaker, this.#clock, this.#rate);
  }

  #tick() {
    this.#cancel = null;
    if (this.#paused || this.#closed || this.#error) return;
    this.#update();
    const t = this.#clock.time();
    if (this.#screen) this.#pictures.present(t, this.#clock.running);
    this.#sounds.retire(t);
    this.#acks();
    if (this.#finish(t)) return;
    const now = this.#now();
    if (now - this.#lastUpdate >= TIMEUPDATE_MS) {
      this.#lastUpdate = now;
      this.#emit("timeupdate");
    }
    this.#loop();
  }

  /** The end: everything that was decoded has been shown and heard. */
  #finish(/** @type {number} */ t) {
    if (!this.#endSeen || this.#pictures.length > 0 || this.#sounds.ahead(t)) return false;
    // The last picture stays for a moment: up to the duration, or a quarter second at most.
    const last = Math.max(this.#pictures.last, this.#sounds.end) + LATE_S;
    if (t < Math.min(Number.isFinite(this.#duration) ? this.#duration : last, last)) return false;
    if (this.loop) {
      this.#seek(0);
      return false;
    }
    this.#paused = true;
    this.#ended = true;
    this.#clock.stop();
    this.#clock.set(Number.isFinite(this.#duration) ? this.#duration : t);
    this.#sounds.silence();
    this.#stopLoop();
    for (const type of ["timeupdate", "pause", "ended"]) this.#emit(type);
    return true;
  }

  #seek(/** @type {number} */ time) {
    if (this.#closed || this.#error) return;
    const end = Number.isFinite(this.#duration) ? this.#duration : Number.POSITIVE_INFINITY;
    const to = Number.isFinite(time) ? Math.max(0, Math.min(time, end)) : 0;
    if (!this.#info) {
      this.#pending = to;
      this.#clock.set(to);
      return;
    }
    this.#seq++;
    // What was decoded for the old position counts as used: the worker decodes the new one.
    this.#pictures.flush();
    this.#sounds.flush();
    this.#acks();
    this.#seeking = true;
    this.#seekTo = to;
    this.#ended = false;
    this.#endSeen = false;
    this.#clock.stop();
    this.#clock.set(to);
    this.#emit("seeking");
    this.#link?.post({ type: "seek", time: to, seq: this.#seq });
  }

  /** A new worker opens the file from memory: start again where the element was. */
  #reopen() {
    const keep = this.currentTime;
    this.#pictures.clear();
    this.#sounds.clear();
    this.#seq = 0;
    this.#info = null;
    this.#seeking = false;
    this.#endSeen = false;
    this.#pending = keep > 0 ? keep : null;
  }

  #fail(/** @type {string} */ words) {
    if (this.#error || this.#closed) return;
    this.#error = { code: 4, message: words };
    this.#stopLoop();
    this.#sounds.silence();
    this.#clock.stop();
    this.#link.stop();
    this.#emit("error");
  }

  #gain() {
    this.#speaker?.volume(this.#muted ? 0 : this.#volume);
    this.#emit("volumechange");
  }

  /** Tell the worker what was used: it decodes ahead by at most 6 pictures and 1.5 s of sound. */
  #acks() {
    const ack = ackOf(this.#pictures, this.#sounds);
    if (ack) this.#link?.post(ack);
  }

  #loop() {
    if (this.#cancel || this.#paused || this.#closed || this.#error) return;
    this.#cancel = this.#frame(() => this.#tick());
  }

  #stopLoop() {
    this.#cancel?.();
    this.#cancel = null;
  }

  #emit(/** @type {string} */ type) {
    this.dispatchEvent(new Event(type));
  }
}

/**
 * The software player's element for one file.
 * @param {SoftwareOptions} options
 */
export const createSoftwareMedia = (options) => new SoftwareMedia(options);
