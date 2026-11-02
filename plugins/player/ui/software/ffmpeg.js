// endue.player's software decoder: FFmpeg's demuxers and decoders built to WebAssembly
// (ui/vendor/ffmpeg, LGPL 2.1, ADR 0050) behind a small API. No DOM and no fetch: the caller hands
// over the wasm and, for each file, a synchronous reader, so the same module runs in the decode
// worker and in Node for the tests. The C side is plugins/player/wasm/decode.c.
import { createWasi, importsFor } from "./wasi.js";

/**
 * @typedef {{ size: number, read(offset: number, length: number): Uint8Array }} SyncFile
 * @typedef {{ width: number, height: number, codec: string }} VideoInfo
 * @typedef {{ sampleRate: number, channels: number, codec: string }} AudioInfo
 * @typedef {{ kind: "video", time: number, width: number, height: number, planes: Uint8Array[],
 *   widths: number[], heights: number[], full: boolean, matrix: "bt601" | "bt709" }} VideoFrame
 * @typedef {{ kind: "audio", time: number, sampleRate: number, channels: Float32Array[] }} AudioFrame
 * @typedef {VideoFrame | AudioFrame} Frame
 * @typedef {{ duration: number, video: VideoInfo | null, audio: AudioInfo | null,
 *   next(): Frame | null, seek(time: number): void, skipNonRef(on: boolean): void,
 *   close(): void }} Media
 * @typedef {{ open(file: SyncFile, want?: { video: boolean, audio: boolean }): Media }} Ffmpeg
 */

const CODES = /** @type {const} */ (["", "open", "read", "decode"]);
const VIDEO = 1;
const AUDIO = 2;
const QUIET = -8;

/** An Error whose message is a sentence and whose code says which step failed. */
export class DecodeError extends Error {
  /**
   * @param {string} message
   * @param {"open" | "read" | "decode"} code
   * @param {unknown} [cause]
   */
  constructor(message, code, cause) {
    super(message, cause === undefined ? undefined : { cause });
    this.code = code;
  }
}

/**
 * Compile and start the decoder.
 * @param {ArrayBuffer | Uint8Array | WebAssembly.Module} wasm
 * @returns {Promise<Ffmpeg>}
 */
export async function loadFfmpeg(wasm) {
  const module =
    wasm instanceof WebAssembly.Module
      ? wasm
      : await WebAssembly.compile(/** @type {BufferSource} */ (wasm));
  /** @type {Map<number, { file: SyncFile, error?: unknown }>} */
  const files = new Map();
  /** @type {Record<string, any>} */
  let x = {};
  const memory = () => /** @type {WebAssembly.Memory} */ (x.memory);
  const bytes = () => new Uint8Array(memory().buffer);
  const wasi = createWasi(memory);
  const env = {
    /** FFmpeg asks for `length` bytes at `offset` of file `id`, to be written at `into`. */
    dk_read(/** @type {number} */ id, offset = 0, into = 0, length = 0) {
      const open = files.get(id);
      if (!open) return -1;
      try {
        const got = open.file.read(offset, length).subarray(0, length);
        bytes().set(got, into);
        return got.length;
      } catch (error) {
        open.error = error;
        return -1;
      }
    },
    emscripten_notify_memory_growth: () => {},
  };
  const instance = await WebAssembly.instantiate(module, importsFor(module, wasi, env));
  x = instance.exports;
  x._initialize?.();
  x.dk_quiet(QUIET);

  const text = (/** @type {number} */ at) => {
    const all = bytes();
    const end = all.indexOf(0, at);
    return new TextDecoder().decode(all.subarray(at, end < 0 ? at : end));
  };
  let ids = 0;

  return {
    open(file, want = { video: true, audio: true }) {
      const id = ++ids;
      files.set(id, { file });
      const m = x.dk_open(id, file.size, want.video ? 1 : 0, want.audio ? 1 : 0);
      /** Throw what the C side reported, with what the reader threw as its cause. */
      const failed = () => {
        const code = CODES[m ? x.dk_code(m) : 1] || "decode";
        return new DecodeError(
          m ? text(x.dk_error(m)) : "Out of memory.",
          code,
          files.get(id)?.error,
        );
      };
      if (!m || x.dk_code(m)) {
        const error = failed();
        if (m) x.dk_close(m);
        files.delete(id);
        throw error;
      }
      const video = x.dk_has_video(m)
        ? {
            width: x.dk_video_width(m),
            height: x.dk_video_height(m),
            codec: text(x.dk_video_codec(m)),
          }
        : null;
      const audio = x.dk_has_audio(m)
        ? {
            sampleRate: x.dk_audio_rate(m),
            channels: x.dk_audio_channels(m),
            codec: text(x.dk_audio_codec(m)),
          }
        : null;
      let closed = false;
      return {
        duration: x.dk_duration(m),
        video,
        audio,
        next() {
          if (closed) return null;
          const kind = x.dk_next(m);
          if (kind === VIDEO) return videoFrame(m);
          if (kind === AUDIO) return audioFrame(m);
          if (kind === 0) return null;
          throw failed();
        },
        seek(time) {
          if (closed) return;
          if (x.dk_seek(m, time) < 0 && CODES[x.dk_code(m)] === "read") throw failed();
        },
        skipNonRef(on) {
          if (!closed) x.dk_skip_nonref(m, on ? 1 : 0);
        },
        close() {
          if (closed) return;
          closed = true;
          x.dk_close(m);
          files.delete(id);
        },
      };
    },
  };

  /** The decoded picture, its planes copied out tightly packed. @returns {VideoFrame} */
  function videoFrame(/** @type {number} */ m) {
    /** @type {Uint8Array[]} */
    const planes = [];
    const widths = [];
    const heights = [];
    for (let i = 0; i < x.dk_planes(m); i++) {
      const w = x.dk_plane_width(m, i);
      const h = x.dk_plane_height(m, i);
      const stride = x.dk_linesize(m, i);
      const from = bytes().subarray(x.dk_plane(m, i));
      const plane = new Uint8Array(w * h);
      if (stride === w) plane.set(from.subarray(0, w * h));
      else for (let y = 0; y < h; y++) plane.set(from.subarray(y * stride, y * stride + w), y * w);
      planes.push(plane);
      widths.push(w);
      heights.push(h);
    }
    return {
      kind: "video",
      time: x.dk_time(m),
      width: x.dk_frame_width(m),
      height: x.dk_frame_height(m),
      planes,
      widths,
      heights,
      full: x.dk_full_range(m) === 1,
      matrix: x.dk_bt709(m) === 1 ? "bt709" : "bt601",
    };
  }

  /** The decoded samples, one Float32Array per channel. @returns {AudioFrame} */
  function audioFrame(/** @type {number} */ m) {
    const count = x.dk_sample_count(m);
    const at = x.dk_samples(m);
    const all = new Float32Array(memory().buffer, at, count * x.dk_sample_channels(m));
    /** @type {Float32Array[]} */
    const channels = [];
    for (let c = 0; c < x.dk_sample_channels(m); c++)
      channels.push(all.slice(c * count, (c + 1) * count));
    return { kind: "audio", time: x.dk_time(m), sampleRate: x.dk_sample_rate(m), channels };
  }
}
