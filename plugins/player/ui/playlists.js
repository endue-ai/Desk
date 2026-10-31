// Playlists: M3U and M3U8 (with #EXTINF titles), PLS, XSPF and CUE sheets (one file with track
// indexes, as chapters). Local entries resolve against the playlist's folder; http(s) entries are
// kept as remote, which the player lists but does not play.

/**
 * @typedef {{ title: string, start: number }} Chapter
 * @typedef {{ path?: string, url?: string, title: string, duration?: number, remote?: true,
 *   chapters?: Chapter[] }} Entry
 * @typedef {{ format: string, entries: Entry[] }} Playlist
 */

const nameOf = (/** @type {string} */ path) => path.slice(path.lastIndexOf("/") + 1);

/**
 * A playlist's reference as a desk path: absolute and `~/` paths stay, `file://` URLs are decoded,
 * anything else is relative to the playlist's folder. Backslashes count as separators.
 * @param {string} playlist the playlist's own path
 * @param {string} ref
 */
export function resolvePath(playlist, ref) {
  let target = ref.trim().replace(/\\/g, "/");
  if (/^file:\/\//i.test(target)) {
    target = decodeURI(target.replace(/^file:\/\/(localhost)?/i, ""));
    if (/^\/[a-z]:\//i.test(target)) target = target.slice(1);
  }
  const absolute = target.startsWith("/") || target.startsWith("~/") || /^[a-z]:\//i.test(target);
  const folder = playlist.slice(0, playlist.lastIndexOf("/"));
  const joined = absolute ? target : `${folder}/${target}`;
  const root = joined.startsWith("~/") ? "~" : /^[a-z]:\//i.test(joined) ? joined.slice(0, 2) : "";
  const parts = [];
  for (const part of joined.slice(root.length).split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return `${root}/${parts.join("/")}`;
}

const isRemote = (/** @type {string} */ ref) =>
  /^[a-z][a-z0-9+.-]*:\/\//i.test(ref) && !/^file:/i.test(ref);

/** One entry from a reference, a title and a duration in seconds (unknown at zero or below). */
function entry(
  /** @type {string} */ list,
  /** @type {string} */ ref,
  /** @type {string} */ title,
  /** @type {number} */ duration,
) {
  const trimmed = ref.trim();
  /** @type {Entry} */
  if (isRemote(trimmed)) return { url: trimmed, title: title || trimmed, remote: true };
  const path = resolvePath(list, trimmed);
  /** @type {Entry} */
  const out = { path, title: title || nameOf(path) };
  if (duration > 0) out.duration = duration;
  return out;
}

function m3u(/** @type {string} */ text, /** @type {string} */ list) {
  /** @type {Entry[]} */
  const entries = [];
  let title = "";
  let duration = -1;
  for (const raw of text.split(/\r\n?|\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const info = /^#EXTINF:\s*(-?[\d.]+)[^,]*,(.*)$/i.exec(line);
    if (info) {
      duration = Number(info[1]);
      title = (info[2] ?? "").trim();
      continue;
    }
    if (line.startsWith("#")) continue;
    entries.push(entry(list, line, title, duration));
    title = "";
    duration = -1;
  }
  return entries;
}

function pls(/** @type {string} */ text, /** @type {string} */ list) {
  /** @type {Map<number, { file?: string, title?: string, length?: number }>} */
  const items = new Map();
  for (const raw of text.split(/\r\n?|\n/)) {
    const m = /^\s*(File|Title|Length)(\d+)\s*=\s*(.*)$/i.exec(raw);
    if (!m) continue;
    const n = Number(m[2]);
    const item = items.get(n) ?? {};
    const key = (m[1] ?? "").toLowerCase();
    const value = (m[3] ?? "").trim();
    if (key === "file") item.file = value;
    else if (key === "title") item.title = value;
    else item.length = Number(value);
    items.set(n, item);
  }
  return [...items]
    .sort(([a], [b]) => a - b)
    .flatMap(([, item]) =>
      item.file ? [entry(list, item.file, item.title ?? "", item.length ?? -1)] : [],
    );
}

function xspf(/** @type {string} */ text, /** @type {string} */ list) {
  if (typeof DOMParser === "undefined") throw new Error("XSPF needs the frame's XML parser.");
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.getElementsByTagName("parsererror").length > 0)
    throw new Error("The XSPF file is not well-formed XML.");
  /** @type {Entry[]} */
  const entries = [];
  for (const track of doc.getElementsByTagNameNS("*", "track")) {
    const get = (/** @type {string} */ name) =>
      track.getElementsByTagNameNS("*", name)[0]?.textContent?.trim() ?? "";
    const location = get("location");
    if (!location) continue;
    const title = [get("creator"), get("title")].filter(Boolean).join(" - ");
    const ms = Number(get("duration"));
    const ref = isRemote(location) || /^file:/i.test(location) ? location : decodeURI(location);
    entries.push(entry(list, ref, title, ms > 0 ? ms / 1000 : -1));
  }
  return entries;
}

function cue(/** @type {string} */ text, /** @type {string} */ list) {
  /** @type {Entry[]} */
  const entries = [];
  const quoted = (/** @type {string} */ rest) =>
    /^"(.*)"/.exec(rest)?.[1] ?? rest.split(/\s+/)[0] ?? "";
  let album = "";
  let performer = "";
  /** @type {{ title: string, performer: string, start: number } | null} */
  let track = null;
  /** @type {Entry | null} */
  let current = null;
  const finish = () => {
    if (track && current) {
      const who = track.performer && track.performer !== performer ? `${track.performer} - ` : "";
      current.chapters?.push({
        title: `${who}${track.title}`.trim() || `Track ${(current.chapters?.length ?? 0) + 1}`,
        start: track.start,
      });
    }
    track = null;
  };
  for (const raw of text.split(/\r\n?|\n/)) {
    const line = raw.trim();
    const [word = ""] = line.split(/\s+/);
    const rest = line.slice(word.length).trim();
    const command = word.toUpperCase();
    if (command === "FILE") {
      finish();
      const name = /^"(.*)"\s*\S*$/.exec(rest)?.[1] ?? rest.replace(/\s+\S+$/, "");
      const title = [performer, album].filter(Boolean).join(" - ");
      current = { path: resolvePath(list, name), title: title || nameOf(name), chapters: [] };
      entries.push(current);
    } else if (command === "TRACK") {
      finish();
      track = { title: "", performer: "", start: 0 };
    } else if (command === "TITLE") {
      if (track) track.title = quoted(rest);
      else album = quoted(rest);
    } else if (command === "PERFORMER") {
      if (track) track.performer = quoted(rest);
      else performer = quoted(rest);
    } else if (command === "INDEX" && track) {
      const m = /^(\d+)\s+(\d+):(\d+):(\d+)/.exec(rest);
      if (m && Number(m[1]) === 1)
        track.start = Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 75;
    }
  }
  finish();
  for (const e of entries) {
    if (performer || album) e.title = [performer, album].filter(Boolean).join(" - ");
    if (e.chapters?.length === 0) delete e.chapters;
  }
  return entries;
}

/**
 * @param {string} text
 * @param {string} format the extension: m3u, m3u8, pls, xspf or cue
 * @param {string} path the playlist's own path, for relative entries
 * @returns {Playlist}
 */
export function parsePlaylist(text, format, path) {
  const kind = format.toLowerCase() === "m3u8" ? "m3u" : format.toLowerCase();
  const clean = text.replace(/^﻿/, "");
  if (kind === "pls" || /^\s*\[playlist\]/i.test(clean))
    return { format: "pls", entries: pls(clean, path) };
  if (kind === "xspf" || /<playlist[\s>]/.test(clean))
    return { format: "xspf", entries: xspf(clean, path) };
  if (kind === "cue") return { format: "cue", entries: cue(clean, path) };
  return { format: "m3u", entries: m3u(clean, path) };
}
