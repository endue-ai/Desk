// The terminal's notifications on the desk (ADR 0113), without the DOM: what programs send (OSC 9,
// 777, 99), the bell, a long command finishing (OSC 133 / 633) and a program ending with an error,
// each one ui.notify titled `<tab> — <title>`, the body cut to 300 characters. A flood is held to a
// few a tab and a few more a desk every ten seconds, and the same message is said once in thirty;
// the next one that goes out says how many were held back. A tab nobody looks at counts its unread
// notices, and the desk's click (desk.notify.open) names the notification, so the tab it came from.
import { BODY_MAX, kitty, osc9, osc777, shellMark, truncate } from "./osc.js";

/**
 * @typedef {import("./osc.js").Note} Note
 * @typedef {import("./osc.js").Mark} Mark
 * @typedef {import("./shell.js").Settings} Settings
 * @typedef {"info" | "success" | "warning" | "error"} Level
 * @typedef {{
 *   bridge: { call(method: "ui.notify", params: object): Promise<{ notificationId: string }> },
 *   view: { flash(id: string): void, badge(id: string, count: number): void },
 *   title(id: string): string,
 *   looking(id: string): boolean,
 *   now(): number,
 *   settings(): Settings,
 * }} Deps
 */

const NOTIFY = Object.freeze({ permission: "ui:notify" });
/** The rate limit: so many a tab, and a desk, in a window of this many ms. */
export const WINDOW_MS = 10_000;
export const PER_TAB = 5;
export const PER_DESK = 10;
/** The same tab, title and body within this many ms is said once. */
export const SAME_MS = 30_000;
/** How many notifications are remembered for the desk's click. */
const REMEMBERED = 200;

/** A duration as people read it: 12 s, 1 min 15 s, 2 h 5 min. */
export function duration(/** @type {number} */ ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 ? `${m} min ${s % 60} s` : `${m} min`;
  return m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${Math.floor(m / 60)} h`;
}

/** @param {Deps} deps */
export function createNotices(deps) {
  const { bridge, view } = deps;
  /** @type {Map<string, number>} */
  const unread = new Map();
  /** Per tab, when its notifications went out; and the desk's. @type {Map<string, number[]>} */
  const sent = new Map();
  let desk = /** @type {number[]} */ ([]);
  /** When each tab, title and body was last said. @type {Map<string, number>} */
  const said = new Map();
  /** @type {Map<string, number>} */
  const held = new Map();
  /** notificationId -> the tab it came from. @type {Map<string, string>} */
  const from = new Map();
  /** @type {Map<string, ReturnType<typeof kitty>>} */
  const kitties = new Map();
  /** @type {Map<string, number>} */
  const started = new Map();
  /** @type {Map<string, string>} */
  const commandLines = new Map();

  const badge = (/** @type {string} */ id) => view.badge(id, unread.get(id) ?? 0);

  /** @param {string} id @param {{ title?: string, body?: string, level?: Level }} note */
  const notify = (id, { title = "", body = "", level = "info" }) => {
    const tab = deps.title(id);
    const heading = title ? `${tab} — ${title}` : tab;
    const text = truncate(body);
    const at = deps.now();
    for (const [key, when] of said) if (at - when >= SAME_MS) said.delete(key);
    const key = `${id}\n${heading}\n${text}`;
    if (said.has(key)) return;
    said.set(key, at);
    if (!deps.looking(id)) {
      unread.set(id, (unread.get(id) ?? 0) + 1);
      badge(id);
    }
    const mine = (sent.get(id) ?? []).filter((when) => at - when < WINDOW_MS);
    desk = desk.filter((when) => at - when < WINDOW_MS);
    sent.set(id, mine);
    if (mine.length >= PER_TAB || desk.length >= PER_DESK) {
      held.set(id, (held.get(id) ?? 0) + 1);
      return;
    }
    mine.push(at);
    desk.push(at);
    const more = held.get(id) ?? 0;
    held.delete(id);
    const suffix = more > 0 ? ` (and ${more} more held back)` : "";
    const params = {
      title: heading,
      body: suffix ? `${truncate(text, BODY_MAX - suffix.length)}${suffix}` : text,
      level,
      scope: NOTIFY,
    };
    bridge.call("ui.notify", params).then(
      ({ notificationId }) => {
        from.set(notificationId, id);
        if (from.size > REMEMBERED) from.delete(/** @type {string} */ (from.keys().next().value));
      },
      () => {},
    );
  };

  /** A program's own notification; kitty's `o=unfocused` ones only when nobody looks. */
  const program = (/** @type {string} */ id, /** @type {Note | null} */ note) => {
    if (!note || !deps.settings().programNotify) return;
    if (note.unfocused && deps.looking(id)) return;
    notify(id, note);
  };

  const api = {
    /** An OSC sequence: a notification (9, 777, 99) or one of the shell's marks (133, 633). */
    osc(/** @type {string} */ id, /** @type {number} */ code, /** @type {string} */ data) {
      if (code === 9) {
        const nine = osc9(data);
        if (nine && "note" in nine) program(id, nine.note);
      } else if (code === 777) program(id, osc777(data));
      else if (code === 99) {
        const assembler = kitties.get(id) ?? kitty();
        kitties.set(id, assembler);
        program(id, assembler.feed(data));
      } else if (code === 133 || code === 633) api.mark(id, shellMark(data));
    },

    /** The bell: a visual bell on the tab in view, a notification from one out of sight. */
    bell(/** @type {string} */ id) {
      if (deps.settings().bell !== "notify") return;
      if (deps.looking(id)) view.flash(id);
      else notify(id, { body: "The program rang the bell." });
    },

    /** The shell's marks: a command that ran longer than the setting, out of sight, says so. */
    mark(/** @type {string} */ id, /** @type {Mark | null} */ mark) {
      if (!mark) return;
      if (mark.mark === "C") started.set(id, deps.now());
      if (mark.mark === "E" && mark.command) commandLines.set(id, mark.command);
      if (mark.mark !== "D") return;
      const start = started.get(id);
      const command = commandLines.get(id) ?? "A command";
      started.delete(id);
      commandLines.delete(id);
      const after = deps.settings().notifyAfter;
      if (start === undefined || after <= 0 || deps.looking(id)) return;
      const took = deps.now() - start;
      if (took < after * 1000) return;
      const failed = mark.exit !== undefined && mark.exit !== 0;
      notify(id, {
        body: failed
          ? `${command} failed with exit code ${mark.exit} after ${duration(took)}.`
          : `${command} finished after ${duration(took)}.`,
        level: failed ? "warning" : "success",
      });
    },

    /** A program ended on its own; an error out of sight is a notification. */
    exited(/** @type {string} */ id, /** @type {{ code?: number, signal?: string }} */ exit) {
      const error = exit.signal !== undefined ? exit.signal !== "hup" : (exit.code ?? 0) !== 0;
      if (!error || deps.looking(id)) return;
      const body =
        exit.signal !== undefined
          ? `Ended by signal ${exit.signal}.`
          : `Exited with code ${exit.code}.`;
      notify(id, { body, level: "warning" });
    },

    /** The tab a notification came from, if it is still remembered. */
    open: (/** @type {unknown} */ notificationId) =>
      typeof notificationId === "string" ? from.get(notificationId) : undefined,

    /** The person looks at the tab: its unread notices are read. */
    seen(/** @type {string} */ id) {
      if (!unread.get(id)) return;
      unread.delete(id);
      badge(id);
    },

    unread: (/** @type {string} */ id) => unread.get(id) ?? 0,

    forget(/** @type {string} */ id) {
      for (const map of [unread, sent, held, kitties, started, commandLines]) map.delete(id);
      for (const [notification, tab] of from) if (tab === id) from.delete(notification);
    },
  };
  return api;
}
