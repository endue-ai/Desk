// What the plugin's PostgreSQL sessions hear (ADR 0281, 0334, 0358): a session's own notices
// (db.notice, outside any call) gathered in `sinks` for its next run, a running call's notices as
// they come (db.call.notice) for its owner unless the call was already answered (its page carries
// them, and its number says so), what a listening session hears (db.notification) for its owner,
// and db.closed for the keeper and the cursors (PG-22). `answering` wraps the bridge's calls to
// note each answer's call.
// No DOM.

import { noticeOf } from "../engines/pg-result.js";

/**
 * @typedef {Pick<import("@endue-ai/plugin-sdk").PluginBridge, "call" | "onEvent">} Bridge
 * @typedef {{
 *   onRaised?(owner: string, lines: string[]): void,
 *   onNotification?(owner: string, n: { channel: string, payload: string, pid: number }): void,
 * }} Hears
 *   `onRaised` hears a kept session's running call's notice, as its lines; `onNotification` a NOTIFY
 *   its session heard.
 */

/** The bridge's calls, each answer's call number noted in `answered` by session. */
export const answering =
  (/** @type {Bridge} */ bridge, /** @type {Map<string, number>} */ answered) =>
  async (/** @type {string} */ method, /** @type {Record<string, unknown>} */ params) => {
    const answer = await bridge.call(/** @type {never} */ (method), params);
    const pages = Array.isArray(answer?.pages) ? answer.pages : [answer];
    const call = Math.max(0, ...pages.map((/** @type {any} */ p) => Number(p?.call) || 0));
    const id = typeof params.sessionId === "string" ? params.sessionId : "";
    if (id && call > (answered.get(id) ?? 0)) answered.set(id, call);
    return /** @type {any} */ (answer);
  };

/**
 * @param {Bridge} bridge
 * @param {{
 *   own: Set<string>, sinks: Map<string, string[]>, answered: Map<string, number>,
 *   keeper: { closed(data: import("@endue-ai/bridge").DbClosedData): void, ownerOf(id: string): string | undefined },
 *   cursors?: { closed(id: string): void },
 * } & Hears} deps
 */
export function hearEvents(bridge, deps) {
  bridge.onEvent((event) => {
    if (event.event === "db.notice") {
      const id = event.data.sessionId;
      if (!deps.sinks.has(id) && deps.own.has(id)) deps.sinks.set(id, []);
      deps.sinks.get(id)?.push(...noticeOf(event.data.notice));
    }
    if (event.event === "db.call.notice") {
      const { sessionId, call, notice } = event.data;
      const owner = deps.keeper.ownerOf(sessionId);
      if (owner && call > (deps.answered.get(sessionId) ?? 0))
        deps.onRaised?.(owner, noticeOf(notice));
    }
    if (event.event === "db.notification") {
      const { sessionId, channel, payload, pid } = event.data;
      const owner = deps.keeper.ownerOf(sessionId);
      if (owner) deps.onNotification?.(owner, { channel, payload, pid });
    }
    if (event.event === "db.closed") {
      deps.sinks.delete(event.data.sessionId);
      deps.answered.delete(event.data.sessionId);
      deps.cursors?.closed(event.data.sessionId);
      deps.keeper.closed(event.data);
    }
  });
}
