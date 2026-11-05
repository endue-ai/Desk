// endue.mail.latest, the mail plugin's tool for Eris (ADR 0084): the newest messages of a mailbox
// as data the brain reads, with one line for people. It reads the index and leaves the screen as it
// is: asking Eris about mail does not move the person's own place in it.
import { MAILBOXES, mailboxOf, messageOf, queryFor } from "./model.js";
import { asString } from "./state.js";

/**
 * @typedef {import("@endue-ai/bridge").ItemCondition} ItemCondition
 * @typedef {import("@endue-ai/bridge").MessageItem} MessageItem
 * @typedef {{ from: string, subject: string, receivedAt: string, unread: boolean, snippet: string }} Brief
 */

/** The most messages one answer holds. */
export const MAX_LATEST = 20;
const DEFAULT_LATEST = 5;

/**
 * The query for `args` ({ mailbox?, limit?, unread? }) and the mailbox it reads.
 * @param {Record<string, unknown>} args
 */
export function latestQuery(args) {
  const box = mailboxOf(asString(args.mailbox) ?? "inbox");
  if (!box) throw new Error(`${String(args.mailbox)} is not a mailbox.`);
  const asked = Number(args.limit);
  const limit = Number.isInteger(asked) && asked > 0 ? Math.min(asked, MAX_LATEST) : DEFAULT_LATEST;
  const query = queryFor(box, { page: limit });
  /** @type {ItemCondition} */
  const unread = { field: "unread", op: "eq", value: true };
  if (args.unread === true) query.where = [...(query.where ?? []), unread];
  return { box, query };
}

/**
 * The answer: the mailbox, a brief of each message, newest first, and the line people read.
 * @param {{ id: string, title: string }} box
 * @param {MessageItem[]} items
 */
export function latestOf(box, items) {
  /** @type {Brief[]} */
  const messages = items.map(messageOf).map((m) => ({
    from: m.from.name ?? m.from.email ?? "Unknown",
    subject: m.title,
    receivedAt: m.receivedAt,
    unread: m.unread,
    snippet: m.snippet,
  }));
  const unread = messages.filter((m) => m.unread).length;
  const listed = messages.map((m) => `${m.from}: ${m.subject}`).join("; ");
  const count = messages.length === 1 ? "1 message" : `${messages.length} messages`;
  const text = messages.length
    ? `The newest ${count} in ${box.title} (${unread} unread): ${listed}.`
    : `Nothing in ${box.title}.`;
  return { mailbox: box.id, messages, text };
}

/** The args schema the manifest declares, kept here for the tests to compare. */
export const LATEST_ARGS = {
  type: "object",
  properties: {
    mailbox: { enum: MAILBOXES.map((box) => box.id) },
    limit: { type: "integer", minimum: 1, maximum: MAX_LATEST },
    unread: { type: "boolean" },
  },
  additionalProperties: false,
};
