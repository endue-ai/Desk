import { describe, expect, it } from "vitest";
import {
  chatOf,
  conversationKey,
  conversationRef,
  conversationsOf,
  isChat,
  merged,
  messageRef,
  move,
} from "../ui/model.js";
import { detectPlatform, hueOf, PLATFORMS, platformOf } from "../ui/platforms.js";
import {
  CHAT,
  conversationQuery,
  FILTERS,
  listed,
  passes,
  says,
  threadQuery,
  timelineQuery,
  unreadQuery,
} from "../ui/query.js";
import { BRIDGE, DISCORD, SLACK, sample } from "./chat-fixtures";

const chats = () =>
  sample()
    .filter(isChat)
    .map((item) => chatOf(item as never));
const byId = (id: string) => {
  const found = chats().find((m) => m.id === id);
  if (!found) throw new Error(`no ${id}`);
  return found;
};

describe("the chat profile", () => {
  it("is a message that names its channel; mail is not chat", () => {
    expect(sample().filter(isChat)).toHaveLength(10);
    expect(isChat({ kind: "message", raw: { channel: "" } })).toBe(false);
    expect(isChat({ kind: "task", raw: { channel: "C1" } })).toBe(false);
  });

  it("reads every field with its default", () => {
    const root = byId("s-3");
    expect(root).toMatchObject({
      key: "acme.slack/work#s-3",
      conversation: "acme.slack/work@C1",
      channelName: "general",
      channelKind: "channel",
      workspace: "Acme",
      author: "Mina",
      unread: true,
      self: false,
      thread: "s-3",
      isReply: false,
      replyCount: 2,
      reactions: [],
    });
    expect(root.platform.id).toBe("slack");
    expect(byId("s-4").isReply).toBe(true);
    expect(byId("s-5")).toMatchObject({ self: true, authorKey: "self" });
    // A DM without a name is named after the other person.
    expect(byId("s-7")).toMatchObject({ channelName: "Mina", channelKind: "dm" });
    expect(byId("d-2").reactions).toEqual([{ emoji: ":fire:", count: 1, self: false }]);
    expect(byId("t-1")).toMatchObject({ channelKind: "group", workspace: "Contoso" });
    expect(byId("t-1").platform.name).toBe("Microsoft Teams");
  });

  it("drops reactions and attachments it cannot read, keeps what it can", () => {
    const m = chatOf({
      kind: "message",
      source: SLACK,
      id: "x",
      title: "",
      updatedAt: "2026-10-30T00:00:00Z",
      from: { email: "a@b.c" },
      receivedAt: "2026-10-30T00:00:00Z",
      unread: false,
      body: "hi",
      raw: {
        channel: "C9",
        channelKind: "weird",
        reactions: [{ emoji: "" }, null, { emoji: "🎉", count: 2.7 }],
        attachments: [{ name: "a.png", size: 12, url: "https://x.test/a.png" }, { size: 3 }],
      },
    });
    expect(m.channelKind).toBe("channel");
    expect(m.author).toBe("a@b.c");
    expect(m.title).toBe("hi");
    expect(m.reactions).toEqual([{ emoji: "🎉", count: 2, self: false }]);
    expect(m.attachments).toEqual([{ name: "a.png", size: 12, url: "https://x.test/a.png" }]);
  });

  it("keys round-trip, and keys that are not keys are refused", () => {
    expect(conversationRef(conversationKey(DISCORD, "!room:matrix.org"))).toEqual({
      source: DISCORD,
      channel: "!room:matrix.org",
    });
    expect(messageRef("acme.slack/work#s-1")).toEqual({ source: SLACK, id: "s-1" });
    for (const bad of ["", "acme", "acme/@x", "acme/work@", "/work@x"])
      expect(conversationRef(bad), bad).toBeUndefined();
    expect(messageRef("acme/work#")).toBeUndefined();
  });

  it("merges a page into what is shown, newest first, chat only", () => {
    const shown = merged([], sample());
    expect(shown.map((m) => m.id).slice(0, 3)).toEqual(["d-2", "s-7", "s-6"]);
    expect(shown).toHaveLength(10);
  });
});

describe("services", () => {
  it("knows fourteen services by name and colour, and shows any other by its own name", () => {
    expect(PLATFORMS).toHaveLength(14);
    expect(platformOf("Rocket.Chat").id).toBe("rocketchat");
    expect(platformOf("msteams").id).toBe("teams");
    expect(platformOf("zephyr")).toMatchObject({ id: "zephyr", name: "Zephyr", mark: "Ze" });
    expect(platformOf("zephyr").hue).toBe(hueOf("zephyr"));
    expect(platformOf("").id).toBe("chat");
  });

  it("finds the service in raw.platform, else in the connector id, else Chat", () => {
    expect(detectPlatform(undefined, "acme.slack").id).toBe("slack");
    expect(detectPlatform(undefined, "example.discord-export").id).toBe("discord");
    expect(detectPlatform("matrix", BRIDGE.connector).id).toBe("matrix");
    expect(detectPlatform(undefined, "acme.chat").id).toBe("chat");
    for (let i = 0; i < 20; i++) expect(hueOf(`x${i}`)).toBeGreaterThanOrEqual(1);
    expect(Math.max(...Array.from({ length: 50 }, (_, i) => hueOf(`n${i}`)))).toBeLessThanOrEqual(
      8,
    );
  });
});

describe("conversations", () => {
  it("one per source and channel, newest activity first, with unread and mention counts", () => {
    const all = chats();
    const list = conversationsOf(
      all,
      all.filter((m) => m.unread),
    );
    expect(list.map((c) => `${c.name}|${c.unread}|${c.mentions}`)).toEqual([
      "raids|1|0",
      "Mina|1|1",
      "design|1|1",
      "general|2|0",
      "Mina, Jun|0|0",
    ]);
    const general = list.find((c) => c.channel === "C1");
    expect(general?.topic).toBe("Company-wide");
    expect(general?.latest.id).toBe("s-5");
  });

  it("an unread message beyond the recent page still makes its conversation", () => {
    const unread = chats().filter((m) => m.id === "s-6");
    expect(conversationsOf([], unread).map((c) => c.name)).toEqual(["design"]);
  });

  it("listed under a filter: unread, mentions (and DMs), direct", () => {
    const all = chats();
    const list = conversationsOf(
      all,
      all.filter((m) => m.unread),
    );
    const names = (f: Parameters<typeof listed>[1]) =>
      list.filter((c) => listed(c, f)).map((c) => c.name);
    expect(names("unread")).toEqual(["raids", "Mina", "design", "general"]);
    expect(names("mentions")).toEqual(["Mina", "design"]);
    expect(names("direct")).toEqual(["Mina", "Mina, Jun"]);
    expect(names("all")).toHaveLength(5);
  });

  it("keys move through a list and stop at its ends", () => {
    const ids = ["a", "b", "c"];
    expect(move(ids, null, "j")).toBe("a");
    expect(move(ids, null, "k")).toBe("c");
    expect(move(ids, "b", "]")).toBe("c");
    expect(move(ids, "c", "ArrowDown")).toBe("c");
    expect(move(ids, "a", "[")).toBe("a");
    expect(move(ids, "b", "End")).toBe("c");
    expect(move(ids, "b", "x")).toBeUndefined();
    expect(move([], null, "j")).toBeUndefined();
  });
});

describe("queries", () => {
  it("every chat query keeps to chat; a conversation is one source and channel", () => {
    expect(unreadQuery(undefined).where).toEqual([
      CHAT,
      { field: "unread", op: "eq", value: true },
    ]);
    expect(unreadQuery(["acme.slack"]).sources).toEqual(["acme.slack"]);
    expect(conversationQuery({ source: SLACK, channel: "C1" }, 100, "p100")).toEqual({
      kinds: ["message"],
      sources: ["acme.slack/work"],
      where: [{ field: "raw.channel", op: "eq", value: "C1" }],
      sort: [{ field: "receivedAt", dir: "desc" }],
      limit: 100,
      cursor: "p100",
    });
    expect(threadQuery(byId("s-4")).where).toEqual([
      { field: "raw.channel", op: "eq", value: "C1" },
      { field: "thread", op: "eq", value: "s-3" },
    ]);
  });

  it("the Timeline narrows by filter, search and service", () => {
    expect(FILTERS.map((f) => f.id)).toEqual(["all", "unread", "mentions", "direct", "saved"]);
    const q = timelineQuery({ filter: "direct", text: "lunch", sources: ["acme.slack"], page: 50 });
    expect(q).toMatchObject({
      text: "lunch",
      sources: ["acme.slack"],
      where: [CHAT, { field: "raw.channelKind", op: "in", value: ["dm", "group"] }],
      limit: 50,
    });
    expect(timelineQuery({ filter: "saved", page: 10 }).where).toEqual([CHAT]);
  });

  it("judges live changes as the index would", () => {
    const saved = new Set(["acme.slack/work#s-1"]);
    expect(passes(byId("s-6"), "mentions", saved)).toBe(true);
    expect(passes(byId("s-1"), "mentions", saved)).toBe(false);
    expect(passes(byId("s-1"), "saved", saved)).toBe(true);
    expect(passes(byId("t-1"), "direct", saved)).toBe(true);
    expect(passes(byId("s-1"), "unread", saved)).toBe(false);
    expect(says(byId("s-7"), "LUNCH 12:30")).toBe(true);
    expect(says(byId("s-7"), "dinner")).toBe(false);
  });
});
