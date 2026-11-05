import { describe, expect, it } from "vitest";
import { badge, countsLabel, dayLabel, initials, shortTime, sizeText } from "../ui/format.js";
import { chatOf, conversationsOf, isChat } from "../ui/model.js";
import { cardsOf, columnsOf, entriesOf, firstUnread, mainline, streamOf } from "../ui/timeline.js";
import { at, sample } from "./chat-fixtures";

const NOW = Date.parse(at(30, "09:00"));
const CLOCK = { zone: "Asia/Seoul", now: NOW, locale: "en-US" };
const chats = () =>
  sample()
    .filter(isChat)
    .map((item) => chatOf(item as never));
const general = () => chats().filter((m) => m.channel === "C1");

const shape = (entries: ReturnType<typeof entriesOf>) =>
  entries.map((e) =>
    e.type === "message"
      ? `${e.message.id}${e.continued ? "+" : ""}${e.replies ? `(${e.replies})` : ""}`
      : e.type === "day"
        ? `[${e.label}]`
        : "--new--",
  );

describe("a conversation", () => {
  it("shows roots, hides thread replies, and counts replies on the root", () => {
    expect(mainline(general()).map((m) => m.id)).toEqual(["s-1", "s-2", "s-3"]);
    const messages = mainline(general());
    const entries = entriesOf(messages, { clock: CLOCK, firstUnread: firstUnread(general()) });
    expect(shape(entries)).toEqual(["[Today]", "s-1", "s-2", "--new--", "s-3(2)"]);
  });

  it("runs an author's messages within five minutes; a day heading breaks a run", () => {
    const mina = general().filter((m) => m.id === "s-1")[0];
    if (!mina) throw new Error("fixture");
    const later = { ...mina, key: "k2", id: "x2", time: mina.time + 4 * 60_000 };
    const much = { ...mina, key: "k3", id: "x3", time: mina.time + 10 * 60_000 };
    const nextDay = { ...mina, key: "k4", id: "x4", time: mina.time + 86_400_000 };
    expect(
      shape(
        entriesOf([much, mina, later, nextDay], { clock: { ...CLOCK, now: NOW + 86_400_000 } }),
      ),
    ).toEqual(["[Yesterday]", "s-1", "x2+", "x3", "[Today]", "x4"]);
  });

  it("pending messages sit at the end with their state", () => {
    const [m] = general();
    if (!m) throw new Error("fixture");
    const sending = {
      ...m,
      key: "pending:1",
      id: "pending:1",
      self: true,
      authorKey: "self",
      time: NOW,
    };
    const entries = entriesOf([m], {
      clock: CLOCK,
      pending: [{ message: sending, state: "failed", error: "No." }],
    });
    expect(entries.at(-1)).toMatchObject({ key: "pending:1", pending: "failed", error: "No." });
  });

  it("the first unread is the oldest unread root that is not the person's", () => {
    expect(firstUnread(general())).toBe("acme.slack/work#s-3");
    expect(firstUnread(chats().filter((m) => m.channel === "T1"))).toBeNull();
  });
});

describe("the other layouts", () => {
  it("the Timeline is every message newest first under day headings", () => {
    const entries = streamOf(chats(), CLOCK);
    expect(entries[0]).toMatchObject({ type: "day", label: "Today" });
    expect(entries[1]).toMatchObject({ type: "message", key: "acme.discord/default#d-2" });
    expect(entries.at(-2)).toMatchObject({ type: "day", label: "Yesterday" });
  });

  it("Inbox cards put the conversations that call the person first", () => {
    const all = chats();
    const unread = all.filter((m) => m.unread);
    const conversations = new Map(conversationsOf(all, unread).map((c) => [c.key, c]));
    const cards = cardsOf(unread, conversations);
    expect(cards.map((c) => `${c.conversation.name}:${c.unread}/${c.mentions}`)).toEqual([
      "Mina:1/1",
      "design:1/1",
      "raids:1/0",
      "general:2/0",
    ]);
    expect(cards[3]?.messages.map((m) => m.id)).toEqual(["s-3", "s-4"]);
  });

  it("Columns are the pinned conversations that exist, else the newest three", () => {
    const all = chats();
    const list = conversationsOf(all, []);
    expect(columnsOf([], list).map((c) => c.name)).toEqual(["raids", "Mina", "design"]);
    expect(columnsOf(["gone", "acme.slack/work@C1"], list).map((c) => c.name)).toEqual(["general"]);
  });
});

describe("words", () => {
  it("days, times, sizes, badges and initials", () => {
    expect(dayLabel(Date.parse(at(28, "10:00")), CLOCK)).toBe("Wednesday, October 28");
    expect(dayLabel(Date.parse("2025-10-28T10:00:00+09:00"), CLOCK)).toBe(
      "Tuesday, October 28, 2025",
    );
    expect(shortTime(at(30, "08:12"), CLOCK)).toBe("08:12 AM");
    expect(shortTime(at(28, "08:12"), CLOCK)).toBe("Wed");
    expect(shortTime("2026-10-01T08:12:00+09:00", CLOCK)).toBe("Oct 1");
    expect(sizeText(2048)).toBe("2 KB");
    expect(sizeText(1_572_864)).toBe("1.5 MB");
    expect(sizeText(12)).toBe("12 B");
    expect(badge(120)).toBe("99+");
    expect(countsLabel(3, 1)).toBe("3 unread, 1 mention");
    expect(countsLabel(0, 2)).toBe("2 mentions");
    expect(initials("Mina Park")).toBe("MP");
    expect(initials("jun")).toBe("JU");
    expect(initials("  ")).toBe("?");
  });
});
