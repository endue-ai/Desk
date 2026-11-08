// What the view shows for an open file: the controller's entry (player.js) as a plain model, with
// the subtitles moved by their offset, the playlist as rows and the cover as a data: URL.
import { pictureUrl } from "./load.js";
import { shift } from "./subtitles.js";
import { clock } from "./time.js";

/**
 * @typedef {import("./player.js").Entry} Entry
 * @typedef {import("./player.js").Model} Model
 * @typedef {import("./player.js").Row} Row
 */

/** A playlist's rows: each entry's title, what is said about it, and its state. */
export function rowsOf(/** @type {NonNullable<Entry["playlist"]>} */ list) {
  return list.entries.map((e, i) => {
    const state = list.states[i];
    /** @type {Row} */
    const row = {
      title: e.title,
      detail: e.duration ? clock(e.duration) : "",
      state: i === list.index ? "playing" : "queued",
    };
    if (e.remote)
      return { ...row, detail: "Remote: not played", state: /** @type {const} */ ("remote") };
    if (state && i !== list.index)
      return { ...row, detail: state, state: /** @type {const} */ ("missing") };
    return row;
  });
}

/** What the view shows for an open file. */
export function modelOf(/** @type {Entry} */ entry) {
  const { buffer, path, name, size, format, mode, item } = entry;
  /** @type {Model} */
  const model = { buffer, path, name, size, format, mode };
  if (entry.why && mode === "details") model.why = entry.why;
  if (entry.message) model.message = entry.message;
  if (item?.info) model.info = item.info;
  if (mode === "cues") model.cues = entry.cues ?? [];
  if (mode === "media" && item) {
    model.element = item.element;
    const src = item.blob ?? item.url;
    if (src) model.src = src;
    if (!item.blob) {
      model.engine = item.engine ?? "native";
      if (model.engine !== "native")
        model.target = { path: item.path, size: item.size, format: item.info?.format ?? "" };
    }
    model.start = entry.position;
    if (entry.resume !== null) model.resume = entry.resume;
    const cover = pictureUrl(item.info?.cover);
    if (cover) model.cover = cover;
    const subs = entry.subs;
    model.cues = subs ? shift(subs.cues, subs.offset) : [];
    if (subs && subs.options.length > 0)
      model.subtitles = { options: subs.options, selected: subs.selected, offset: subs.offset };
  }
  if (item && item.path !== path) model.item = { path: item.path, name: item.name };
  const list = entry.playlist;
  if (list) {
    model.playlist = { rows: rowsOf(list), index: list.index };
    const chapters = list.entries[list.index]?.chapters;
    if (chapters) model.chapters = chapters;
  }
  if (!model.chapters && item?.info?.chapters) model.chapters = item.info.chapters;
  return model;
}
