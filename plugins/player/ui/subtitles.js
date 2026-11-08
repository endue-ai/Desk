// Subtitles as one cue list: SubRip, WebVTT, ASS and SSA (dialogue text, override tags dropped),
// YouTube's SBV, and through subtitles-xml.js TTML/DFXP and SAMI. Also the offset that moves every
// cue, the cues on screen at a time, and the same-name subtitles next to a video.
import { extensionOf, SUBTITLE_EXTENSIONS } from "./format.js";
import { parseSami, parseTtml } from "./subtitles-xml.js";

/**
 * @typedef {{ start: number, end: number, text: string }} Cue
 * @typedef {{ id: string, name: string, lang: string }} Language
 * @typedef {{ format: string, name: string, cues: Cue[], languages?: Language[] }} Subtitles
 */

const NAMES = /** @type {Record<string, string>} */ ({
  srt: "SubRip subtitles",
  vtt: "WebVTT",
  ass: "Advanced SubStation Alpha",
  ssa: "SubStation Alpha",
  sbv: "YouTube SubViewer",
  ttml: "TTML",
  sami: "SAMI",
});

const BY_EXTENSION = /** @type {Record<string, string>} */ ({
  srt: "srt",
  vtt: "vtt",
  ass: "ass",
  ssa: "ssa",
  sbv: "sbv",
  ttml: "ttml",
  dfxp: "ttml",
  xml: "ttml",
  smi: "sami",
  sami: "sami",
});

/** Seconds, to the millisecond. */
export const ms = (/** @type {number} */ seconds) => Math.round(seconds * 1000) / 1000;

/** h:mm:ss followed by a fraction in `text`, as seconds. */
function clock(
  /** @type {string} */ h,
  /** @type {string} */ m,
  /** @type {string} */ s,
  /** @type {string} */ fraction,
) {
  return ms(Number(h || 0) * 3600 + Number(m) * 60 + Number(s) + Number(`0.${fraction || 0}`));
}

const ENTITIES = /** @type {Record<string, string>} */ ({
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
});

/** Markup out, entities decoded, lines trimmed: the words a cue shows. */
export function plain(/** @type {string} */ text) {
  return text
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, name) => {
      const lower = String(name).toLowerCase();
      if (lower.startsWith("#x")) return String.fromCodePoint(Number.parseInt(lower.slice(2), 16));
      if (lower.startsWith("#")) return String.fromCodePoint(Number(lower.slice(1)));
      return ENTITIES[lower] ?? whole;
    })
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .trim();
}

const blocks = (/** @type {string} */ text) =>
  text
    .replace(/\r\n?/g, "\n")
    .split(/\n[ \t]*\n/)
    .map((b) => b.trim())
    .filter(Boolean);

function parseSrt(/** @type {string} */ text) {
  /** @type {Cue[]} */
  const cues = [];
  const time =
    /(?:(\d+):)?(\d{1,2}):(\d{1,2})[,.](\d{1,3})\s*-->\s*(?:(\d+):)?(\d{1,2}):(\d{1,2})[,.](\d{1,3})/;
  for (const block of blocks(text)) {
    const lines = block.split("\n");
    const at = lines.findIndex((line) => time.test(line));
    if (at < 0) continue;
    const m = /** @type {RegExpExecArray} */ (time.exec(lines[at] ?? ""));
    const [, h1 = "", m1 = "", s1 = "", f1 = "", h2 = "", m2 = "", s2 = "", f2 = ""] = m;
    cues.push({
      start: clock(h1, m1, s1, f1),
      end: clock(h2, m2, s2, f2),
      text: plain(lines.slice(at + 1).join("\n")),
    });
  }
  return cues;
}

function parseVtt(/** @type {string} */ text) {
  /** @type {Cue[]} */
  const cues = [];
  const time = /(?:(\d+):)?(\d{2}):(\d{2})\.(\d{3})\s*-->\s*(?:(\d+):)?(\d{2}):(\d{2})\.(\d{3})/;
  for (const block of blocks(text)) {
    if (/^(WEBVTT|NOTE|STYLE|REGION)\b/.test(block)) continue;
    const lines = block.split("\n");
    const at = lines.findIndex((line) => line.includes("-->"));
    const m = at < 0 ? null : time.exec(lines[at] ?? "");
    if (!m) continue;
    const [, h1 = "", m1 = "", s1 = "", f1 = "", h2 = "", m2 = "", s2 = "", f2 = ""] = m;
    const words = plain(
      lines
        .slice(at + 1)
        .join("\n")
        .replace(/<\d[\d:.]*>/g, ""),
    );
    cues.push({ start: clock(h1, m1, s1, f1), end: clock(h2, m2, s2, f2), text: words });
  }
  return cues;
}

function parseAss(/** @type {string} */ text) {
  /** @type {Cue[]} */
  const cues = [];
  let events = false;
  let fields = [
    "layer",
    "start",
    "end",
    "style",
    "name",
    "marginl",
    "marginr",
    "marginv",
    "effect",
    "text",
  ];
  const time = /(\d+):(\d{2}):(\d{2})\.(\d{1,3})/;
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    if (line.startsWith("[")) {
      events = /^\[events\]/i.test(line);
      continue;
    }
    if (!events) continue;
    if (/^format\s*:/i.test(line)) {
      fields = line
        .slice(line.indexOf(":") + 1)
        .split(",")
        .map((f) => f.trim().toLowerCase());
      continue;
    }
    if (!/^dialogue\s*:/i.test(line)) continue;
    const parts = line.slice(line.indexOf(":") + 1).split(",");
    const values = [...parts.slice(0, fields.length - 1), parts.slice(fields.length - 1).join(",")];
    const get = (/** @type {string} */ name) => (values[fields.indexOf(name)] ?? "").trim();
    const start = time.exec(get("start"));
    const end = time.exec(get("end"));
    if (!start || !end) continue;
    const words = get("text")
      .replace(/\{[^}]*\}/g, "")
      .replace(/\\[Nn]/g, "\n")
      .replace(/\\h/g, " ");
    cues.push({
      start: clock(start[1] ?? "", start[2] ?? "", start[3] ?? "", start[4] ?? ""),
      end: clock(end[1] ?? "", end[2] ?? "", end[3] ?? "", end[4] ?? ""),
      text: plain(words.replace(/</g, "&lt;")),
    });
  }
  return cues;
}

function parseSbv(/** @type {string} */ text) {
  /** @type {Cue[]} */
  const cues = [];
  const time = /^(\d+):(\d{2}):(\d{2})\.(\d{1,3}),(\d+):(\d{2}):(\d{2})\.(\d{1,3})/;
  for (const block of blocks(text)) {
    const [first = "", ...rest] = block.split("\n");
    const m = time.exec(first.trim());
    if (!m) continue;
    const [, h1 = "", m1 = "", s1 = "", f1 = "", h2 = "", m2 = "", s2 = "", f2 = ""] = m;
    cues.push({
      start: clock(h1, m1, s1, f1),
      end: clock(h2, m2, s2, f2),
      text: plain(rest.join("\n")),
    });
  }
  return cues;
}

/** The format the text says it is, else what the extension says, else SubRip. */
function formatOf(/** @type {string} */ text, /** @type {string} */ hint) {
  const start = text.trimStart();
  if (/^WEBVTT/.test(start)) return "vtt";
  if (/^\[Script Info\]/i.test(start))
    return /ScriptType:\s*v4\.00\s*$/im.test(text) ? "ssa" : "ass";
  if (/<sami[\s>]/i.test(text)) return "sami";
  if (/<tt[\s>]/.test(text)) return "ttml";
  const byName = BY_EXTENSION[hint.toLowerCase()] ?? BY_EXTENSION[extensionOf(hint)];
  if (byName) return byName;
  if (/^\d+:\d{2}:\d{2}\.\d+,\d+:\d{2}:\d{2}\.\d+/m.test(start)) return "sbv";
  return "srt";
}

/**
 * Parse subtitles. `hint` is the file name or its extension; `language` picks a SAMI class.
 * @param {string} text
 * @param {string} hint
 * @param {{ language?: string }} [options]
 * @returns {Subtitles}
 */
export function parseSubtitles(text, hint, options = {}) {
  const format = formatOf(text.replace(/^﻿/, ""), hint);
  const name = NAMES[format] ?? format;
  /** @type {Subtitles} */
  let result;
  if (format === "sami") result = { format, name, ...parseSami(text, options.language) };
  else if (format === "ttml") result = { format, name, cues: parseTtml(text) };
  else {
    const parse =
      { vtt: parseVtt, ass: parseAss, ssa: parseAss, sbv: parseSbv }[format] ?? parseSrt;
    result = { format, name, cues: parse(text) };
  }
  result.cues = result.cues
    .filter((c) => c.text !== "" && c.end > c.start)
    .sort((a, b) => a.start - b.start);
  return result;
}

/** Every cue moved by `offset` seconds (later when positive), never before zero. */
export function shift(/** @type {Cue[]} */ cues, /** @type {number} */ offset) {
  return cues.map((c) => ({
    start: Math.max(0, ms(c.start + offset)),
    end: Math.max(0, ms(c.end + offset)),
    text: c.text,
  }));
}

/** The cues on screen at `time`. */
export function activeAt(/** @type {Cue[]} */ cues, /** @type {number} */ time) {
  return cues.filter((c) => c.start <= time && time < c.end);
}

/**
 * Subtitle files that belong to a video by name: `film.srt`, `film.ko.srt`, `film.en.vtt` for
 * `film.mp4`, in any case. The plain one comes first, then the others by name.
 * @param {string} video
 * @param {string[]} names
 */
export function sameName(video, names) {
  const base = video.replace(/\.[^.]+$/, "").toLowerCase();
  const found = [];
  for (const name of names) {
    if (!SUBTITLE_EXTENSIONS.includes(extensionOf(name))) continue;
    const stem = name.replace(/\.[^.]+$/, "");
    const lower = stem.toLowerCase();
    if (lower === base) found.push({ name, language: "" });
    else if (lower.startsWith(`${base}.`))
      found.push({ name, language: stem.slice(base.length + 1) });
  }
  return found.sort((a, b) =>
    a.language === "" && b.language !== ""
      ? -1
      : b.language === "" && a.language !== ""
        ? 1
        : a.name < b.name
          ? -1
          : a.name > b.name
            ? 1
            : 0,
  );
}
