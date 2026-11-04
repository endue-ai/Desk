import type { MessageItem } from "../../../packages/bridge/src/index";

export const SLACK = { connector: "acme.slack", instance: "work" } as const;
export const DISCORD = { connector: "acme.discord", instance: "default" } as const;
export const BRIDGE = { connector: "acme.bridge", instance: "default" } as const;
export const IMAP = { connector: "acme.imap", instance: "work" } as const;
export const MINA = { name: "Mina", email: "mina@example.com" };
export const JUN = { name: "Jun" };
export const ME = { name: "Me" };

/** A time on a day of October 2026 in Seoul. */
export const at = (day: number, time: string) => `2026-10-${day}T${time}:00+09:00`;

type Fields = Partial<Omit<MessageItem, "kind" | "source" | "raw">> & {
  id: string;
  receivedAt: string;
  raw?: Record<string, unknown>;
};
export const chat = (source: MessageItem["source"], fields: Fields): MessageItem => ({
  kind: "message",
  source,
  title: (fields.body ?? "").split("\n")[0] ?? "",
  updatedAt: fields.receivedAt,
  from: MINA,
  unread: false,
  ...fields,
});

const slack = (raw: Record<string, unknown>) => ({ workspace: "Acme", ...raw });
const discord = (raw: Record<string, unknown>) => ({ workspace: "Gamers", ...raw });

/**
 * Ten chat messages over three services and one mail message: Slack's #general with a thread,
 * #design with a mention and a DM; Discord's #raids with reactions; a Teams group chat brought in
 * by a bridge connector that names its service.
 */
export const sample = (): MessageItem[] => [
  chat(SLACK, {
    id: "s-1",
    receivedAt: at(30, "08:00"),
    body: "Good morning team! :wave:",
    raw: slack({ channel: "C1", channelName: "general", topic: "Company-wide" }),
  }),
  chat(SLACK, {
    id: "s-2",
    receivedAt: at(30, "08:02"),
    from: JUN,
    body: "Morning! Standup at *10*",
    raw: slack({ channel: "C1", channelName: "general" }),
  }),
  chat(SLACK, {
    id: "s-3",
    receivedAt: at(30, "08:30"),
    unread: true,
    thread: "s-3",
    body: "Deploy is done <https://ci.example.com/1042|build 1042>",
    raw: slack({ channel: "C1", channelName: "general", replyCount: 2 }),
  }),
  chat(SLACK, {
    id: "s-4",
    receivedAt: at(30, "08:35"),
    from: JUN,
    unread: true,
    thread: "s-3",
    body: "Nice!",
    raw: slack({ channel: "C1", channelName: "general" }),
  }),
  chat(SLACK, {
    id: "s-5",
    receivedAt: at(30, "08:40"),
    from: ME,
    thread: "s-3",
    body: "Thanks both",
    raw: slack({ channel: "C1", channelName: "general", self: true }),
  }),
  chat(SLACK, {
    id: "s-6",
    receivedAt: at(30, "08:50"),
    from: { name: "Sora" },
    unread: true,
    body: "@me can you review the mockups?",
    raw: slack({ channel: "C2", channelName: "design", channelKind: "private", mentioned: true }),
  }),
  chat(SLACK, {
    id: "s-7",
    receivedAt: at(30, "08:55"),
    unread: true,
    body: "Lunch at 12:30?",
    deepLink: "https://acme.slack.example/archives/D1/p7",
    raw: slack({ channel: "D1", channelKind: "dm" }),
  }),
  chat(DISCORD, {
    id: "d-1",
    receivedAt: at(30, "07:00"),
    from: { name: "Rex" },
    body: "Raid tonight at 21:00 **be on time**",
    raw: discord({
      channel: "G1",
      channelName: "raids",
      reactions: [{ emoji: "👍", count: 3, self: true }],
    }),
  }),
  chat(DISCORD, {
    id: "d-2",
    receivedAt: at(30, "08:58"),
    from: { name: "Kai" },
    unread: true,
    body: "I'm in ~~maybe~~ yes",
    raw: discord({ channel: "G1", channelName: "raids", reactions: [{ emoji: ":fire:" }] }),
  }),
  chat(BRIDGE, {
    id: "t-1",
    receivedAt: at(29, "17:00"),
    from: JUN,
    body: "See you Monday",
    raw: {
      platform: "teams",
      workspace: "Contoso",
      channel: "T1",
      channelName: "Mina, Jun",
      channelKind: "group",
    },
  }),
  {
    kind: "message",
    source: IMAP,
    id: "m-1",
    title: "Quarterly report",
    updatedAt: at(30, "07:30"),
    from: MINA,
    receivedAt: at(30, "07:30"),
    unread: true,
    body: "Attached.",
  },
];
