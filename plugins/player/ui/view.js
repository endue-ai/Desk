// The player's DOM: the header (the file's title and what it is), the stage with the video or the
// audio card, the details view, a subtitle file's cues, the playlist and chapters, the transport,
// and a status live region. The view keeps the transport's state; the controller (player.js) says
// what is open. Chords (Mod+S, Mod+O, Mod+W, Mod+K) are never prevented, so the desk gets them.

import { clock } from "./time.js";
import { createMedia } from "./view-media.js";
import { createPanels } from "./view-panels.js";

/**
 * @typedef {import("./player.js").Model} Model
 * @typedef {(name: string, ...args: unknown[]) => unknown} Act
 */

/** The header's second line: the format, the length, and where the file is. */
function detailOf(/** @type {Model} */ model) {
  const info = model.info;
  const parts = [];
  if (model.item)
    parts.push(
      `${model.name}, entry ${(model.playlist?.index ?? 0) + 1} of ${model.playlist?.rows.length ?? 1}`,
    );
  if (model.format) parts.push(model.format);
  if (info?.duration) parts.push(clock(info.duration));
  if (model.mode === "cues") parts.push(`${model.cues?.length ?? 0} cues`);
  parts.push(model.item?.path ?? model.path);
  return parts.join(" · ");
}

/**
 * @param {Document} doc
 * @param {Act} act
 */
export function createView(doc, act) {
  const byId = (/** @type {string} */ id) => /** @type {HTMLElement} */ (doc.getElementById(id));
  const title = byId("title");
  const detail = byId("detail");
  const stage = byId("stage");
  const message = byId("message");
  const status = byId("status");
  const media = createMedia(doc, act);
  const panels = createPanels(doc, act, (seconds) => media.seekTo(seconds));
  media.onTime((now) => panels.time(now));
  /** @type {Model | null} */
  let model = null;

  return {
    /** @param {Model | null} next */
    show(next) {
      model = next;
      doc.body.dataset.mode = next?.mode ?? "empty";
      if (!next) {
        title.textContent = "No file open";
        detail.textContent = "";
      } else {
        const tags = next.info?.tags;
        title.textContent = (next.mode === "media" && tags?.title) || next.item?.name || next.name;
        detail.textContent = detailOf(next);
      }
      const playing = next?.mode === "media" || next?.mode === "loading";
      stage.hidden = !playing;
      message.hidden = !next?.message;
      message.textContent = next?.message ?? "";
      if (next?.mode === "media") media.load(next);
      else media.unload();
      panels.card(next);
      panels.details(next);
      panels.cues(next);
      panels.side(next);
    },

    /** @param {string} words */
    status(words) {
      status.textContent = words;
    },

    focus() {
      if (model?.mode === "media") stage.focus();
      else title.focus();
    },

    /** What the webview says about a media type: "", "maybe" or "probably". */
    canPlay: (/** @type {string} */ type) => media.canPlay(type),
  };
}
