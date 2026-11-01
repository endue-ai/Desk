import type { MessageItem } from "../../../packages/bridge/src/index";

const CONNECTOR = "acme.imap";
const SOURCE = { connector: CONNECTOR, instance: "work" } as const;
const ME = "me@example.com";
const MINA = { name: "Mina", email: "mina@example.com" };

const at = (day: number, time: string) => `2026-10-${day}T${time}:00+09:00`;
type Unsourced = Omit<MessageItem, "source" | "kind">;
export const message = (
  fields: Unsourced,
  source: MessageItem["source"] = SOURCE,
): MessageItem => ({ kind: "message", source, ...fields });

/** The text/calendar part of Mina's invitation: a REQUEST for a design review in Seoul. */
export const INVITE = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//Example//Calendar//EN",
  "METHOD:REQUEST",
  "BEGIN:VEVENT",
  "UID:review-7@example.com",
  "SEQUENCE:2",
  "DTSTAMP:20261029T020000Z",
  "DTSTART;TZID=Asia/Seoul:20261103T160000",
  "DTEND;TZID=Asia/Seoul:20261103T170000",
  "SUMMARY:Design review",
  "LOCATION:Room 1",
  "DESCRIPTION:Slides first\\, then questions.",
  "ORGANIZER;CN=Mina:mailto:mina@example.com",
  `ATTENDEE;CN=Me;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${ME}`,
  "ATTENDEE;CN=Jun;PARTSTAT=ACCEPTED:mailto:jun@example.com",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

/** Six messages of acme.imap/work: four in the inbox (two in one thread), one sent, one archived. */
export const sample = (): MessageItem[] => [
  message({
    id: "m-lunch",
    title: "Lunch today?",
    updatedAt: at(30, "08:12"),
    from: MINA,
    to: [{ email: ME }],
    receivedAt: at(30, "08:12"),
    unread: true,
    snippet: "Still on for 12:30?",
    thread: "t-lunch",
    body: "Still on for 12:30 at the bistro?",
    raw: {
      messageId: "<lunch-2@example.com>",
      inReplyTo: "<lunch-1@example.com>",
      references: ["<lunch-1@example.com>"],
    },
  }),
  message({
    id: "m-invite",
    title: "Invitation: Design review",
    updatedAt: at(29, "11:00"),
    from: MINA,
    to: [
      { name: "Me", email: ME },
      { name: "Jun", email: "jun@example.com" },
    ],
    receivedAt: at(29, "11:00"),
    unread: true,
    body: "Please join.",
    raw: { calendar: INVITE, messageId: "<invite-7@example.com>", flagged: true },
  }),
  message({
    id: "m-build",
    title: "Build 1042 passed",
    updatedAt: at(29, "07:45"),
    from: { name: "CI", email: "ci@example.com" },
    receivedAt: at(29, "07:45"),
    unread: false,
    body: "All 312 tests passed on main.",
    raw: { attachments: [{ name: "log.txt", mime: "text/plain", size: 2048 }] },
  }),
  message({
    id: "m-lunch-1",
    title: "Lunch today?",
    updatedAt: at(28, "09:00"),
    from: { email: ME },
    to: [MINA],
    receivedAt: at(28, "09:00"),
    unread: false,
    thread: "t-lunch",
    body: "Lunch on Friday?",
    raw: { messageId: "<lunch-1@example.com>" },
  }),
  message({
    id: "m-sent",
    title: "Re: Offsite ideas",
    updatedAt: at(27, "15:00"),
    from: { email: ME },
    to: [MINA],
    receivedAt: at(27, "15:00"),
    unread: false,
    body: "A hike sounds good.",
    raw: { mailbox: "sent" },
  }),
  message({
    id: "m-old",
    title: "Welcome to acme",
    updatedAt: at(20, "10:00"),
    from: { name: "Acme", email: "hello@acme.example" },
    receivedAt: at(20, "10:00"),
    unread: false,
    body: "Welcome.",
    raw: { mailbox: "archive" },
  }),
];
