// Writing mail and answering invitations: the draft being composed (new, a reply, a forward), its
// autosave into the store, the send through the connector's action, and the iTIP REPLY an
// Accept, Tentative or Decline sends to the organizer (RFC 5546, RFC 6047). It talks to the DOM
// only through the view and to the bridge only through actions.js.
import {
  forwardDraft,
  newDraft,
  parseAddresses,
  problemsOf,
  replyDraft,
  sendArgs,
} from "./compose.js";
import { whenLine } from "./format.js";
import {
  ANSWERS,
  myAttendee,
  readCalendar,
  replyBody,
  replyCalendar,
  replySubject,
} from "./ical/itip.js";

/**
 * @typedef {import("./compose.js").Draft} Draft
 * @typedef {import("./model.js").Message} Message
 * @typedef {import("./actions.js").Action} Action
 * @typedef {import("./ical/itip.js").Invitation} Invitation
 * @typedef {import("./ical/itip.js").Attendee} Attendee
 * @typedef {keyof typeof ANSWERS} Answer
 * @typedef {{
 *   summary: string, when: ReturnType<typeof whenLine>, location?: string, description?: string,
 *   organizer?: string, attendees: Array<{ who: string, partstat: string }>, mine?: Attendee,
 *   answered?: Answer, method?: string, cancelled: boolean, rrule?: string, exceptions: number,
 *   canAnswer: boolean, problems: string[],
 * }} InvitationView
 * What the reader shows for a text/calendar part.
 * @typedef {{
 *   actions: ReturnType<typeof import("./actions.js").createActions>,
 *   view: { composer(draft: Draft | null, problems: string[]): void },
 *   say(text: string): void,
 *   conf(): { signature: string, addresses: string[] },
 *   current(): Message | null,
 *   account(): string | undefined,
 *   drafts: { all(): Draft[], put(draft: Draft): void, remove(id: string): void },
 *   answers: { get(key: string): Answer | undefined, set(key: string, answer: Answer): void },
 *   changed(): void,
 *   now?: () => number,
 * }} Deps
 */

const STATUSES = /** @type {Record<string, Answer>} */ ({
  accepted: "ACCEPTED",
  tentative: "TENTATIVE",
  declined: "DECLINED",
});

/**
 * The invitation of a message as the reader shows it, or undefined when the message has no
 * calendar part. `answered` is what the person said here, else what the organizer's copy says.
 * @param {Message} message
 * @param {string[]} addresses the person's own
 * @param {Answer | undefined} said
 * @param {{ locale?: string, zone?: string, now?: number }} [clock]
 * @returns {InvitationView | undefined}
 */
export function invitationView(message, addresses, said, clock) {
  if (!message.calendar) return undefined;
  const reading = readCalendar(message.calendar, clock?.zone);
  const invitation = reading.invitations[0];
  if (!invitation) {
    return {
      summary: "(Unreadable invitation)",
      when: { line: "" },
      attendees: [],
      cancelled: false,
      exceptions: 0,
      canAnswer: false,
      problems: reading.problems,
    };
  }
  const mine = myAttendee(invitation, mineAddresses(message, addresses));
  const partstat = mine && mine.partstat !== "NEEDS-ACTION" ? mine.partstat : undefined;
  const answered =
    said ?? (partstat && partstat in ANSWERS ? /** @type {Answer} */ (partstat) : undefined);
  const organizer = invitation.organizer;
  return {
    summary: invitation.summary,
    when: whenLine(invitation, clock),
    ...(invitation.location ? { location: invitation.location } : {}),
    ...(invitation.description ? { description: invitation.description } : {}),
    ...(organizer ? { organizer: organizer.name ?? organizer.email } : {}),
    attendees: invitation.attendees.map((a) => ({
      who: a.name ?? a.email ?? "Unknown",
      partstat: a.partstat,
    })),
    ...(mine ? { mine } : {}),
    ...(answered ? { answered } : {}),
    ...(invitation.method ? { method: invitation.method } : {}),
    cancelled: invitation.status === "CANCELLED",
    ...(invitation.rrule ? { rrule: invitation.rrule } : {}),
    exceptions: invitation.exceptions,
    canAnswer:
      (invitation.method === undefined || invitation.method === "REQUEST") &&
      invitation.status !== "CANCELLED" &&
      organizer?.email !== undefined,
    problems: reading.problems,
  };
}

/**
 * The addresses that may be the person's: the ones set, else the recipients of the message.
 * @param {Message} message
 * @param {string[]} addresses
 */
function mineAddresses(message, addresses) {
  if (addresses.length > 0) return addresses;
  return [...message.to, ...message.cc].flatMap((p) => p.email ?? []);
}

/** @param {Deps} deps */
export function createWriting(deps) {
  const { actions, view, say, drafts, answers } = deps;
  const now = deps.now ?? (() => Date.now());
  /** @type {Draft | null} */
  let draft = null;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let saving;

  const show = (/** @type {string[]} */ problems = []) => view.composer(draft, problems);
  const keep = () => {
    if (draft) drafts.put({ ...draft, savedAt: new Date(now()).toISOString() });
  };
  const open = (/** @type {Draft} */ next) => {
    draft = next;
    keep();
    show();
    deps.changed();
    return draft.id;
  };
  const needOpen = () => {
    const message = deps.current();
    if (!message) throw new Error("Open a message first.");
    return message;
  };

  return {
    composing: () => draft,

    /** Start a message, from a command's arguments or empty. */
    compose: (/** @type {Record<string, unknown>} */ given = {}) => {
      const text = (/** @type {unknown} */ v) => (typeof v === "string" ? v : undefined);
      const account = text(given.account) ?? deps.account();
      return open(
        newDraft({
          to: text(given.to),
          cc: text(given.cc),
          bcc: text(given.bcc),
          subject: text(given.subject),
          body: text(given.body),
          ...(account ? { account } : {}),
          signature: deps.conf().signature,
          now: new Date(now()).toISOString(),
        }),
      );
    },

    reply: (all = false) =>
      open(
        replyDraft(needOpen(), {
          all,
          addresses: deps.conf().addresses,
          signature: deps.conf().signature,
          now: new Date(now()).toISOString(),
        }),
      ),

    forward: () =>
      open(
        forwardDraft(needOpen(), {
          signature: deps.conf().signature,
          now: new Date(now()).toISOString(),
        }),
      ),

    /** Go on with a saved draft. @param {string} id */
    openDraft: (id) => {
      const saved = drafts.all().find((d) => d.id === id);
      if (!saved) throw new Error("That draft is gone.");
      return open(saved);
    },

    /** The person changed a field; the draft is saved a moment later. */
    edit: (
      /** @type {Partial<Pick<Draft, "to" | "cc" | "bcc" | "subject" | "body" | "account">>} */ fields,
    ) => {
      if (!draft) return;
      draft = { ...draft, ...fields };
      clearTimeout(saving);
      saving = setTimeout(() => {
        keep();
        deps.changed();
      }, 300);
    },

    /** Send the draft through the account's connector; the composer closes once it went. */
    send: async () => {
      if (!draft) throw new Error("Nothing is being written.");
      const problems = problemsOf(draft, await actions.accounts());
      if (problems.length > 0) {
        show(problems);
        throw new Error(problems[0] ?? "The draft cannot be sent.");
      }
      const [connector = ""] = (draft.account ?? "").split("/");
      const sent = draft;
      const result = await actions.run(connector, "send", sendArgs(sent));
      clearTimeout(saving);
      drafts.remove(sent.id);
      draft = null;
      show();
      say(`Sent: ${sent.subject.trim() || "(No subject)"}.`);
      deps.changed();
      return result;
    },

    /** Close the composer and drop the draft. */
    discard: () => {
      if (!draft) return false;
      clearTimeout(saving);
      drafts.remove(draft.id);
      draft = null;
      show();
      deps.changed();
      return true;
    },

    /** Put the composer away, keeping the draft. */
    close: () => {
      if (!draft) return;
      clearTimeout(saving);
      keep();
      draft = null;
      show();
      deps.changed();
    },

    /**
     * Answer the open message's invitation: an iTIP REPLY goes to the organizer through the
     * account's connector, and the answer is remembered for the card.
     * @param {string} status accepted, tentative or declined
     * @param {string} [address] the person's address when the invitation does not say
     */
    rsvp: async (status, address) => {
      const answer = STATUSES[status.toLowerCase()];
      if (!answer) throw new Error(`${status} is not an answer: accepted, tentative or declined.`);
      const message = needOpen();
      if (!message.calendar) throw new Error("This message holds no invitation.");
      const { invitations, method } = readCalendar(message.calendar);
      const invitation = invitations[0];
      if (!invitation) throw new Error("The invitation cannot be read.");
      if (method !== undefined && method !== "REQUEST")
        throw new Error(`A ${method} is not an invitation to answer.`);
      if (invitation.status === "CANCELLED") throw new Error("The meeting was cancelled.");
      if (!invitation.organizer?.email) throw new Error("The invitation names no organizer.");
      const given = address ? parseAddresses(address).people[0] : undefined;
      const mine =
        (given ? myAttendee(invitation, [given.email ?? ""]) : undefined) ??
        myAttendee(invitation, mineAddresses(message, deps.conf().addresses));
      const me = mine ?? given;
      if (!me?.email) throw new Error("Say which of your addresses the invitation came to.");
      const ics = replyCalendar(invitation, me, answer, now());
      const [connector = ""] = message.source.connector.split("/");
      const result = await actions.run(connector, "send", {
        instance: message.source.instance,
        to: [invitation.organizer],
        subject: replySubject(answer, invitation),
        body: replyBody(me, answer, invitation),
        calendar: { method: "REPLY", ics },
        ...(message.messageId ? { inReplyTo: message.messageId } : {}),
        replyTo: { source: message.source, id: message.id },
      });
      answers.set(`${message.key}#${invitation.uid}`, answer);
      say(`${ANSWERS[answer].subject}: ${invitation.summary}. The organizer was told.`);
      deps.changed();
      return result;
    },
  };
}
