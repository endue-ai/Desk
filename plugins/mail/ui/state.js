// What the mail plugin holds while it runs, in one place the other modules share: the accounts and
// the filter, the page of messages and its threads, the message that is open, the drafts and the
// answers given to invitations, and the settings in force. Plain data; mail.js owns the flow.

/**
 * @typedef {import("./model.js").Message} Message
 * @typedef {import("./model.js").MailboxId} MailboxId
 * @typedef {import("./model.js").Thread} Thread
 * @typedef {import("./compose.js").Draft} Draft
 * @typedef {import("./actions.js").Action} Action
 * @typedef {import("./writing.js").Answer} Answer
 * @typedef {{ notify: boolean, markRead: string, signature: string, addresses: string[] }} Conf
 * @typedef {{
 *   accounts: string[], account: string | null, mailboxId: MailboxId, search: string, page: number,
 *   messages: Message[], cursor: string | undefined, threads: Thread[], selected: string | null,
 *   open: Message | null, earlier: Message[], available: Action[], loading: boolean, unread: string,
 *   drafts: Draft[], answers: Record<string, Answer>, conf: Conf, startedAt: number,
 * }} State
 */

/** The defaults of plugin.json's contributes.settings, for a core that has none set. */
export const DEFAULTS = {
  page: 50,
  notify: true,
  "mark-read": "open",
  signature: "",
  addresses: /** @type {string[]} */ ([]),
};

/** @returns {State} */
export function initialState(now = Date.now()) {
  return {
    accounts: [],
    account: null,
    mailboxId: "inbox",
    search: "",
    page: DEFAULTS.page,
    messages: [],
    cursor: undefined,
    threads: [],
    selected: null,
    open: null,
    earlier: [],
    available: [],
    loading: false,
    unread: "",
    drafts: [],
    answers: {},
    conf: {
      notify: DEFAULTS.notify,
      markRead: DEFAULTS["mark-read"],
      signature: DEFAULTS.signature,
      addresses: [],
    },
    startedAt: now,
  };
}

export const asString = (/** @type {unknown} */ value) =>
  typeof value === "string" && value !== "" ? value : undefined;
export const asArgs = (/** @type {unknown} */ value) =>
  /** @type {Record<string, unknown>} */ (value && typeof value === "object" ? value : {});
export const addressList = (/** @type {unknown} */ value) =>
  Array.isArray(value) ? value.filter((v) => typeof v === "string" && v.includes("@")) : [];
