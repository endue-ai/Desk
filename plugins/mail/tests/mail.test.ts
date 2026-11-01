import { describe, expect, it } from "vitest";
import { page } from "../../../packages/bridge/src/stub-query";
import { ACCOUNT, CONNECTOR, denied, ME, mount, READ, SOURCE, sample } from "./harness";

const LUNCH = `${ACCOUNT}#t-lunch`;
const INVITE_THREAD = `${ACCOUNT}#m-invite`;

describe("the mailbox", () => {
  it("lists the inbox at start as threads, newest first, with the unread count and the account", async () => {
    const { view, params } = await mount();
    expect(view.shown()).toEqual([
      "Lunch today?|Mina, me@example.com|1|2",
      "Invitation: Design review|Mina|1|1*",
      "Build 1042 passed|CI|0|1",
    ]);
    const nav = view.navs.at(-1);
    expect(nav?.current).toBe("inbox");
    expect(nav?.accounts).toEqual([ACCOUNT]);
    expect(nav?.mailboxes.find((b) => b.id === "inbox")?.count).toBe("2");
    expect(params("data.query").every((p) => (p as { scope: unknown }).scope !== undefined)).toBe(
      true,
    );
    expect(params("data.query")[0]).toMatchObject({
      scope: READ,
      query: { kinds: ["message"], limit: 50 },
    });
    expect(params("data.subscribe")).toEqual([{ query: { kinds: ["message"] }, scope: READ }]);
    expect(view.statuses).toEqual([]);
    expect(view.lists.at(-1)?.state).toEqual({
      more: false,
      loading: false,
      empty: "Nothing in Inbox.",
    });
  });

  it("switches mailboxes and remembers the one in use; an unknown one is refused", async () => {
    const store: Record<string, unknown> = {};
    const { app, view, host } = await mount({ store });
    await host.command("endue.mail.mailbox", { mailbox: "sent" });
    expect(view.shown()).toEqual(["Re: Offsite ideas|me@example.com|0|1"]);
    await app.setMailbox("archive");
    expect(view.shown()).toEqual(["Welcome to acme|Acme|0|1"]);
    expect(store.view).toEqual({ mailbox: "archive", account: null, selected: null });
    await expect(app.setMailbox("spam")).rejects.toThrow("spam is not a mailbox.");
    const back = await mount({ store });
    expect(back.view.navs.at(-1)?.current).toBe("archive");
  });

  it("searches within the mailbox, from a command or the palette", async () => {
    const { view, host } = await mount({ pick: () => "bistro" });
    await host.command("endue.mail.search", { text: "build passed" });
    expect(view.shown()).toEqual(["Build 1042 passed|CI|0|1"]);
    await host.command("endue.mail.search");
    // Only the latest lunch message says "bistro": the thread shows the one message that matches.
    expect(view.shown()).toEqual(["Lunch today?|Mina|1|1"]);
    expect(view.navs.at(-1)?.search).toBe("bistro");
    await host.command("endue.mail.search", { text: "zzz" });
    expect(view.lists.at(-1)?.state.empty).toBe('Nothing matches "zzz" in Inbox.');
  });

  it("pages: the setting from init.yaml sizes a page and Show more appends the next", async () => {
    const { app, view } = await mount({ init: { "endue.mail.page": 2 } });
    expect(view.shown()).toHaveLength(2);
    expect(view.lists.at(-1)?.state.more).toBe(true);
    await app.more();
    expect(view.shown()).toHaveLength(3);
    expect(view.lists.at(-1)?.state.more).toBe(false);
  });

  it("says so when no account brings messages in", async () => {
    const { view } = await mount({ items: [] });
    expect(view.lists.at(-1)?.state.empty).toBe(
      "No mail account is connected yet. Connect one and its messages show here.",
    );
    expect(view.navs.at(-1)?.accounts).toEqual([]);
  });

  it("keys move the selection and Enter opens", async () => {
    const { app, view } = await mount();
    await app.key("ArrowDown");
    expect(view.selected()).toBe(LUNCH);
    await app.key("j");
    expect(view.selected()).toBe(INVITE_THREAD);
    expect(await app.key("x")).toBe(false);
    await app.key("Enter");
    expect(view.reading()).toBe("m-invite");
    expect(view.focused.at(-1)).toBe("reader");
  });
});

describe("reading", () => {
  it("opens a thread's latest message, lists the earlier ones, and marks it read through the connector", async () => {
    const { app, view, ran, settle } = await mount();
    await app.activate(LUNCH);
    await settle();
    expect(view.reading()).toBe("m-lunch");
    const reader = view.readers.at(-1);
    expect(reader?.earlier.map((m) => m.id)).toEqual(["m-lunch-1"]);
    expect(reader?.actions).toEqual(["send", "move", "flag"]);
    expect(ran(`${CONNECTOR}.mail.flag`)).toEqual([
      { instance: "work", id: "m-lunch", unread: false },
    ]);
    expect(view.shown()[0]).toBe("Lunch today?|Mina, me@example.com|0|2");
    expect(view.navs.at(-1)?.mailboxes[0]?.count).toBe("1");
  });

  it("leaves a message unread when the setting says never", async () => {
    const { app, ran, settle } = await mount({ settings: { "mark-read": "never" } });
    await app.activate(LUNCH);
    await settle();
    expect(ran(`${CONNECTOR}.mail.flag`)).toEqual([]);
  });

  it("shows the invitation card with the person as the attendee who has not answered", async () => {
    const { app, view, settle } = await mount({ settings: { addresses: [ME] } });
    await app.activate(INVITE_THREAD);
    await settle();
    const invitation = view.readers.at(-1)?.invitation;
    expect(invitation).toMatchObject({
      summary: "Design review",
      location: "Room 1",
      organizer: "Mina",
      method: "REQUEST",
      cancelled: false,
      canAnswer: true,
      mine: { name: "Me", email: ME },
    });
    expect(invitation?.answered).toBeUndefined();
    expect(invitation?.attendees).toEqual([
      { who: "Me", partstat: "NEEDS-ACTION" },
      { who: "Jun", partstat: "ACCEPTED" },
    ]);
  });

  it("an agent names a message by source and id, even one outside the list", async () => {
    const { host, view } = await mount();
    await expect(host.command("endue.mail.archive", { id: "x" })).rejects.toThrow(
      "Open a message first.",
    );
    const key = await host.command("endue.mail.show", { source: SOURCE, id: "m-old" });
    expect(key).toBe(`${ACCOUNT}#m-old`);
    expect(view.reading()).toBe("m-old");
    await expect(host.command("endue.mail.show", { source: SOURCE, id: "nope" })).rejects.toThrow(
      "There is no message nope.",
    );
  });
});

describe("acting through the connector", () => {
  it("archives the open message: the row leaves the inbox and the connector's move runs", async () => {
    const { app, host, view, ran, settle } = await mount();
    await app.activate(LUNCH);
    await settle();
    await host.command("endue.mail.archive");
    expect(ran(`${CONNECTOR}.mail.move`)).toEqual([
      { instance: "work", id: "m-lunch", mailbox: "archive" },
    ]);
    // The thread keeps its earlier message, which sits where that message was received.
    expect(view.shown()).toEqual([
      "Invitation: Design review|Mina|1|1*",
      "Build 1042 passed|CI|0|1",
      "Lunch today?|me@example.com|0|1",
    ]);
    expect(view.statuses.at(-1)).toBe("Moved to archive.");
    await host.command("endue.mail.trash", { source: SOURCE, id: "m-build" });
    expect(view.shown()).toEqual([
      "Invitation: Design review|Mina|1|1*",
      "Lunch today?|me@example.com|0|1",
    ]);
  });

  it("flags and toggles unread, and reports the state", async () => {
    const { app, host, view, ran, settle } = await mount({ settings: { "mark-read": "never" } });
    await app.activate(LUNCH);
    await settle();
    expect(await host.command("endue.mail.flag")).toBe(true);
    expect(view.shown()[0]).toBe("Lunch today?|Mina, me@example.com|1|2*");
    expect(await host.command("endue.mail.toggle-unread")).toBe(false);
    expect(ran(`${CONNECTOR}.mail.flag`)).toEqual([
      { instance: "work", id: "m-lunch", flagged: true },
      { instance: "work", id: "m-lunch", unread: false },
    ]);
    expect(view.readers.at(-1)?.message.flagged).toBe(true);
  });

  it("a connector without the action is said in words and the screen goes back", async () => {
    const { app, host, view, settle } = await mount({ actions: ["send", "flag"] });
    await app.activate(LUNCH);
    await settle();
    expect(view.readers.at(-1)?.actions).toEqual(["send", "flag"]);
    await expect(host.command("endue.mail.archive")).rejects.toThrow(
      `${CONNECTOR} cannot move mail: it provides no ${CONNECTOR}.mail.move.`,
    );
    expect(view.shown()[0]).toBe("Lunch today?|Mina, me@example.com|0|2");
    expect(view.statuses.at(-1)).toBe(
      `${CONNECTOR} cannot move mail: it provides no ${CONNECTOR}.mail.move.`,
    );
  });

  it("a connector that fails is said in words too", async () => {
    const { app, host, view, settle } = await mount({
      settings: { "mark-read": "never" },
      commands: {
        [`${CONNECTOR}.mail.move`]: () => {
          throw new Error("the server is away");
        },
      },
    });
    await app.activate(LUNCH);
    await settle();
    await expect(host.command("endue.mail.trash")).rejects.toThrow(
      "Could not move: the server is away.",
    );
    expect(view.shown()).toHaveLength(3);
  });
});

describe("permissions", () => {
  it("a refused read is asked for once and said on the status line", async () => {
    const { view, params } = await mount({
      handlers: {
        "data.query": () => {
          throw denied("data:read");
        },
        "perm.request": () => ({ granted: false }),
      },
    });
    expect(params("perm.request")).toEqual([
      { permission: READ, reason: "To show your mail in the mail plugin" },
    ]);
    expect(view.statuses.at(-1)).toBe("Not allowed to read messages.");
    expect(view.shown()).toEqual([]);
  });

  it("a granted ask reads again", async () => {
    let refused = false;
    const items = sample();
    const { view, params } = await mount({
      handlers: {
        "data.query": (p) => {
          if (!refused) {
            refused = true;
            throw denied("data:read");
          }
          return page(items, p.query);
        },
      },
    });
    expect(params("perm.request")).toHaveLength(1);
    expect(view.shown()).toHaveLength(3);
  });
});
