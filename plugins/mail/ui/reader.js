// The reading pane: who wrote, to whom and when, the subject, the body as text (never HTML), the
// attachments by name, the earlier messages of the thread, the connector's actions as buttons, and
// the invitation card for a text/calendar part with Accept, Tentative and Decline.
import { fullTime, peopleLine, personLine } from "./format.js";

/**
 * @typedef {import("./present.js").ReaderModel} ReaderModel
 * @typedef {import("./writing.js").InvitationView} InvitationView
 * @typedef {{ command(id: string, args?: Record<string, unknown>): unknown, openMessage(key: string): unknown }} Actions
 */

const STATES = /** @type {Record<string, string>} */ ({
  ACCEPTED: "accepted",
  DECLINED: "declined",
  TENTATIVE: "tentative",
  DELEGATED: "delegated",
  "NEEDS-ACTION": "has not answered",
});
const ANSWERS = [
  ["accepted", "Accept", "y"],
  ["tentative", "Maybe", "m"],
  ["declined", "Decline", "n"],
];
const sizeOf = (/** @type {number} */ bytes) =>
  bytes < 1024
    ? `${bytes} B`
    : bytes < 1_048_576
      ? `${(bytes / 1024).toFixed(0)} KB`
      : `${(bytes / 1_048_576).toFixed(1)} MB`;

/**
 * @param {Document} doc
 * @param {HTMLElement} root
 * @param {Actions} actions
 */
export function createReader(doc, root, actions) {
  let canAnswer = false;
  let showing = false;
  const el = (
    /** @type {string} */ tag,
    /** @type {string} */ className,
    /** @type {string} */ text = "",
  ) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  };
  const button = (/** @type {string} */ label, /** @type {() => unknown} */ run, title = "") => {
    const node = doc.createElement("button");
    node.type = "button";
    node.textContent = label;
    if (title) node.title = title;
    node.addEventListener("click", () => void run());
    return node;
  };

  /** @param {InvitationView} invitation */
  const card = (invitation) => {
    const section = el("section", "invitation");
    section.setAttribute("aria-label", "Invitation");
    const kind = invitation.cancelled
      ? "Cancelled"
      : invitation.method === "REPLY"
        ? "Answer to an invitation"
        : invitation.method === "PUBLISH"
          ? "Event"
          : "Invitation";
    section.append(el("h3", "", `${kind}: ${invitation.summary}`));
    if (invitation.when.line) section.append(el("p", "when", invitation.when.line));
    if (invitation.when.elsewhere) section.append(el("p", "muted", invitation.when.elsewhere));
    if (invitation.when.note) section.append(el("p", "muted", invitation.when.note));
    if (invitation.rrule)
      section.append(
        el(
          "p",
          "muted",
          `Repeats: ${invitation.rrule}${invitation.exceptions ? ` (${invitation.exceptions} exceptions)` : ""}`,
        ),
      );
    if (invitation.location) section.append(el("p", "", `Where: ${invitation.location}`));
    if (invitation.organizer) section.append(el("p", "", `Organizer: ${invitation.organizer}`));
    if (invitation.attendees.length) {
      const list = el("ul", "attendees");
      for (const a of invitation.attendees)
        list.append(el("li", "", `${a.who} · ${STATES[a.partstat] ?? a.partstat.toLowerCase()}`));
      section.append(list);
    }
    if (invitation.description) section.append(el("pre", "description", invitation.description));
    for (const problem of invitation.problems) section.append(el("p", "error", problem));
    canAnswer = invitation.canAnswer;
    if (invitation.answered)
      section.append(el("p", "answered", `You ${STATES[invitation.answered] ?? "answered"}.`));
    if (canAnswer) {
      const answers = el("div", "answers");
      answers.setAttribute("role", "group");
      answers.setAttribute("aria-label", "Your answer");
      for (const [status, label, key] of ANSWERS) {
        const b = button(
          label,
          () => actions.command("endue.mail.rsvp", { status }),
          `${label} (${key})`,
        );
        b.setAttribute("aria-pressed", String(invitation.answered?.toLowerCase() === status));
        answers.append(b);
      }
      section.append(answers);
    }
    return section;
  };

  return {
    canAnswer: () => canAnswer,
    showing: () => showing,
    focus: () => root.focus(),

    /** @param {ReaderModel | null} model */
    show(model) {
      canAnswer = false;
      showing = model !== null;
      if (!model) {
        root.replaceChildren();
        root.hidden = true;
        return;
      }
      root.hidden = false;
      const { message, earlier, actions: available } = model;
      const header = el("header", "message-head");
      header.append(el("h2", "", message.title));
      const meta = el("dl", "meta");
      const add = (/** @type {string} */ term, /** @type {string} */ detail) => {
        if (!detail) return;
        meta.append(el("dt", "", term), el("dd", "", detail));
      };
      add("From", personLine(message.from));
      add("To", peopleLine(message.to));
      add("Cc", peopleLine(message.cc));
      add("Date", fullTime(message.receivedAt));
      header.append(meta);
      const tools = el("div", "tools");
      tools.setAttribute("role", "toolbar");
      tools.setAttribute("aria-label", "Message actions");
      const can = (/** @type {string} */ action) =>
        available.includes(/** @type {never} */ (action));
      const tool = (
        /** @type {string} */ label,
        /** @type {string} */ id,
        /** @type {string} */ needs,
        args = {},
      ) => {
        const b = button(label, () => actions.command(id, args));
        b.disabled = !can(needs);
        if (b.disabled) b.title = `The account's connector provides no ${needs} action.`;
        return b;
      };
      tools.append(
        tool("Reply", "endue.mail.reply", "send"),
        tool("Reply all", "endue.mail.reply", "send", { all: true }),
        tool("Forward", "endue.mail.forward", "send"),
        tool("Archive", "endue.mail.archive", "move"),
        tool("Trash", "endue.mail.trash", "move"),
        tool(message.flagged ? "Unflag" : "Flag", "endue.mail.flag", "flag"),
        tool(message.unread ? "Mark read" : "Mark unread", "endue.mail.toggle-unread", "flag"),
      );
      if (message.deepLink) {
        const link = doc.createElement("a");
        link.href = message.deepLink;
        link.target = "_blank";
        link.rel = "noopener";
        link.textContent = "Open in its app";
        tools.append(link);
      }
      header.append(tools);
      const parts = [header];
      if (model.invitation) parts.push(card(model.invitation));
      parts.push(el("pre", "body", message.body || "(No text)"));
      if (message.attachments.length) {
        const list = el("ul", "attachments");
        list.setAttribute("aria-label", "Attachments");
        for (const a of message.attachments)
          list.append(
            el("li", "", `${a.name}${a.size === undefined ? "" : ` · ${sizeOf(a.size)}`}`),
          );
        parts.push(list);
      }
      if (earlier.length) {
        const section = el("section", "earlier");
        section.append(el("h3", "", `${earlier.length} more in this thread`));
        const list = el("ul", "");
        for (const m of earlier) {
          const li = el("li", "");
          li.append(
            button(`${personLine(m.from)} · ${fullTime(m.receivedAt)} · ${m.snippet}`, () =>
              actions.openMessage(m.key),
            ),
          );
          list.append(li);
        }
        section.append(list);
        parts.push(section);
      }
      root.replaceChildren(...parts);
    },
  };
}
