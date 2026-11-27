// How a lost PostgreSQL session comes back (PG-105, ADR 0355). A console's session lost while idle,
// to the server ending it, the network or a sleep, is opened again on its own: the first try after
// a second, each next one twice as late, at most 30 s apart, eight tries in all. Each try is the
// plugin's own background work: tried only while the plugin holds the server's grant (so it asks
// nothing), refused on a disconnected connection, and a sign-in the server refuses stops the tries.
// Any other lost session (in a transaction, a table view's, a revoked grant, the plugin stopping)
// waits for the person: Reconnect, or the next run. A try opens a session and runs nothing of the
// person's: nothing is ever run again. No DOM.

import { connectedLine, GAVE_UP, retryDetail } from "./lost-words.js";

/**
 * @typedef {import("./words.js").Gone} Gone
 * @typedef {import("./words.js").SessionModel} SessionModel
 * @typedef {import("./lost-words.js").Retry} Retry
 * @typedef {{ error?: { kind: string, message: string }, notices: string[] }} Attempt
 * @typedef {{
 *   attempt(owner: string, auto: boolean): Promise<Attempt>,
 *   may(owner: string): Promise<boolean>,
 *   lost(owner: string): boolean,
 *   say(owner: string, line: (label: string) => string): void, label(owner: string): string,
 *   onState(owner: string): void,
 *   setTimer(fn: () => void, ms: number): unknown, clearTimer(timer: unknown): void,
 * }} Deps
 *   `attempt` opens the owner's session (`auto`: as background work, else the person's act);
 *   `may` says whether the plugin holds the grant to connect without asking; `lost` whether the
 *   owner's session is still lost.
 * @typedef {Retry & { timer?: unknown }} Tries
 */

/** The waits before each try on its own. */
export const BACKOFF_MS = [1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000];
/** The reasons a session that went outside a transaction comes back on its own. */
const AUTO = new Set(["server", "io", "run", "slept"]);
/** A try's error that no later try would mend. */
const FINAL = new Set(["auth", "refused", "client"]);

/** Whether a lost session is opened again on its own. */
export const automatic = (/** @type {string} */ kind, /** @type {Gone} */ gone) =>
  kind === "console" && gone.transaction === "idle" && AUTO.has(gone.reason ?? "");

/** @param {Deps} deps */
export function createReconnect(deps) {
  /** @type {Map<string, Tries>} */
  const tries = new Map();

  const stop = (/** @type {string} */ owner) => {
    deps.clearTimer(tries.get(owner)?.timer);
    tries.delete(owner);
  };
  const giveUp = (
    /** @type {string} */ owner,
    /** @type {Tries} */ t,
    /** @type {string} */ why,
  ) => {
    t.waiting = false;
    t.gaveUp = why;
    t.timer = undefined;
    deps.onState(owner);
  };
  const schedule = (/** @type {string} */ owner, /** @type {Tries} */ t) => {
    const wait = BACKOFF_MS[t.tries];
    if (wait === undefined) return giveUp(owner, t, GAVE_UP.tries(t.tries));
    t.waiting = true;
    t.timer = deps.setTimer(() => void attempt(owner, t), wait);
  };
  /** One try on its own. */
  const attempt = async (/** @type {string} */ owner, /** @type {Tries} */ t) => {
    if (tries.get(owner) !== t) return;
    t.timer = undefined;
    if (!deps.lost(owner)) return stop(owner);
    if (!(await deps.may(owner))) return giveUp(owner, t, GAVE_UP.ask);
    if (tries.get(owner) !== t) return;
    t.tries++;
    const done = await deps.attempt(owner, true);
    if (tries.get(owner) !== t) return;
    if (!done.error) {
      stop(owner);
      deps.say(owner, (label) => connectedLine(label, t.tries));
      deps.onState(owner);
      return;
    }
    if (FINAL.has(done.error.kind)) return giveUp(owner, t, done.error.message.replace(/\.$/u, ""));
    schedule(owner, t);
    deps.onState(owner);
  };

  return {
    /** A session was lost: tried again on its own when the policy says so, else left to the person. */
    lost(/** @type {string} */ owner, /** @type {string} */ kind, /** @type {Gone} */ gone) {
      stop(owner);
      const auto = automatic(kind, gone);
      /** @type {Tries} */
      const t = { automatic: auto, tries: 0, max: BACKOFF_MS.length, waiting: false };
      tries.set(owner, t);
      if (auto) schedule(owner, t);
      deps.onState(owner);
    },
    /**
     * Reconnect, the person's act: a try now, the one waiting dropped. Resolves with the status
     * line's words, or throws the reason it did not connect.
     * @param {string} owner
     */
    async now(owner) {
      stop(owner);
      const done = await deps.attempt(owner, false);
      deps.onState(owner);
      if (done.error) throw new Error(done.error.message);
      return connectedLine(deps.label(owner), undefined);
    },
    /** An owner that is gone, or whose session is back by a run: its tries stop. */
    stop,
    /**
     * The header's model of a lost session, with its tries and what the person can do.
     * @template {SessionModel} M
     * @param {string} owner @param {M} base
     * @returns {M & { retry?: Retry }}
     */
    model(owner, base) {
      const t = tries.get(owner);
      if (base.state !== "lost" || !t) return base;
      const { timer: _timer, ...retry } = t;
      return { ...base, retry, detail: `${base.detail}${retryDetail(retry)}` };
    },
  };
}
