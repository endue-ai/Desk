// Words and numbers people read: relative and absolute times, short ids, initials, the colour an
// author is drawn in, and counts. Pure functions, so the views and their tests agree.

import { COLORS } from "./graph.js";

/** `3 min ago`, `yesterday`, `5 days ago`, then the date. Seconds since the epoch. */
export function relativeTime(/** @type {number} */ seconds, now = Date.now() / 1000) {
  const diff = Math.max(0, now - seconds);
  if (diff < 45) return "just now";
  if (diff < 90) return "1 min ago";
  if (diff < 3600) return `${Math.round(diff / 60)} min ago`;
  if (diff < 5400) return "1 hour ago";
  if (diff < 86_400) return `${Math.round(diff / 3600)} hours ago`;
  if (diff < 172_800) return "yesterday";
  if (diff < 30 * 86_400) return `${Math.round(diff / 86_400)} days ago`;
  return shortDate(seconds);
}

/** `Nov 17, 2026`. */
export function shortDate(/** @type {number} */ seconds) {
  return new Date(seconds * 1000).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** `Nov 17, 2026, 14:05`. */
export function fullDate(/** @type {number} */ seconds) {
  return new Date(seconds * 1000).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export const shortSha = (/** @type {string} */ sha) => sha.slice(0, 7);

/** Up to two letters of a name: `Ada Lovelace` → `AL`, `linus` → `L`. */
export function initials(/** @type {string} */ name) {
  const words = name
    .trim()
    .split(/[\s._-]+/)
    .filter(Boolean);
  if (words.length === 0) return "?";
  const first = words[0]?.[0] ?? "";
  const last = words.length > 1 ? (words[words.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}

/** The same author is always the same of the eight chart colours. */
export function authorColor(/** @type {string} */ key) {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) | 0;
  return Math.abs(hash) % COLORS;
}

/** The theme token of colour `index` (0-based): `var(--desk-chart-1)`. */
export const chartColor = (/** @type {number} */ index) =>
  `var(--desk-chart-${(index % COLORS) + 1})`;

/** `1 file`, `3 files`. */
export const plural = (/** @type {number} */ n, /** @type {string} */ word, many = `${word}s`) =>
  `${n} ${n === 1 ? word : many}`;

/** The folder part of a path and its file name. */
export function splitPath(/** @type {string} */ path) {
  const at = path.lastIndexOf("/");
  return at < 0
    ? { dir: "", base: path }
    : { dir: path.slice(0, at + 1), base: path.slice(at + 1) };
}

/** The word for a change letter of status or diff --name-status. */
export const CHANGE_WORDS = Object.freeze({
  M: "Modified",
  A: "Added",
  D: "Deleted",
  R: "Renamed",
  C: "Copied",
  T: "Type changed",
  U: "Unmerged",
  "?": "Untracked",
});

export const changeWord = (/** @type {string} */ letter) =>
  CHANGE_WORDS[/** @type {keyof typeof CHANGE_WORDS} */ (letter)] ?? "Changed";
