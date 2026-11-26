// The tabs PG-25 adds to a console's results (ADR 0358): while a run goes on, a Messages tab of the
// notices it has heard so far; and a Notifications tab, a result of what the console's session
// heard after LISTEN (when, channel, payload, the sender's process id), with a badge of the unseen
// ones and a note that names the channels, what was dropped and what stopped. Being a result, it
// is filtered, sorted, copied and exported as one. Pure.

import { formatCount } from "../format.js";
import { t as messageText } from "../strings/index.js";

/**
 * @typedef {import("../tabs.js").Shown} Shown
 * @typedef {import("../tabs.js").Tab} Tab
 * @typedef {ReturnType<ReturnType<typeof import("./listen.js").createListening>["model"]>} Listened
 */

export const COLUMNS = ["received", "channel", "payload", "pid"];
const pad = (/** @type {number} */ n, size = 2) => String(n).padStart(size, "0");

/** A time as the result shows it: the local date and time to the millisecond. */
export const timeOf = (/** @type {number} */ at) => {
  const d = new Date(at);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
};

/** Why an agent's run that LISTENs does not run. */
export const AGENT_LISTEN = messageText("session.listenTabs.notRunListenAndUnlistenAre");

/** What the status line adds when a listening session ends. */
export const stoppedLine = (/** @type {string[]} */ channels) =>
  channels.length
    ? messageText("session.listenTabs.itStoppedListeningOnListenAgain", {
        value: String(channels.join(", ")),
      })
    : "";

/** A run's Messages while it goes on: the notices heard so far. @returns {Shown} */
export function liveShown(/** @type {{ lines: string[], dropped: number }} */ run) {
  const lines = run.lines.map((text) => ({
    level: /** @type {const} */ ("notice"),
    text,
    statement: -1,
  }));
  if (run.dropped)
    lines.unshift({
      level: "notice",
      text: messageText("session.listenTabs.earlierLineLeftOutWhileIt", {
        value: String(formatCount(run.dropped)),
        value2: String(run.dropped === 1 ? "" : messageText("session.listenTabs.s")),
      }),
      statement: -1,
    });
  return {
    tabs: [
      { label: messageText("session.listenTabs.messages"), kind: "messages", statement: -1, lines },
    ],
    open: 0,
    summary: messageText("session.listenTabs.running"),
  };
}

/** What the Notifications tab's note says. */
export function noteOf(/** @type {NonNullable<Listened>} */ l) {
  const parts = [];
  const names = (/** @type {string[]} */ c) => c.join(", ");
  if (l.channels.length)
    parts.push(messageText("session.listenTabs.listeningOn", { value: String(names(l.channels)) }));
  else if (l.stopped.length)
    parts.push(
      messageText("session.listenTabs.stoppedListeningOnTheSessionEnded", {
        value: String(names(l.stopped)),
      }),
    );
  else parts.push(messageText("session.listenTabs.notListening"));
  if (l.dropped)
    parts.push(
      messageText("session.listenTabs.keepsTheLatestOlderDropped", {
        value: String(formatCount(l.heard.length)),
        value2: String(formatCount(l.dropped)),
      }),
    );
  return parts.join(" ");
}

/** The Notifications tab. @returns {Tab & { note: string, stopped: boolean }} */
export function notificationsTab(/** @type {NonNullable<Listened>} */ l) {
  return {
    label: l.unseen
      ? messageText("session.listenTabs.notificationsNew", { value: String(formatCount(l.unseen)) })
      : messageText("session.listenTabs.notifications"),
    kind: "notifications",
    statement: -1,
    set: {
      columns: COLUMNS,
      rows: l.heard.map((n) => [timeOf(n.at), n.channel, n.payload, String(n.pid)]),
      truncated: false,
    },
    note: noteOf(l),
    stopped: !l.channels.length && l.stopped.length > 0,
  };
}

/**
 * A console's results with its Notifications tab last, the tab on screen kept; without one when
 * it has nothing to show.
 * @param {Shown | null} shown @param {number} on the tab on screen @param {Listened} l
 * @returns {{ shown: Shown | null, tab: number }}
 */
export function withNotifications(shown, on, l) {
  const was = shown?.tabs[on]?.kind === "notifications";
  const tabs = (shown?.tabs ?? []).filter((t) => t.kind !== "notifications");
  if (l) tabs.push(notificationsTab(l));
  if (!tabs.length) return { shown: null, tab: 0 };
  const next = shown ? { ...shown, tabs } : { tabs, open: 0, summary: "" };
  const tab = was && l ? tabs.length - 1 : Math.min(on, tabs.length - 1);
  return { shown: next, tab };
}
