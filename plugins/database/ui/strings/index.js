// The plugin's words (PG-108, ADR 0366): every string its views show a person, by a named key of one
// catalog per language in this folder (`<language>.json`, the format of ADR 0250, en.json complete),
// so translating the plugin means adding one file here. `t` fills a message's `{name}`s, picks a
// plural form by `count` (Intl.PluralRules), and writes the count, as `number` writes any quantity,
// in the language's way (Intl.NumberFormat). A message from the server is never looked up: `server`
// shows it as the server sent it, marked as the server's words. A value in a result is data, never
// formatted here (NF-10).
import en from "./en.json" with { type: "json" };

/**
 * @typedef {string | { zero?: string, one?: string, two?: string, few?: string, many?: string, other: string }} Message
 * @typedef {Record<string, Message>} Catalog
 * @typedef {Record<string, string | number | Node | undefined>} Params
 */

/** This folder, where each language's file is (a bundler leaves a variable base as it is). */
const HERE = import.meta.url;
/** English, every other language's fallback. */
const ENGLISH = /** @type {Catalog} */ (en);
/** The language in force, and its catalog when it is not English. */
let language = "en";
/** @type {Catalog} */
let own = {};
const listeners = new Set();

/** The language in force, a BCP 47 tag the desk handed the plugin (`en`, `ko`). */
export const languageOf = () => language;

/** The catalog of `lang` is in, or English when it has none: what `t` reads from now on. */
export function useLanguage(
  /** @type {string} */ lang,
  /** @type {Catalog | undefined} */ catalog,
) {
  language = lang || "en";
  own = language === "en" || !catalog ? {} : catalog;
  for (const listener of [...listeners]) listener(language);
}

/** Hear each change of language; the function stops it. */
export function onLanguage(/** @type {(lang: string) => void} */ listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Bring the catalog of `lang` from this folder and use it; a language with no file here reads in
 * English. `load` reads a JSON file by its URL (the page's `fetch` by default).
 */
export async function loadLanguage(
  /** @type {string} */ lang,
  /** @type {(url: URL) => Promise<unknown>} */ load = async (url) => {
    const answer = await fetch(url);
    return answer.ok ? answer.json() : undefined;
  },
) {
  if (lang === "en") return useLanguage("en", undefined);
  const catalog = await load(new URL(`./${lang}.json`, HERE)).catch(() => undefined);
  useLanguage(
    lang,
    catalog && typeof catalog === "object" ? /** @type {Catalog} */ (catalog) : undefined,
  );
}

/** @type {Map<string, Intl.PluralRules>} */
const rules = new Map();
/** @type {Map<string, Intl.NumberFormat>} */
const numbers = new Map();

/** A quantity in the language's way: `1,234` in English. */
export function number(
  /** @type {number} */ n,
  /** @type {Intl.NumberFormatOptions} */ options = {},
) {
  const id = `${language}|${JSON.stringify(options)}`;
  let format = numbers.get(id);
  if (!format) {
    format = new Intl.NumberFormat(language, options);
    numbers.set(id, format);
  }
  return format.format(n);
}

/** @type {Map<string, Intl.DateTimeFormat>} */
const clocks = new Map();

/**
 * A moment's parts in the language's digits, two of them for each but the year, on the 24-hour
 * clock: what the catalog's `format.*` patterns place.
 */
function parts(/** @type {Date} */ at) {
  let format = clocks.get(language);
  if (!format) {
    format = new Intl.DateTimeFormat(language, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    clocks.set(language, format);
  }
  /** @type {Record<string, string>} */
  const out = {};
  for (const part of format.formatToParts(at))
    if (part.type !== "literal") out[part.type] = part.value;
  return out;
}

/** A moment's time of day in the language's way (`format.time`, `14:05`; `14:05:09` with seconds). */
export const clock = (/** @type {Date} */ at, seconds = false) =>
  t(seconds ? "format.timeSeconds" : "format.time", parts(at));

/** A moment's day in the language's way (`format.date`, `2026-11-20`). */
export const day = (/** @type {Date} */ at) => t("format.date", parts(at));

/** The form of `message` that `count` picks in `lang`, or `other`. */
function form(
  /** @type {Message} */ message,
  /** @type {string} */ lang,
  /** @type {unknown} */ count,
) {
  if (typeof message === "string") return message;
  if (typeof count !== "number" || !Number.isFinite(count)) return message.other;
  let rule = rules.get(lang);
  if (!rule) {
    rule = new Intl.PluralRules(lang);
    rules.set(lang, rule);
  }
  return message[rule.select(count)] ?? message.other;
}

/** The message `key` as written in the language in force, else English, else the key itself. */
function raw(/** @type {string} */ key, /** @type {Params | undefined} */ params) {
  const mine = own[key];
  if (mine !== undefined) return form(mine, language, params?.count);
  const english = ENGLISH[key];
  return english === undefined ? key : form(english, "en", params?.count);
}

/** A parameter as text: a number is a quantity in the language's way, a count among them. */
const shown = (/** @type {Params[string]} */ value) =>
  value === undefined
    ? ""
    : typeof value === "number"
      ? number(value)
      : typeof value === "string"
        ? value
        : (value.textContent ?? "");

/**
 * The words of `key`, each `{name}` replaced by its parameter (a number in the language's way, an
 * absent one by nothing), the plural form picked by `count`.
 */
export function t(/** @type {string} */ key, /** @type {Params} */ params = {}) {
  return raw(key, params).replace(/\{(\w+)\}/g, (_, name) => shown(params[name]));
}

/**
 * The words of `key` as nodes, for a message that holds a node (`server`'s words, a link): the text
 * around each `{name}` as text, a node parameter as itself.
 */
export function nodes(/** @type {string} */ key, /** @type {Params} */ params = {}) {
  /** @type {(string | Node)[]} */
  const out = [];
  const text = raw(key, params);
  let last = 0;
  for (const m of text.matchAll(/\{(\w+)\}/g)) {
    out.push(text.slice(last, m.index));
    const value = params[m[1] ?? ""];
    out.push(typeof value === "object" ? value : shown(value));
    last = (m.index ?? 0) + m[0].length;
  }
  out.push(text.slice(last));
  return out.filter((part) => part !== "");
}

/**
 * What the server said, as it said it: never translated, marked as the server's words
 * (`data-words="server"`, and `translate="no"` so no page translation rewrites it).
 */
export function serverWords(/** @type {Document} */ doc, /** @type {string} */ text) {
  const span = doc.createElement("span");
  span.dataset.words = "server";
  span.setAttribute("translate", "no");
  span.textContent = text;
  return span;
}

/** Whether the catalogs know `key` (English is complete). */
export const has = (/** @type {string} */ key) => key in ENGLISH;
