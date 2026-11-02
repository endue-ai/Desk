// The engine under the transport: it opens the model's source with engines.js, shows the progress
// bar while the engine starts, remuxes or waits for data (with Cancel), and lets a failure, a
// sentence or a busy label count only while the engine that sent it is still the one playing.

/**
 * @typedef {import("./player.js").Model} Model
 * @typedef {import("./engines.js").Media} Media
 * @typedef {import("./engines.js").Playing} Playing
 * @typedef {(name: string, ...args: unknown[]) => unknown} Act
 */

/** The events after which the media no longer waits. */
const SETTLED = ["loadeddata", "canplay", "playing", "seeked", "pause", "error"];

/**
 * @param {Document} doc
 * @param {Act} act
 * @param {ReturnType<typeof import("./engines.js").createEngines>} engines
 */
export function createEngineSlot(doc, act, engines) {
  const screen = /** @type {HTMLCanvasElement} */ (doc.getElementById("screen"));
  const progress = /** @type {HTMLElement} */ (doc.getElementById("progress"));
  /** @type {Playing | null} */
  let playing = null;
  /** What the engine is busy with, and whether the media waits for data while playing. */
  let busy = /** @type {string | null} */ (null);
  let starved = false;

  const draw = () => {
    const label = busy ?? (starved ? "Buffering…" : null);
    progress.hidden = label === null;
    if (label !== null) progress.setAttribute("label", label);
  };
  const settle = () => {
    busy = null;
    starved = false;
    draw();
  };

  return {
    screen,
    /**
     * Open the model's source on `element` (or the software player's own media); `listen` wires the
     * transport's handlers to a media the engine made.
     * @param {Model} next
     * @param {HTMLMediaElement} element
     * @param {(target: EventTarget) => void} listen
     * @returns {Media}
     */
    open(next, element, listen) {
      this.close();
      /** @type {Playing | null} */
      let opened = null;
      const live = () => opened === null || playing === opened;
      opened = engines.open(next, element, screen, {
        busy: (label) => {
          if (!live()) return;
          busy = label;
          draw();
        },
        fail: (reason) => live() && act("failed", reason),
        say: (words) => live() && act("say", words),
        listen,
      });
      playing = opened;
      return opened.media;
    },
    /** Stop the engine and forget what it was busy with. */
    close() {
      const engine = playing;
      playing = null;
      engine?.close();
      settle();
    },
    /** Follow a media's waits; `mine` says whether an event is the current media's. */
    watch(/** @type {EventTarget} */ target, /** @type {(event: Event) => boolean} */ mine) {
      for (const type of SETTLED) target.addEventListener(type, (event) => mine(event) && settle());
      target.addEventListener("waiting", (event) => {
        if (!mine(event)) return;
        starved = true;
        draw();
      });
    },
    /** Cancel on the progress bar. */
    onCancel(/** @type {() => void} */ run) {
      progress.addEventListener("desk-cancel", run);
    },
  };
}
