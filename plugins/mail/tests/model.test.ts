import { describe, expect, it } from "vitest";
import {
  inMailbox,
  mailboxOf,
  merged,
  messageOf,
  move,
  queryFor,
  threadQuery,
  threadsOf,
} from "../ui/model.js";
import { message, SOURCE, sample } from "./harness";

/** A mailbox by id; the test fails if it is not one. */
const box = (id: string) => {
  const found = mailboxOf(id);
  if (!found) throw new Error(`${id} is not a mailbox`);
  return found;
};
const inbox = () => box("inbox");

describe("mailboxes", () => {
  it("the inbox is every message not in another role, so one without raw.mailbox is in it", () => {
    const query = queryFor(inbox(), { page: 50 });
    expect(query).toEqual({
      kinds: ["message"],
      where: ["archive", "sent", "drafts", "trash", "junk"].map((role) => ({
        field: "raw.mailbox",
        op: "ne",
        value: role,
      })),
      sort: [{ field: "receivedAt", dir: "desc" }],
      limit: 50,
    });
    const [lunch, , , , sent, old] = sample();
    expect(inMailbox(lunch as never, inbox())).toBe(true);
    expect(inMailbox(sent as never, inbox())).toBe(false);
    expect(inMailbox(old as never, inbox())).toBe(false);
    expect(inMailbox(old as never, box("archive"))).toBe(true);
  });

  it("a search, an account and a cursor narrow the query; drafts have no live query", () => {
    const query = queryFor(box("unread"), {
      text: "lunch",
      account: "acme.imap/work",
      page: 20,
      cursor: "p20",
    });
    expect(query.text).toBe("lunch");
    expect(query.sources).toEqual(["acme.imap/work"]);
    expect(query.cursor).toBe("p20");
    expect(query.where?.[0]).toEqual({ field: "unread", op: "eq", value: true });
    expect(mailboxOf("drafts")?.live).toBe(false);
    expect(mailboxOf("nope")).toBeUndefined();
    expect(threadQuery("t-lunch", "acme.imap/work")).toMatchObject({
      sources: ["acme.imap/work"],
      where: [{ field: "thread", op: "eq", value: "t-lunch" }],
      sort: [{ field: "receivedAt", dir: "asc" }],
    });
  });

  it("inMailbox judges the filter the way the list was loaded: account and search words", () => {
    const [lunch] = sample();
    const item = lunch as never;
    expect(inMailbox(item, inbox(), { text: "bistro 12:30" })).toBe(true);
    expect(inMailbox(item, inbox(), { text: "dinner" })).toBe(false);
    expect(inMailbox(item, inbox(), { account: "acme.imap/work" })).toBe(true);
    expect(inMailbox(item, inbox(), { account: "acme.imap/home" })).toBe(false);
  });
});

describe("messages", () => {
  it("reads the raw fields a mail connector adds, with defaults", () => {
    const [, invite, build] = sample();
    const read = messageOf(invite as never);
    expect(read).toMatchObject({
      key: "acme.imap/work#m-invite",
      thread: "m-invite",
      flagged: true,
      mailbox: "inbox",
      messageId: "<invite-7@example.com>",
      references: [],
      cc: [],
    });
    expect(read.calendar).toContain("BEGIN:VCALENDAR");
    expect(messageOf(build as never).attachments).toEqual([
      { name: "log.txt", mime: "text/plain", size: 2048 },
    ]);
    const bare = messageOf(
      message({
        id: "x",
        title: "  ",
        updatedAt: "2026-10-30T00:00:00Z",
        from: { email: "a@b.c" },
        receivedAt: "2026-10-30T00:00:00Z",
        unread: false,
        body: "first line\nsecond",
        raw: {
          mailbox: "nowhere",
          cc: ["x@y.z", "bad", { name: "N" }],
          attachments: [{ size: 1 }],
        },
      }),
    );
    expect(bare.title).toBe("(No subject)");
    expect(bare.mailbox).toBe("inbox");
    expect(bare.snippet).toBe("first line");
    expect(bare.cc).toEqual([{ email: "x@y.z" }, { name: "N" }]);
    expect(bare.attachments).toEqual([]);
  });

  it("threads one page: the newest message leads, the thread sits where it is, people are listed once", () => {
    const messages = merged([], sample());
    expect(messages.map((m) => m.id)).toEqual([
      "m-lunch",
      "m-invite",
      "m-build",
      "m-lunch-1",
      "m-sent",
      "m-old",
    ]);
    const threads = threadsOf(messages);
    expect(threads.map((t) => `${t.latest.id}:${t.messages.length}:${t.unread}`)).toEqual([
      "m-lunch:2:1",
      "m-invite:1:1",
      "m-build:1:0",
      "m-sent:1:0",
      "m-old:1:0",
    ]);
    expect(threads[0]?.people).toEqual(["Mina", "me@example.com"]);
    expect(threads[1]?.flagged).toBe(true);
  });

  it("merging replaces a message by key and keeps newest first", () => {
    const [lunch] = sample();
    const shown = merged([], sample());
    const read = { ...(lunch as never as object), unread: false } as never;
    const next = merged(shown, [read]);
    expect(next).toHaveLength(6);
    expect(next[0]?.unread).toBe(false);
  });

  it("keys move the selection: j k and arrows step, Home and End jump, nothing wraps", () => {
    const list = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(move(list as never, null, "ArrowDown")).toBe("a");
    expect(move(list as never, "a", "j")).toBe("b");
    expect(move(list as never, "c", "ArrowDown")).toBe("c");
    expect(move(list as never, "b", "k")).toBe("a");
    expect(move(list as never, "b", "Home")).toBe("a");
    expect(move(list as never, "a", "End")).toBe("c");
    expect(move(list as never, "a", "x")).toBeUndefined();
    expect(move([], null, "ArrowDown")).toBeUndefined();
  });

  it("the sent and archive mailboxes use eq on the role", () => {
    expect(mailboxOf("sent")?.where).toEqual([{ field: "raw.mailbox", op: "eq", value: "sent" }]);
    expect(SOURCE.connector).toBe("acme.imap");
  });
});
