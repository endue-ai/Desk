// From the state to what the view shows: the navigation with its counts, the rows of the list
// (threads, or the drafts), the reader's model with the invitation card, and the words for an empty
// mailbox. Pure functions over state.js.
import { MAILBOXES, mailboxOf } from "./model.js";
import { invitationView } from "./writing.js";

/**
 * @typedef {import("./state.js").State} State
 * @typedef {import("./model.js").Message} Message
 * @typedef {import("./model.js").MailboxId} MailboxId
 * @typedef {import("./model.js").Thread} Thread
 * @typedef {import("./compose.js").Draft} Draft
 * @typedef {import("./actions.js").Action} Action
 * @typedef {import("./writing.js").InvitationView} InvitationView
 * @typedef {{ id: string, title: string, people: string, time: string, snippet: string,
 *   unread: number, flagged: boolean, count: number, draft: boolean, attachments: boolean,
 *   invitation: boolean }} Row
 * One row of the list: a thread, or a draft (`draft:<id>`).
 * @typedef {{ message: Message, earlier: Message[], actions: Action[], invitation?: InvitationView }} ReaderModel
 * @typedef {{ mailboxes: Array<{ id: MailboxId, title: string, count?: string }>, current: MailboxId,
 *   accounts: string[], account: string | null, search: string }} Nav
 */

/** @param {Thread} thread @returns {Row} */
export const rowOf = (thread) => ({
  id: thread.id,
  title: thread.latest.title,
  people: thread.people.join(", "),
  time: thread.latest.receivedAt,
  snippet: thread.latest.snippet,
  unread: thread.unread,
  flagged: thread.flagged,
  count: thread.messages.length,
  draft: false,
  attachments: thread.messages.some((m) => m.attachments.length > 0),
  invitation: thread.messages.some((m) => m.calendar !== undefined),
});

/** @param {Draft} draft @returns {Row} */
export const draftRow = (draft) => ({
  id: `draft:${draft.id}`,
  title: draft.subject.trim() || "(No subject)",
  people: draft.to.trim() || "(No recipient)",
  time: draft.savedAt,
  snippet: draft.body.trim().split("\n")[0] ?? "",
  unread: 0,
  flagged: false,
  count: 1,
  draft: true,
  attachments: false,
  invitation: draft.calendar !== undefined,
});

/** The rows of the mailbox on screen: its threads, or the drafts newest first. @param {State} s */
export const rowsOf = (s) =>
  s.mailboxId === "drafts"
    ? [...s.drafts].sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1)).map(draftRow)
    : s.threads.map(rowOf);

/** @param {State} s @returns {Nav} */
export const navOf = (s) => ({
  mailboxes: MAILBOXES.map((box) => ({
    id: box.id,
    title: box.title,
    ...(box.id === "inbox" && s.unread ? { count: s.unread } : {}),
    ...(box.id === "drafts" && s.drafts.length ? { count: String(s.drafts.length) } : {}),
  })),
  current: s.mailboxId,
  accounts: s.accounts,
  account: s.account,
  search: s.search,
});

/** The sentence an empty list shows. @param {State} s */
export function emptyText(s) {
  const box = mailboxOf(s.mailboxId) ?? MAILBOXES[0];
  if (s.accounts.length === 0 && box.live)
    return "No mail account is connected yet. Connect one and its messages show here.";
  if (s.search) return `Nothing matches "${s.search}" in ${box.title}.`;
  return `Nothing in ${box.title}.`;
}

/** The answer the person gave the open message's invitation here, if any. @param {State} s */
export function answerFor(s, /** @type {Message} */ message) {
  const found = Object.entries(s.answers).find(([key]) => key.startsWith(`${message.key}#`));
  return found?.[1];
}

/** @param {State} s @param {() => number} now @returns {ReaderModel | null} */
export function readerOf(s, now) {
  if (!s.open) return null;
  const invitation = s.open.calendar
    ? invitationView(s.open, s.conf.addresses, answerFor(s, s.open), { now: now() })
    : undefined;
  return {
    message: s.open,
    earlier: s.earlier,
    actions: s.available,
    ...(invitation ? { invitation } : {}),
  };
}
