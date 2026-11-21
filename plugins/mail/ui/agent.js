// What an agent reads and sends through the mail plugin (ADR 0088): messages found by words, one
// message with its thread, and a message sent straight from the account. Each reads the index and
// leaves the screen as it is, like endue.mail.latest; a message is named by the `{ source, id }` the
// answers carry. send-message never touches the composer, so a draft the person is writing stays
// theirs; it is irreversible in the manifest, so the desk asks the person before each one (ADR 0078).
import { newDraft, problemsOf, replyDraft, sendArgs } from "./compose.js";
import { latestOf, MAX_LATEST } from "./latest.js";
import { mailboxOf, queryFor, threadQuery } from "./model.js";
import { asString } from "./state.js";

/**
 * @typedef {import("@endue-ai/bridge").MessageItem} MessageItem
 * @typedef {import("./model.js").Message} Message
 * @typedef {import("@endue-ai/bridge").PersonRef} PersonRef
 */

/** The longest body a read answers, in characters; a longer one is cut and says so. */
export const BODY_MAX = 20000;

const who = (/** @type {PersonRef} */ p) => ({ name: p.name ?? null, email: p.email ?? null });
const limitOf = (/** @type {unknown} */ value, /** @type {number} */ usual) => {
  const asked = Number(value);
  return Number.isInteger(asked) && asked > 0 ? Math.min(asked, MAX_LATEST) : usual;
};

/** A message as an agent reads it: who, when, the whole body (to BODY_MAX) and what it carries. */
export function messageAnswer(/** @type {Message} */ m) {
  return {
    source: m.source,
    id: m.id,
    thread: m.thread,
    subject: m.title,
    from: who(m.from),
    to: m.to.map(who),
    cc: m.cc.map(who),
    receivedAt: m.receivedAt,
    mailbox: m.mailbox,
    unread: m.unread,
    flagged: m.flagged,
    body: m.body.length > BODY_MAX ? m.body.slice(0, BODY_MAX) : m.body,
    truncated: m.body.length > BODY_MAX,
    attachments: m.attachments.map((a) => ({ name: a.name, mime: a.mime ?? null })),
    invitation: Boolean(m.calendar),
  };
}

/**
 * @param {(name: string, handler: (a: Record<string, unknown>) => unknown) => void} answer
 * @param {{ actions: { query(q: import("@endue-ai/bridge").ItemQuery): Promise<{ items: unknown[] }>,
 *   accounts(): Promise<string[]>,
 *   run(connector: string, action: string, args: Record<string, unknown>): Promise<unknown> },
 *   named(a: Record<string, unknown>): Promise<Message>, messageOf(item: MessageItem): Message,
 *   account(): string | undefined, conf(): { signature: string, addresses: string[] },
 *   say(text: string): void, now(): number }} deps
 */
export function answerAgents(answer, deps) {
  const { actions } = deps;
  const messages = async (/** @type {import("@endue-ai/bridge").ItemQuery} */ query) =>
    /** @type {MessageItem[]} */ (
      (await actions.query(query)).items.filter(
        (i) => /** @type {{ kind?: string }} */ (i).kind === "message",
      )
    );

  answer("endue.mail.find", async (a) => {
    const text = asString(a.text)?.trim();
    if (!text) throw new Error("Say which words to find: text is empty.");
    const box = mailboxOf(asString(a.mailbox) ?? "inbox");
    if (!box) throw new Error(`${String(a.mailbox)} is not a mailbox.`);
    const found = await messages(queryFor(box, { text, page: limitOf(a.limit, 10) }));
    const { messages: briefs } = latestOf(box, found);
    const text_ = briefs.length
      ? `${briefs.length} found in ${box.title} for "${text}".`
      : `Nothing in ${box.title} holds "${text}".`;
    return { mailbox: box.id, text: text_, messages: briefs };
  });

  answer("endue.mail.read", async (a) => {
    const message = await deps.named(a);
    const account = `${message.source.connector}/${message.source.instance}`;
    const thread =
      a.thread === false
        ? []
        : await messages(threadQuery(message.thread, account)).catch(() => []);
    return {
      ...messageAnswer(message),
      threadMessages: thread
        .map(deps.messageOf)
        .filter((m) => m.id !== message.id)
        .map((m) => ({
          source: m.source,
          id: m.id,
          from: who(m.from),
          receivedAt: m.receivedAt,
          snippet: m.snippet,
        })),
    };
  });

  answer("endue.mail.send-message", async (a) => {
    const text = (/** @type {unknown} */ v) => (typeof v === "string" ? v : undefined);
    const now = new Date(deps.now()).toISOString();
    const { signature, addresses } = deps.conf();
    let draft;
    if (a.replyTo !== undefined) {
      const original = await deps.named(/** @type {Record<string, unknown>} */ (a.replyTo));
      const reply = replyDraft(original, { all: a.all === true, addresses, now });
      const typed = text(a.body) ?? "";
      draft = {
        ...reply,
        ...(text(a.to) !== undefined ? { to: /** @type {string} */ (text(a.to)) } : {}),
        ...(text(a.cc) !== undefined ? { cc: /** @type {string} */ (text(a.cc)) } : {}),
        ...(text(a.subject) !== undefined
          ? { subject: /** @type {string} */ (text(a.subject)) }
          : {}),
        body: `${typed}${signature ? `\n\n${signature}` : ""}${reply.body}`,
      };
    } else {
      const account = text(a.account) ?? deps.account();
      draft = newDraft({
        to: text(a.to),
        cc: text(a.cc),
        bcc: text(a.bcc),
        subject: text(a.subject),
        body: text(a.body),
        ...(account ? { account } : {}),
        signature,
        now,
      });
    }
    const problems = problemsOf(draft, await actions.accounts());
    if (problems.length > 0) throw new Error(problems.join(" "));
    const [connector = ""] = (draft.account ?? "").split("/");
    const args = sendArgs(draft);
    await actions.run(connector, "send", args);
    const subject = String(args.subject);
    deps.say(`Sent: ${subject}.`);
    return {
      sent: true,
      account: draft.account,
      to: args.to,
      subject,
      ...(draft.replyTo ? { replyTo: draft.replyTo } : {}),
    };
  });
}
