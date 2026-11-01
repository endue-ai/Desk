// The decode worker, started with the SDK's startWorker: FFmpeg in WebAssembly (ffmpeg.js) reads the
// file by ranges (reader.js) and decodes one video and one audio stream a little ahead of the page:
// at most MAX_FRAMES frames and MAX_AUDIO seconds of audio the page has not acknowledged. It decodes
// in short batches between messages, so a seek, an ack or a close is answered at once. It imports
// its neighbours by relative URL: import maps do not reach workers.
//
// Page -> worker: { type: "open", wasm, url?, bytes?, size, video, audio }, { type: "seek", time,
// seq }, { type: "ack", video?, audio? }, { type: "late", on }, { type: "close" }.
// Worker -> page: { type: "ready", duration, video, audio }, { type: "video", seq, time, width,
// height, planes, widths, heights, full, matrix }, { type: "audio", seq, time, sampleRate, data },
// { type: "end", seq }, { type: "error", code: "read" | "open" | "decode", message }. Planes and
// channel data are ArrayBuffers, transferred. Output carries the seq of the last seek (0 before any);
// a seek starts the count of unacknowledged output again, so stale output needs no ack.
import { loadFfmpeg } from "./ffmpeg.js";
import { bytesReader, urlReader } from "./reader.js";

const MAX_FRAMES = 6;
const MAX_AUDIO = 1.5;
// While one kind is short the other may run ahead, but never further than this.
const HARD_FRAMES = 24;
const HARD_AUDIO = 6;
const BATCH_MS = 12;

/**
 * @typedef {import("./ffmpeg.js").Media} Media
 * @typedef {import("./ffmpeg.js").Frame} Frame
 */

/** @type {Promise<import("./ffmpeg.js").Ffmpeg> | undefined} */
let loading;
let loadingFrom = "";
/** @type {Media | undefined} */
let media;
/** @type {number | undefined} */
let pendingSeek;
let seq = 0;
let frames = 0;
let audio = 0;
let ended = false;
let scheduled = false;
let closed = false;
let opens = 0;

const scope = /** @type {{ postMessage(message: unknown, transfer?: Transferable[]): void,
  onmessage: ((event: MessageEvent) => void) | null, close?(): void }} */ (
  /** @type {unknown} */ (globalThis)
);
const post = (/** @type {unknown} */ message, /** @type {Transferable[]} */ transfer = []) =>
  scope.postMessage(message, transfer);

const failure = (/** @type {unknown} */ error, fallback = "decode") => ({
  type: "error",
  code: /** @type {{ code?: string }} */ (error)?.code ?? fallback,
  message: error instanceof Error ? error.message : String(error),
});

/** The decoder, compiled once per worker. */
function decoder(/** @type {string} */ wasm) {
  if (!loading || loadingFrom !== wasm) {
    loadingFrom = wasm;
    loading = fetch(wasm)
      .then((answer) => {
        if (!answer.ok) throw new Error(`${wasm} answered ${answer.status}`);
        return answer.arrayBuffer();
      })
      .then(loadFfmpeg);
    loading.catch(() => {
      loading = undefined;
    });
  }
  return loading;
}

function closeMedia() {
  media?.close();
  media = undefined;
}

/** @param {{ wasm: string, url?: string, bytes?: ArrayBuffer, size: number, video: boolean, audio: boolean }} message */
async function open(message) {
  const mine = ++opens;
  closeMedia();
  ended = false;
  frames = 0;
  audio = 0;
  seq = 0;
  pendingSeek = undefined;
  let ffmpeg;
  try {
    ffmpeg = await decoder(message.wasm);
  } catch (error) {
    post(failure(new Error(`The decoder could not be loaded: ${String(error)}`), "open"));
    return;
  }
  if (mine !== opens || closed) return;
  try {
    const file = message.bytes
      ? bytesReader(message.bytes)
      : urlReader(String(message.url), message.size);
    media = ffmpeg.open(file, { video: message.video, audio: message.audio });
    post({ type: "ready", duration: media.duration, video: media.video, audio: media.audio });
    if (pendingSeek !== undefined) media.seek(pendingSeek);
    pendingSeek = undefined;
    schedule();
  } catch (error) {
    post(failure(error, "open"));
  }
}

function wants() {
  if (!media || ended || closed) return false;
  if (frames >= HARD_FRAMES || audio >= HARD_AUDIO) return false;
  return (
    (media.video !== null && frames < MAX_FRAMES) || (media.audio !== null && audio < MAX_AUDIO)
  );
}

function schedule() {
  if (scheduled || !wants()) return;
  scheduled = true;
  setTimeout(step, 0);
}

function step() {
  scheduled = false;
  const started = performance.now();
  while (media && wants() && performance.now() - started < BATCH_MS) {
    /** @type {Frame | null} */
    let frame;
    try {
      frame = media.next();
    } catch (error) {
      ended = true;
      post(failure(error));
      return;
    }
    if (!frame) {
      ended = true;
      post({ type: "end", seq });
      return;
    }
    send(frame);
  }
  schedule();
}

function send(/** @type {Frame} */ frame) {
  if (frame.kind === "video") {
    frames++;
    const planes = frame.planes.map((plane) => /** @type {ArrayBuffer} */ (plane.buffer));
    const { time, width, height, widths, heights, full, matrix } = frame;
    post(
      { type: "video", seq, time, width, height, planes, widths, heights, full, matrix },
      planes,
    );
    return;
  }
  audio += (frame.channels[0]?.length ?? 0) / frame.sampleRate;
  const data = frame.channels.map((channel) => /** @type {ArrayBuffer} */ (channel.buffer));
  post({ type: "audio", seq, time: frame.time, sampleRate: frame.sampleRate, data }, data);
}

scope.onmessage = (/** @type {MessageEvent} */ event) => {
  const message = event.data ?? {};
  switch (message.type) {
    case "open":
      void open(message);
      break;
    case "seek":
      seq = Number(message.seq) || 0;
      frames = 0;
      audio = 0;
      ended = false;
      if (!media) {
        pendingSeek = Number(message.time) || 0;
        break;
      }
      try {
        media.seek(Number(message.time) || 0);
      } catch (error) {
        ended = true;
        post(failure(error));
        break;
      }
      schedule();
      break;
    case "ack":
      frames = Math.max(0, frames - (Number(message.video) || 0));
      audio = Math.max(0, audio - (Number(message.audio) || 0));
      schedule();
      break;
    case "late":
      media?.skipNonRef(Boolean(message.on));
      break;
    case "close":
      closed = true;
      closeMedia();
      scope.close?.();
      break;
  }
};
