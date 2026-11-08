// The three ways a file plays, behind one media element for the transport: the webview's own
// <video> or <audio> ("native"), the same element fed by Media Source Extensions with what the
// remuxer makes of the file ("remux"), or the software player's element, decoding in a worker
// ("software"). A remuxed picture whose sound MSE refuses (MP3, DTS, Vorbis in Matroska) gets that
// sound from the software decoder beside it, following the element's clock.
import { openRemux } from "./remux/index.js";
import { mediaSourceOf, playRemuxed } from "./remux/mse.js";
import { createSoftwareMedia } from "./software/element.js";

/**
 * @typedef {import("./player.js").Model} Model
 * @typedef {import("./remux/index.js").Source} Source
 * @typedef {import("./software/element.js").SoftwareMedia} SoftwareMedia
 * @typedef {HTMLMediaElement | SoftwareMedia} Media
 * @typedef {{
 *   startWorker?: () => Worker, wasm?: string,
 *   source?: (path: string) => Promise<Source>,
 *   readAll?: (path: string) => Promise<ArrayBuffer>,
 *   audioContext?: () => AudioContext,
 * }} EngineDeps
 *   What main.js gives from the SDK: the decoder worker and its WebAssembly, ranged and whole reads.
 * @typedef {{ busy(label: string | null): void, fail(reason?: string): void, say(words: string): void,
 *   listen(target: EventTarget): void }} Hooks
 * @typedef {{ media: Media, close(): void }} Playing
 */

/** How far the sound beside a remuxed picture may drift before it is moved back (seconds). */
const DRIFT = 0.2;

const message = (/** @type {unknown} */ error) =>
  error instanceof Error ? error.message : String(error);

/**
 * @param {any} win the frame's window
 * @param {EngineDeps} deps
 */
export function createEngines(win, deps) {
  const Source = mediaSourceOf(win);
  const software = Boolean(deps.startWorker && deps.wasm && typeof WebAssembly === "object");
  const absolute = (/** @type {string} */ url) => new URL(url, win.location.href).href;

  /** The software player for a target, with a canvas for its picture or none for sound alone. */
  const decoder = (
    /** @type {NonNullable<Model["target"]>} */ target,
    /** @type {string} */ src,
    /** @type {HTMLCanvasElement | undefined} */ canvas,
  ) => {
    const { startWorker, wasm, readAll, audioContext } = deps;
    if (!startWorker || !wasm) throw new Error("This system cannot run the player's decoder.");
    return createSoftwareMedia({
      canvas,
      startWorker,
      wasm: absolute(wasm),
      url: absolute(src),
      size: target.size,
      readAll: readAll ? () => readAll(target.path) : undefined,
      audioContext,
    });
  };

  /** The sound of the file from the decoder, kept on the element's clock. */
  const beside = (
    /** @type {HTMLMediaElement} */ element,
    /** @type {NonNullable<Model["target"]>} */ target,
    /** @type {string} */ src,
  ) => {
    const sound = decoder(target, src, undefined);
    const follow = () => {
      sound.volume = element.volume;
      sound.muted = element.muted;
      sound.playbackRate = element.playbackRate;
    };
    const align = () => {
      sound.currentTime = element.currentTime;
    };
    /** @type {Record<string, () => void>} */
    const on = {
      play: () => {
        align();
        void sound.play().catch(() => {});
      },
      pause: () => sound.pause(),
      seeking: align,
      ratechange: follow,
      volumechange: follow,
      timeupdate: () => {
        if (!element.paused && Math.abs(sound.currentTime - element.currentTime) > DRIFT) align();
      },
    };
    for (const [type, run] of Object.entries(on)) element.addEventListener(type, run);
    follow();
    return () => {
      for (const [type, run] of Object.entries(on)) element.removeEventListener(type, run);
      sound.close();
    };
  };

  /** Open the remuxer, keeping only the picture when MSE refuses the sound. */
  const remux = async (/** @type {Model} */ model, /** @type {Hooks} */ hooks) => {
    const target = /** @type {NonNullable<Model["target"]>} */ (model.target);
    if (!deps.source || !Source) throw new Error("This system has no Media Source Extensions.");
    const source = await deps.source(target.path);
    const supported = (/** @type {string} */ type) => Boolean(Source.isTypeSupported(type));
    /** @type {Error | undefined} */
    let refused;
    try {
      const all = await openRemux(source, target.format);
      if (supported(all.mime)) return { remuxed: all, sound: false };
      refused = new Error(`This system's Media Source Extensions cannot play ${all.mime}.`);
    } catch (error) {
      refused = error instanceof Error ? error : new Error(String(error));
    }
    // The picture alone, and its sound from the decoder.
    const picture = await openRemux(source, target.format, { audio: null }).catch(() => null);
    if (!picture?.tracks.some((t) => t.kind === "video") || !supported(picture.mime)) throw refused;
    const audio = picture.choices.find((c) => c.kind === "audio");
    if (audio && !software)
      hooks.say(`The sound (${audio.codec}) cannot be played here: the picture plays without it.`);
    return { remuxed: picture, sound: Boolean(audio) && software };
  };

  return {
    /** Whether MSE decodes a type (`video/mp4; codecs="..."`). */
    canRemux: (/** @type {string} */ type) => Boolean(Source?.isTypeSupported?.(type)),
    /** Whether the software decoder can run here. */
    software,

    /**
     * Play the model's file with its engine.
     * @param {Model} model
     * @param {HTMLMediaElement} element the <video> or <audio> the model names
     * @param {HTMLCanvasElement} canvas where the software player draws
     * @param {Hooks} hooks
     * @returns {Playing}
     */
    open(model, element, canvas, hooks) {
      const src = model.src ?? "";
      if (model.engine === "software" && model.target) {
        const media = decoder(model.target, src, model.element === "video" ? canvas : undefined);
        hooks.listen(media);
        hooks.busy("Starting the decoder…");
        return { media, close: () => media.close() };
      }
      if (model.engine !== "remux") {
        element.src = src;
        return {
          media: element,
          close() {
            element.pause();
            element.removeAttribute("src");
            element.load();
          },
        };
      }
      let closed = false;
      /** @type {Array<() => void>} */
      const undo = [];
      hooks.busy("Remuxing…");
      remux(model, hooks)
        .then(({ remuxed, sound }) => {
          if (closed) return;
          const fed = playRemuxed(element, remuxed, {
            win,
            start: model.start ?? 0,
            busy: hooks.busy,
            fail: (reason) => hooks.fail(reason),
          });
          undo.push(() => fed.close());
          if (sound && model.target) undo.push(beside(element, model.target, src));
        })
        .catch((error) => !closed && hooks.fail(message(error)));
      return {
        media: element,
        close() {
          closed = true;
          for (const step of undo.splice(0).reverse()) step();
        },
      };
    },
  };
}
