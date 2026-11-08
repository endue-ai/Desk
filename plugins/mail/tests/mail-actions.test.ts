import { describe, expect, it } from "vitest";
import { ACCOUNT, CONNECTOR, INVITE, ME, message, mount, NOW, SOURCE, sample } from "./harness";

const LUNCH = `${ACCOUNT}#t-lunch`;
const INVITE_THREAD = `${ACCOUNT}#m-invite`;
const at = (iso: string) => new Date(iso).toISOString();

describe("following the index", () => {
  it("new mail joins the inbox at the top and is announced; read mail moves on", async () => {
    const { index, view, notices, settle } = await mount();
    index.upsert(
      message({
        id: "m-new",
        title: "Deploy done",
        updatedAt: at("2026-10-30T09:01:00+09:00"),
        from: { name: "Ops", email: "ops@example.com" },
        receivedAt: at("2026-10-30T09:01:00+09:00"),
        unread: true,
        body: "v1.4 is live.",
      }),
    );
    await settle();
    expect(view.shown()[0]).toBe("Deploy done|Ops|1|1");
    expect(notices).toEqual([{ title: "Ops", body: "Deploy done" }]);
    expect(view.navs.at(-1)?.mailboxes[0]?.count).toBe("3");
    const [lunch] = sample();
    index.upsert({ ...(lunch as never as object), raw: { mailbox: "archive" } } as never);
    await settle();
    expect(view.shown()).toEqual([
      "Deploy done|Ops|1|1",
      "Invitation: Design review|Mina|1|1*",
      "Build 1042 passed|CI|0|1",
      "Lunch today?|me@example.com|0|1",
    ]);
    index.remove(SOURCE, "m-build");
    await settle();
    expect(view.shown()).toHaveLength(3);
    expect(notices).toHaveLength(1);
  });

  it("old mail arriving in a sync and mail outside the inbox make no noise, nor does notify off", async () => {
    const { index, notices, settle } = await mount({ settings: { notify: false } });
    index.upsert(
      message({
        id: "a",
        title: "A",
        updatedAt: at("2026-10-30T09:01:00+09:00"),
        from: { email: "a@b.co" },
        receivedAt: at("2026-10-30T09:01:00+09:00"),
        unread: true,
      }),
    );
    await settle();
    expect(notices).toEqual([]);
    const quiet = await mount();
    quiet.index.upsert(
      message({
        id: "b",
        title: "B",
        updatedAt: at("2026-10-01T09:00:00+09:00"),
        from: { email: "a@b.co" },
        receivedAt: at("2026-10-01T09:00:00+09:00"),
        unread: true,
      }),
    );
    quiet.index.upsert(
      message({
        id: "c",
        title: "C",
        updatedAt: at("2026-10-30T09:01:00+09:00"),
        from: { email: "a@b.co" },
        receivedAt: at("2026-10-30T09:01:00+09:00"),
        unread: true,
        raw: { mailbox: "junk" },
      }),
    );
    await quiet.settle();
    expect(quiet.notices).toEqual([]);
    expect(quiet.view.shown()).toHaveLength(4);
  });
});

describe("writing", () => {
  it("composes from a command, autosaves the draft, and sends it through the account's connector", async () => {
    const { host, view, store, ran, app, settle } = await mount({
      settings: { signature: "-- me" },
    });
    const id = await host.command("endue.mail.compose", { to: "a@b.co", subject: "Hi" });
    expect(view.focused.at(-1)).toBe("composer");
    expect(view.draft()).toMatchObject({
      id,
      account: ACCOUNT,
      to: "a@b.co",
      subject: "Hi",
      body: "\n\n-- me",
    });
    await settle();
    expect(store.drafts).toHaveLength(1);
    expect(view.navs.at(-1)?.mailboxes.find((b) => b.id === "drafts")?.count).toBe("1");
    app.writing.edit({ body: "Hello\n\n-- me" });
    await host.command("endue.mail.send");
    expect(ran(`${CONNECTOR}.mail.send`)).toEqual([
      { instance: "work", to: [{ email: "a@b.co" }], subject: "Hi", body: "Hello\n\n-- me" },
    ]);
    expect(view.draft()).toBeNull();
    expect(view.statuses.at(-1)).toBe("Sent: Hi.");
    await settle();
    expect(store.drafts).toEqual([]);
  });

  it("will not send without a recipient, and keeps the draft", async () => {
    const { host, view, ran } = await mount();
    await host.command("endue.mail.compose", { subject: "Hi" });
    await expect(host.command("endue.mail.send")).rejects.toThrow("Add at least one recipient.");
    expect(view.composers.at(-1)?.problems).toEqual(["Add at least one recipient."]);
    expect(ran(`${CONNECTOR}.mail.send`)).toEqual([]);
    expect(await host.command("endue.mail.discard")).toBe(true);
    expect(view.draft()).toBeNull();
  });

  it("replies and forwards from the open message", async () => {
    const { app, host, view, settle } = await mount({
      settings: { addresses: [ME], "mark-read": "never" },
    });
    await expect(host.command("endue.mail.reply")).rejects.toThrow("Open a message first.");
    await app.activate(LUNCH);
    await settle();
    await host.command("endue.mail.reply", { all: true });
    expect(view.draft()).toMatchObject({
      to: "Mina <mina@example.com>",
      cc: "",
      subject: "Re: Lunch today?",
      inReplyTo: "<lunch-2@example.com>",
    });
    await host.command("endue.mail.forward");
    expect(view.draft()).toMatchObject({ to: "", subject: "Fwd: Lunch today?" });
    expect(view.draft()?.body).toContain("Forwarded message");
  });

  it("drafts come back after a restart and open from the Drafts mailbox", async () => {
    const store: Record<string, unknown> = {};
    const first = await mount({ store });
    await first.host.command("endue.mail.compose", { to: "a@b.co", subject: "Later" });
    await first.settle();
    const again = await mount({ store });
    await again.app.setMailbox("drafts");
    expect(again.view.shown()).toEqual(["Later|a@b.co|0|1"]);
    const row = again.view.lists.at(-1)?.rows[0]?.id ?? "";
    await again.app.activate(row);
    expect(again.view.draft()?.subject).toBe("Later");
    expect(again.view.focused.at(-1)).toBe("composer");
  });
});

describe("answering an invitation", () => {
  it("sends an iTIP REPLY to the organizer through the connector and remembers the answer", async () => {
    const { app, host, view, ran, store, settle } = await mount({ settings: { addresses: [ME] } });
    await app.activate(INVITE_THREAD);
    await settle();
    await host.command("endue.mail.rsvp", { status: "accepted" });
    const [sent] = ran(`${CONNECTOR}.mail.send`) as Array<Record<string, unknown>>;
    expect(sent).toMatchObject({
      instance: "work",
      to: [{ name: "Mina", email: "mina@example.com" }],
      subject: "Accepted: Design review",
      body: "Me has accepted the invitation: Design review.",
      inReplyTo: "<invite-7@example.com>",
      replyTo: { source: SOURCE, id: "m-invite" },
    });
    const calendar = sent?.calendar as { method: string; ics: string };
    expect(calendar.method).toBe("REPLY");
    expect(calendar.ics).toContain("METHOD:REPLY");
    expect(calendar.ics).toContain(`ATTENDEE;CN=Me;PARTSTAT=ACCEPTED:mailto:${ME}`);
    expect(calendar.ics).toContain("UID:review-7@example.com");
    expect(calendar.ics).toContain("DTSTAMP:20261030T000000Z");
    expect(view.statuses.at(-1)).toBe("Accepted: Design review. The organizer was told.");
    expect(view.readers.at(-1)?.invitation?.answered).toBe("ACCEPTED");
    await settle();
    expect(store.answers).toEqual({ [`${ACCOUNT}#m-invite#review-7@example.com`]: "ACCEPTED" });
  });

  it("finds the attendee among the recipients when no address is set, and refuses what it cannot answer", async () => {
    const { app, host, ran, settle } = await mount();
    await app.activate(INVITE_THREAD);
    await settle();
    await host.command("endue.mail.rsvp", { status: "declined" });
    expect((ran(`${CONNECTOR}.mail.send`)[0] as { subject: string }).subject).toBe(
      "Declined: Design review",
    );
    await expect(host.command("endue.mail.rsvp", { status: "later" })).rejects.toThrow(
      "later is not an answer",
    );
    await app.activate(LUNCH);
    await settle();
    await expect(host.command("endue.mail.rsvp", { status: "accepted" })).rejects.toThrow(
      "holds no invitation",
    );
  });

  it("a cancellation cannot be answered, and the card says it is cancelled", async () => {
    const cancelled = message({
      id: "m-cancel",
      title: "Cancelled: Design review",
      updatedAt: at("2026-10-30T08:00:00+09:00"),
      from: { name: "Mina", email: "mina@example.com" },
      to: [{ email: ME }],
      receivedAt: at("2026-10-30T08:00:00+09:00"),
      unread: false,
      raw: { calendar: INVITE.replace("METHOD:REQUEST", "METHOD:CANCEL") },
    });
    const { app, host, view, settle } = await mount({ items: [...sample(), cancelled] });
    await app.activate(`${ACCOUNT}#m-cancel`);
    await settle();
    expect(view.readers.at(-1)?.invitation).toMatchObject({
      cancelled: true,
      canAnswer: false,
      method: "CANCEL",
    });
    await expect(host.command("endue.mail.rsvp", { status: "accepted" })).rejects.toThrow(
      "A CANCEL is not an invitation to answer.",
    );
  });
});

describe("settings and state", () => {
  it("applies settings changed outside, and the account filter narrows the queries", async () => {
    const other = message(
      {
        id: "h-1",
        title: "Home",
        updatedAt: at("2026-10-30T08:50:00+09:00"),
        from: { email: "x@y.zz" },
        receivedAt: at("2026-10-30T08:50:00+09:00"),
        unread: false,
      },
      { connector: CONNECTOR, instance: "home" },
    );
    const { app, host, view, params } = await mount({ items: [...sample(), other] });
    expect(view.navs.at(-1)?.accounts).toEqual([`${CONNECTOR}/home`, ACCOUNT]);
    expect(view.shown()).toHaveLength(4);
    await app.setAccount(ACCOUNT);
    expect(view.shown()).toHaveLength(3);
    expect(params("data.query").at(-1)).toMatchObject({ query: { sources: [ACCOUNT] } });
    await expect(app.setAccount("nobody/x")).rejects.toThrow(
      "nobody/x is not a connected account.",
    );
    await host.call("settings.set", { key: "notify", value: false }, "endue.mail");
    await host.call("settings.set", { key: "addresses", value: [ME, 7] }, "endue.mail");
    await host.settle();
    // The addresses setting now names the person: a reply to all leaves them out.
    await app.setMailbox("inbox");
    await app.activate(LUNCH);
    await host.command("endue.mail.reply", { all: true });
    expect(view.draft()?.to).toBe("Mina <mina@example.com>");
    expect(NOW).toBeGreaterThan(0);
  });
});

describe("refresh without an account", () => {
  it("says so on the status line instead of staying quiet", async () => {
    const { host, view } = await mount({ items: [] });
    await host.command("endue.mail.refresh");
    expect(view.statuses.at(-1)).toBe("No mail account is connected yet.");
  });
});
