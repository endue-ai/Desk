// What the chat plugin holds while it runs, in one place the other modules share: the accounts and
// what each connector can do, the messages read for the navigation and counts, the layout and its
// filters, the conversation, thread, Timeline and columns on screen, the drafts, the messages being
// sent, the saved ones and the settings in force. Plain data; chat.js owns the flow.

/**
 * @typedef {import("./model.js").ChatMessage} ChatMessage
 * @typedef {import("./model.js").Conversation} Conversation
 * @typedef {import("./query.js").FilterId} FilterId
 * @typedef {import("./query.js").LayoutId} LayoutId
 * @typedef {import("./timeline.js").PendingState} PendingState
 * @typedef {"send" | "react" | "read" | "edit" | "delete"} Action
 * @typedef {{ messages: ChatMessage[], cursor?: string, loading: boolean, firstUnread: string | null }} Stream
 * One conversation's loaded messages (replies included) and the page after them.
 * @typedef {{ root: ChatMessage, replies: ChatMessage[], loading: boolean }} Thread
 * @typedef {{ key: string, target: string, message: ChatMessage, state: PendingState, error?: string,
 *   text: string, sentAt: number }} Sending
 * A message the person sent that the index does not hold yet; `target` is a composer target.
 * @typedef {{ key: string, target: string, text: string }} Editing
 * The person's own message being edited in the composer of `target`.
 * @typedef {{ page: number, notify: string, markRead: string, enterSends: boolean, density: string,
 *   quick: string[] }} Conf
 * @typedef {{
 *   accounts: string[], installed: string[], available: Map<string, Set<Action>>,
 *   recent: Map<string, ChatMessage>, unread: Map<string, ChatMessage>,
 *   conversations: Conversation[], byKey: Map<string, Conversation>,
 *   layout: LayoutId, filter: FilterId, platform: string | null, search: string,
 *   current: string | null, open: Stream | null, thread: Thread | null, selected: string | null,
 *   timeline: Stream, columns: Map<string, Stream>, pinned: string[],
 *   saved: string[], drafts: Record<string, string>, revs: Record<string, number>,
 *   editing: Editing | null, sending: Sending[], conf: Conf, startedAt: number, ready: boolean,
 * }} State
 * `installed` names the installed connectors that bring messages, connected or not.
 * `revs` counts the times the plugin itself changed a draft (sent, edited), so a composer knows to
 * take the new text and leaves the person's typing alone otherwise.
 */

/** The defaults of plugin.json's contributes.settings, for a core that has none set. */
export const DEFAULTS = {
  page: 100,
  notify: "mentions",
  "mark-read": "open",
  "enter-sends": true,
  density: "comfortable",
  "quick-reactions": /** @type {string[]} */ ([]),
};
export const NOTIFY = ["mentions", "all", "none"];
export const DENSITIES = ["comfortable", "compact"];
/** How many saved messages the plugin keeps and reads. */
export const SAVED_MAX = 100;

/** An empty stream. @returns {Stream} */
export const emptyStream = () => ({ messages: [], loading: false, firstUnread: null });

/** @returns {State} */
export function initialState(now = Date.now()) {
  return {
    accounts: [],
    installed: [],
    available: new Map(),
    recent: new Map(),
    unread: new Map(),
    conversations: [],
    byKey: new Map(),
    layout: "conversation",
    filter: "all",
    platform: null,
    search: "",
    current: null,
    open: null,
    thread: null,
    selected: null,
    timeline: emptyStream(),
    columns: new Map(),
    pinned: [],
    saved: [],
    drafts: {},
    revs: {},
    editing: null,
    sending: [],
    conf: {
      page: DEFAULTS.page,
      notify: DEFAULTS.notify,
      markRead: DEFAULTS["mark-read"],
      enterSends: DEFAULTS["enter-sends"],
      density: DEFAULTS.density,
      quick: [],
    },
    startedAt: now,
    ready: false,
  };
}

export const asString = (/** @type {unknown} */ value) =>
  typeof value === "string" && value !== "" ? value : undefined;
export const asArgs = (/** @type {unknown} */ value) =>
  /** @type {Record<string, unknown>} */ (value && typeof value === "object" ? value : {});
export const asStrings = (/** @type {unknown} */ value) =>
  Array.isArray(value) ? value.filter((v) => typeof v === "string" && v !== "") : [];
/** A page size between 1 and 500, else the default. */
export const pageOf = (/** @type {unknown} */ value) =>
  Number.isInteger(value) && Number(value) > 0 && Number(value) <= 500
    ? Number(value)
    : DEFAULTS.page;

/** The composer target of a conversation, and of a thread (its root's key). */
export const conversationTarget = (/** @type {string} */ key) => `conversation:${key}`;
export const threadTarget = (/** @type {string} */ rootKey) => `thread:${rootKey}`;
