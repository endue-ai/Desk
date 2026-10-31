// Writing mail without the DOM: addresses as people type them (RFC 5322 mailbox lists, the common
// forms), the draft a reply, a reply to all or a forward starts from, the quoted text, the Re: and
// Fwd: subjects, and the checks before a send. Pure functions, so the tests run them in Node.

/**
 * @typedef {import("./model.js").Message} Message
 * @typedef {{ name?: string, email?: string }} PersonRef
 * @typedef {{
 *   id: string, account?: string, to: string, cc: string, bcc: string, subject: string, body: string,
 *   inReplyTo?: string, references?: string[], replyTo?: { source: Message["source"], id: string },
 *   calendar?: { method: string, ics: string }, savedAt: string,
 * }} Draft
 * A draft as the composer holds it and the store keeps it: addresses as text, the way they were typed.
 */

const EMAIL = /^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/;

/**
 * Split an address line on the commas and semicolons outside quotes and angle brackets.
 * @param {string} line
 */
function splitAddresses(line) {
  /** @type {string[]} */
  const parts = [];
  let current = "";
  let quoted = false;
  let depth = 0;
  for (const c of line) {
    if (c === '"') quoted = !quoted;
    else if (!quoted && c === "<") depth++;
    else if (!quoted && c === ">") depth = Math.max(0, depth - 1);
    if ((c === "," || c === ";") && !quoted && depth === 0) {
      parts.push(current);
      current = "";
    } else current += c;
  }
  parts.push(current);
  return parts.map((p) => p.trim()).filter(Boolean);
}

/**
 * Read one address: `Mina <mina@example.com>`, `"Park, Jun" <jun@example.com>`,
 * `mina@example.com` or `<mina@example.com>`. Undefined when it is not an address.
 * @param {string} text
 * @returns {PersonRef | undefined}
 */
export function parseAddress(text) {
  const t = text.trim();
  const angled = /^(.*?)\s*<([^<>\s]+)>$/.exec(t);
  if (angled) {
    const email = (angled[2] ?? "").toLowerCase();
    if (!EMAIL.test(email)) return undefined;
    const name = (angled[1] ?? "")
      .trim()
      .replace(/^"(.*)"$/, "$1")
      .replace(/\\(["\\])/g, "$1");
    return name ? { name, email } : { email };
  }
  return EMAIL.test(t) ? { email: t.toLowerCase() } : undefined;
}

/**
 * Read a line of addresses. Every part is an address or lands in `invalid`.
 * @param {string} line
 * @returns {{ people: PersonRef[], invalid: string[] }}
 */
export function parseAddresses(line) {
  /** @type {PersonRef[]} */
  const people = [];
  /** @type {string[]} */
  const invalid = [];
  for (const part of splitAddresses(line)) {
    const person = parseAddress(part);
    if (!person) invalid.push(part);
    else if (!people.some((p) => p.email === person.email)) people.push(person);
  }
  return { people, invalid };
}

/** Write one address the way it is read back: `Mina <mina@example.com>`. @param {PersonRef} p */
export function formatAddress(p) {
  const name = p.name?.trim();
  if (!p.email) return name ?? "";
  if (!name) return p.email;
  return /[,;<>"]/.test(name)
    ? `"${name.replace(/["\\]/g, "\\$&")}" <${p.email}>`
    : `${name} <${p.email}>`;
}

export const formatAddresses = (/** @type {PersonRef[]} */ people) =>
  people.map(formatAddress).join(", ");

/**
 * A subject with one prefix: "Re: x" stays "Re: x"; "RE: x", "Fwd: x" and "FW: x" are recognised.
 * @param {"Re" | "Fwd"} prefix
 * @param {string} subject
 */
export function prefixed(prefix, subject) {
  const trimmed = subject.trim();
  const own = prefix === "Re" ? /^re\s*:\s*/i : /^(fwd?|wg)\s*:\s*/i;
  if (own.test(trimmed)) return `${prefix}: ${trimmed.replace(own, "")}`;
  return `${prefix}: ${trimmed || "(No subject)"}`;
}

/** Every line of a text with "> " in front; already quoted lines gain another ">". */
export const quoted = (/** @type {string} */ text) =>
  text
    .replace(/\s+$/, "")
    .split("\n")
    .map((line) => (line.startsWith(">") ? `>${line}` : `> ${line}`))
    .join("\n");

const fresh = () => `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const mine = (/** @type {string[]} */ addresses) =>
  new Set(addresses.map((a) => a.trim().toLowerCase()).filter(Boolean));
const without = (/** @type {PersonRef[]} */ people, /** @type {Set<string>} */ drop) =>
  people.filter((p) => !p.email || !drop.has(p.email.toLowerCase()));
const dedupe = (/** @type {PersonRef[]} */ people) => {
  /** @type {PersonRef[]} */
  const out = [];
  for (const p of people) if (!out.some((o) => o.email && o.email === p.email)) out.push(p);
  return out;
};

/**
 * The In-Reply-To and References a reply carries (RFC 5322 §3.6.4), when the original has an id.
 * @param {Message} message
 */
export function threading(message) {
  if (!message.messageId) return {};
  const references = [...message.references, message.messageId].slice(-20);
  return { inReplyTo: message.messageId, references };
}

/**
 * The draft of a reply: to the sender (or to everyone but the person, with `all`), the Re: subject,
 * the original quoted under an attribution line, and the threading headers.
 * @param {Message} message
 * @param {{ all?: boolean, addresses?: string[], signature?: string, now?: string }} options
 * `addresses` are the person's own, left out of a reply to all.
 * @returns {Draft}
 */
export function replyDraft(message, options = {}) {
  const me = mine(options.addresses ?? []);
  const sender = message.from;
  let to = [sender];
  /** @type {PersonRef[]} */
  let cc = [];
  if (options.all) {
    to = dedupe(without([sender, ...message.to], me));
    cc = dedupe(without(message.cc, me)).filter((p) => !to.some((t) => t.email === p.email));
    if (to.length === 0) to = [sender];
  }
  const from = sender.name
    ? `${sender.name} <${sender.email ?? ""}>`.replace(" <>", "")
    : sender.email;
  const body = `\n\n${options.signature ? `${options.signature}\n\n` : ""}On ${message.receivedAt}, ${from ?? "someone"} wrote:\n${quoted(message.body)}\n`;
  return {
    id: fresh(),
    account: `${message.source.connector}/${message.source.instance}`,
    to: formatAddresses(to),
    cc: formatAddresses(cc),
    bcc: "",
    subject: prefixed("Re", message.title),
    body,
    ...threading(message),
    replyTo: { source: message.source, id: message.id },
    savedAt: options.now ?? new Date().toISOString(),
  };
}

/**
 * The draft of a forward: no recipient yet, the Fwd: subject, the original under a header block.
 * @param {Message} message
 * @param {{ signature?: string, now?: string }} options
 * @returns {Draft}
 */
export function forwardDraft(message, options = {}) {
  const header = [
    "---------- Forwarded message ----------",
    `From: ${formatAddress(message.from)}`,
    `Date: ${message.receivedAt}`,
    `Subject: ${message.title}`,
    `To: ${formatAddresses(message.to)}`,
    ...(message.cc.length ? [`Cc: ${formatAddresses(message.cc)}`] : []),
  ].join("\n");
  const body = `\n\n${options.signature ? `${options.signature}\n\n` : ""}${header}\n\n${message.body}\n`;
  return {
    id: fresh(),
    account: `${message.source.connector}/${message.source.instance}`,
    to: "",
    cc: "",
    bcc: "",
    subject: prefixed("Fwd", message.title),
    body,
    ...(message.messageId ? { references: [...message.references, message.messageId] } : {}),
    savedAt: options.now ?? new Date().toISOString(),
  };
}

/**
 * An empty draft, or one started from a command's arguments.
 * @param {{ to?: string, cc?: string, bcc?: string, subject?: string, body?: string,
 *   account?: string, signature?: string, now?: string }} given
 * @returns {Draft}
 */
export function newDraft(given = {}) {
  const signature = given.signature ? `\n\n${given.signature}` : "";
  return {
    id: fresh(),
    ...(given.account ? { account: given.account } : {}),
    to: given.to ?? "",
    cc: given.cc ?? "",
    bcc: given.bcc ?? "",
    subject: given.subject ?? "",
    body: `${given.body ?? ""}${signature}`,
    savedAt: given.now ?? new Date().toISOString(),
  };
}

/**
 * What stops a draft from being sent, in words; an empty list means it can go.
 * @param {Draft} draft
 */
export function problemsOf(draft) {
  /** @type {string[]} */
  const problems = [];
  const to = parseAddresses(draft.to);
  const cc = parseAddresses(draft.cc);
  const bcc = parseAddresses(draft.bcc);
  if (!draft.account) problems.push("Choose the account to send from.");
  if (to.people.length + cc.people.length + bcc.people.length === 0)
    problems.push("Add at least one recipient.");
  for (const bad of [...to.invalid, ...cc.invalid, ...bcc.invalid])
    problems.push(`${bad} is not an email address.`);
  return problems;
}

/**
 * The arguments of the connector's send command for a draft: people as `{ name, email }`, the
 * subject, the body, the threading headers and the calendar part when the draft answers an
 * invitation. `instance` names the account the connector sends from.
 * @param {Draft} draft
 */
export function sendArgs(draft) {
  const [, instance = "default"] = (draft.account ?? "").split("/");
  const list = (/** @type {string} */ line) => parseAddresses(line).people;
  const cc = list(draft.cc);
  const bcc = list(draft.bcc);
  return {
    instance,
    to: list(draft.to),
    ...(cc.length ? { cc } : {}),
    ...(bcc.length ? { bcc } : {}),
    subject: draft.subject.trim() || "(No subject)",
    body: draft.body,
    ...(draft.inReplyTo ? { inReplyTo: draft.inReplyTo } : {}),
    ...(draft.references?.length ? { references: draft.references } : {}),
    ...(draft.replyTo ? { replyTo: draft.replyTo } : {}),
    ...(draft.calendar ? { calendar: draft.calendar } : {}),
  };
}
