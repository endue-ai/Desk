// The mail plugin's model without its DOM or the bridge: the mailboxes and the item queries that
// fill them, what a message item means (specs/item/v0 kind `message`, plus the raw fields a mail
// connector adds), threads from a page of messages, and where a key moves the selection. Pure
// functions, so the tests run them in Node.

/**
 * @typedef {import("@endue-ai/bridge").MessageItem} MessageItem
 * @typedef {import("@endue-ai/bridge").ItemQuery} ItemQuery
 * @typedef {import("@endue-ai/bridge").ItemCondition} ItemCondition
 * @typedef {import("@endue-ai/bridge").PersonRef} PersonRef
 * @typedef {"inbox" | "unread" | "flagged" | "sent" | "drafts" | "archive" | "trash" | "junk"} MailboxId
 * @typedef {{ id: MailboxId, title: string, where: ItemCondition[], live: boolean }} Mailbox
 * `live` mailboxes are filled from the index; `drafts` holds what the person writes here.
 * @typedef {{ name: string, mime?: string, size?: number }} Attachment
 * @typedef {{
 *   key: string, source: MessageItem["source"], id: string, thread: string, title: string,
 *   from: PersonRef, to: PersonRef[], cc: PersonRef[], receivedAt: string, unread: boolean,
 *   flagged: boolean, mailbox: string, snippet: string, body: string, attachments: Attachment[],
 *   calendar?: string, messageId?: string, inReplyTo?: string, references: string[],
 *   deepLink?: string, item: MessageItem,
 * }} Message
 * A message as the plugin shows it: the item's fields and the raw ones it reads (`raw.mailbox`,
 * `raw.flagged`, `raw.cc`, `raw.attachments`, `raw.calendar`, `raw.messageId`, `raw.inReplyTo`,
 * `raw.references`), each with a default when the connector did not say.
 * @typedef {{ id: string, latest: Message, messages: Message[], unread: number, flagged: boolean,
 *   people: string[] }} Thread
 */

/** The mailbox roles a connector writes in `raw.mailbox`; a message without one is in the inbox. */
export const ROLES = ["inbox", "archive", "sent", "drafts", "trash", "junk"];
const NOT_IN = (/** @type {string[]} */ roles) =>
  roles.map(
    (role) => /** @type {ItemCondition} */ ({ field: "raw.mailbox", op: "ne", value: role }),
  );
const IN = (/** @type {string} */ role) =>
  /** @type {ItemCondition} */ ({ field: "raw.mailbox", op: "eq", value: role });
const UNREAD = /** @type {ItemCondition} */ ({ field: "unread", op: "eq", value: true });
const FLAGGED = /** @type {ItemCondition} */ ({ field: "raw.flagged", op: "eq", value: true });

/** The mailboxes, in the order the navigation shows them. */
export const MAILBOXES = /** @type {Mailbox[]} */ ([
  {
    id: "inbox",
    title: "Inbox",
    where: NOT_IN(["archive", "sent", "drafts", "trash", "junk"]),
    live: true,
  },
  { id: "unread", title: "Unread", where: [UNREAD, ...NOT_IN(["trash", "junk"])], live: true },
  { id: "flagged", title: "Flagged", where: [FLAGGED, ...NOT_IN(["trash"])], live: true },
  { id: "sent", title: "Sent", where: [IN("sent")], live: true },
  { id: "drafts", title: "Drafts", where: [], live: false },
  { id: "archive", title: "Archive", where: [IN("archive")], live: true },
  { id: "trash", title: "Trash", where: [IN("trash")], live: true },
  { id: "junk", title: "Junk", where: [IN("junk")], live: true },
]);

/** @param {string} id */
export const mailboxOf = (id) => MAILBOXES.find((box) => box.id === id);
export const isMailbox = (/** @type {unknown} */ id) =>
  typeof id === "string" && MAILBOXES.some((box) => box.id === id);

/**
 * The query that fills a mailbox: message items, the mailbox's conditions, a full-text search when
 * there is one, one account when one is chosen, newest received first, a page at a time.
 * @param {Mailbox} mailbox
 * @param {{ text?: string, account?: string, page: number, cursor?: string }} options
 * @returns {ItemQuery}
 */
export function queryFor(mailbox, { text, account, page, cursor }) {
  return {
    kinds: ["message"],
    ...(account ? { sources: [account] } : {}),
    ...(text ? { text } : {}),
    where: mailbox.where,
    sort: [{ field: "receivedAt", dir: "desc" }],
    limit: page,
    ...(cursor ? { cursor } : {}),
  };
}

/** The query for the messages of one thread, oldest first. @param {string} thread */
export const threadQuery = (thread, /** @type {string | undefined} */ account) =>
  /** @type {ItemQuery} */ ({
    kinds: ["message"],
    ...(account ? { sources: [account] } : {}),
    where: [{ field: "thread", op: "eq", value: thread }],
    sort: [{ field: "receivedAt", dir: "asc" }],
    limit: 200,
  });

/** The value at a dotted path of an item, or undefined. */
const at = (/** @type {unknown} */ value, /** @type {string} */ path) => {
  let v = value;
  for (const key of path.split(".")) {
    if (v === null || typeof v !== "object") return undefined;
    v = /** @type {Record<string, unknown>} */ (v)[key];
  }
  return v;
};

/**
 * Whether one condition holds for an item, the way the index judges it (specs/item/v0: `ne` holds
 * for a missing field, `eq` never does). Only the operators the mailboxes use.
 * @param {MessageItem} item
 * @param {ItemCondition} condition
 */
function holds(item, { field, op, value }) {
  const actual = at(item, field);
  if (op === "eq") return actual !== undefined && JSON.stringify(actual) === JSON.stringify(value);
  if (op === "ne") return actual === undefined || JSON.stringify(actual) !== JSON.stringify(value);
  return true;
}

/**
 * Whether a message belongs in a mailbox as the person sees it now: the mailbox's conditions, the
 * account filter, and the words of a search in its title, body or snippet.
 * @param {MessageItem} item
 * @param {Mailbox} mailbox
 * @param {{ text?: string, account?: string }} filter
 */
export function inMailbox(item, mailbox, filter = {}) {
  if (item.kind !== "message" || !mailbox.live) return false;
  if (!mailbox.where.every((condition) => holds(item, condition))) return false;
  if (filter.account && sourceKey(item.source) !== filter.account) return false;
  if (!filter.text) return true;
  const haystack = [item.title, item.body, item.snippet]
    .filter((v) => typeof v === "string")
    .join("\n")
    .toLowerCase();
  return filter.text
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

/** `connector/instance`, the source selector of one account. */
export const sourceKey = (/** @type {MessageItem["source"]} */ source) =>
  `${source.connector}/${source.instance}`;
/** The index key of a message: its source and id. */
export const keyOf = (/** @type {MessageItem["source"]} */ source, /** @type {string} */ id) =>
  `${sourceKey(source)}#${id}`;

const EMAIL = /^[^@\s]+@[^@\s]+$/;
/** @param {unknown} value @returns {PersonRef[]} */
function people(value) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((v) => {
    if (typeof v === "string") return EMAIL.test(v) ? [{ email: v }] : [];
    if (!v || typeof v !== "object") return [];
    const { name, email } = /** @type {{ name?: unknown, email?: unknown }} */ (v);
    const person = {
      ...(typeof name === "string" && name ? { name } : {}),
      ...(typeof email === "string" && EMAIL.test(email) ? { email } : {}),
    };
    return Object.keys(person).length ? [person] : [];
  });
}
const strings = (/** @type {unknown} */ value) =>
  Array.isArray(value) ? value.filter((v) => typeof v === "string" && v !== "") : [];
const string = (/** @type {unknown} */ value) =>
  typeof value === "string" && value !== "" ? value : undefined;

/**
 * A message item as the plugin shows it, with the raw fields a mail connector adds read out.
 * @param {MessageItem} item
 * @returns {Message}
 */
export function messageOf(item) {
  const raw = /** @type {Record<string, unknown>} */ (item.raw ?? {});
  const mailbox = string(raw.mailbox) ?? "inbox";
  const attachments = Array.isArray(raw.attachments)
    ? raw.attachments.flatMap((a) => {
        const { name, mime, size } =
          /** @type {{ name?: unknown, mime?: unknown, size?: unknown }} */ (
            a && typeof a === "object" ? a : {}
          );
        if (typeof name !== "string" || name === "") return [];
        return [
          {
            name,
            ...(typeof mime === "string" ? { mime } : {}),
            ...(typeof size === "number" ? { size } : {}),
          },
        ];
      })
    : [];
  const calendar = string(raw.calendar) ?? string(raw.ics);
  const messageId = string(raw.messageId);
  const inReplyTo = string(raw.inReplyTo);
  return {
    key: keyOf(item.source, item.id),
    source: item.source,
    id: item.id,
    thread: item.thread ?? item.id,
    title: item.title.trim() || "(No subject)",
    from: item.from,
    to: item.to ?? [],
    cc: people(raw.cc),
    receivedAt: item.receivedAt,
    unread: item.unread,
    flagged: raw.flagged === true,
    mailbox: ROLES.includes(mailbox) ? mailbox : "inbox",
    snippet: item.snippet ?? (item.body ?? "").split("\n")[0]?.slice(0, 140) ?? "",
    body: item.body ?? "",
    attachments,
    ...(calendar ? { calendar } : {}),
    ...(messageId ? { messageId } : {}),
    ...(inReplyTo ? { inReplyTo } : {}),
    references: strings(raw.references),
    ...(item.deepLink ? { deepLink: item.deepLink } : {}),
    item,
  };
}

/**
 * Threads from the messages on screen: one per `thread`, newest message first within the list, the
 * thread placed where its latest message is. Messages of one thread are newest first too.
 * @param {Message[]} messages newest received first
 * @returns {Thread[]}
 */
export function threadsOf(messages) {
  /** @type {Map<string, Thread>} */
  const threads = new Map();
  for (const message of messages) {
    const key = `${sourceKey(message.source)}#${message.thread}`;
    const thread = threads.get(key);
    if (thread) {
      thread.messages.push(message);
      thread.unread += message.unread ? 1 : 0;
      thread.flagged = thread.flagged || message.flagged;
      const who = message.from.name ?? message.from.email ?? "Unknown";
      if (!thread.people.includes(who)) thread.people.push(who);
    } else {
      threads.set(key, {
        id: key,
        latest: message,
        messages: [message],
        unread: message.unread ? 1 : 0,
        flagged: message.flagged,
        people: [message.from.name ?? message.from.email ?? "Unknown"],
      });
    }
  }
  return [...threads.values()];
}

/**
 * Where a key moves the selection in the list: the next or previous thread, the first or the last.
 * @param {Thread[]} list
 * @param {string | null} selected
 * @param {string} key
 * @returns {string | undefined} the thread to select, or nothing when the key is not the list's
 */
export function move(list, selected, key) {
  if (list.length === 0) return undefined;
  const at = list.findIndex((thread) => thread.id === selected);
  switch (key) {
    case "ArrowDown":
    case "j":
      return (at < 0 ? list[0] : (list[at + 1] ?? list[at]))?.id;
    case "ArrowUp":
    case "k":
      return (at < 0 ? list[0] : (list[at - 1] ?? list[at]))?.id;
    case "Home":
      return list[0]?.id;
    case "End":
      return list[list.length - 1]?.id;
    default:
      return undefined;
  }
}

/**
 * Merge a page of items into the messages on screen: replaced when seen, else appended in
 * received order, newest first.
 * @param {Message[]} shown
 * @param {MessageItem[]} items
 */
export function merged(shown, items) {
  const byKey = new Map(shown.map((m) => [m.key, m]));
  for (const item of items) {
    const message = messageOf(item);
    byKey.set(message.key, message);
  }
  return [...byKey.values()].sort(
    (a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt) || (a.id < b.id ? -1 : 1),
  );
}
