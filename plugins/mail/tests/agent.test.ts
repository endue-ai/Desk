// What Eris reads and sends through the mail plugin (ADR 0088): messages found by words, a message
// with its thread, a message sent straight from the account, and the person's commands naming a
// message by { source, id } — each leaving the screen and the composer as they are.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { PluginManifest } from "../../../packages/bridge/src/index";
import { ACCOUNT, CONNECTOR, mount, SOURCE } from "./harness";

type Brief = { source: unknown; id: string; subject: string };

describe("an agent's mail commands", () => {
  it("latest names each message by source and id, which read opens as data", async () => {
    const { host, view } = await mount();
    const before = view.shown();
    const latest = (await host.command("endue.mail.latest", { limit: 1 })) as {
      messages: Brief[];
    };
    expect(latest.messages[0]).toMatchObject({ source: SOURCE, id: "m-lunch", thread: "t-lunch" });
    const read = (await host.command("endue.mail.read", { source: SOURCE, id: "m-lunch" })) as {
      subject: string;
      body: string;
      unread: boolean;
      truncated: boolean;
      threadMessages: Array<{ id: string }>;
    };
    expect(read).toMatchObject({
      subject: "Lunch today?",
      body: "Still on for 12:30 at the bistro?",
      unread: true,
      truncated: false,
    });
    expect(read.threadMessages.map((m) => m.id)).toEqual(["m-lunch-1"]);
    // Reading marks nothing read and moves nothing on screen.
    expect(view.shown()).toEqual(before);
    await expect(host.command("endue.mail.read", { source: SOURCE, id: "nope" })).rejects.toThrow(
      "There is no message nope.",
    );
  });

  it("finds messages by words, and refuses empty words", async () => {
    const { host } = await mount();
    const found = (await host.command("endue.mail.find", { text: "build" })) as {
      messages: Brief[];
      text: string;
    };
    expect(found.messages.map((m) => m.id)).toEqual(["m-build"]);
    expect(found.text).toBe('1 found in Inbox for "build".');
    await expect(host.command("endue.mail.find", { text: " " })).rejects.toThrow(/empty/);
  });

  it("sends a new message from the account, and a reply in a thread, without the composer", async () => {
    const { host, ran, app } = await mount({ settings: { signature: "Ada" } });
    const sent = await host.command("endue.mail.send-message", {
      to: "Kim <kim@example.com>",
      subject: "Notes",
      body: "Here they are.",
      account: ACCOUNT,
    });
    expect(sent).toMatchObject({ sent: true, account: ACCOUNT, subject: "Notes" });
    const reply = await host.command("endue.mail.send-message", {
      replyTo: { source: SOURCE, id: "m-lunch" },
      body: "Yes, see you there.",
    });
    expect(reply).toMatchObject({ subject: "Re: Lunch today?", account: ACCOUNT });
    const [first, second] = ran(`${CONNECTOR}.mail.send`) as Array<Record<string, unknown>>;
    expect(first).toMatchObject({
      instance: "work",
      to: [{ name: "Kim", email: "kim@example.com" }],
      body: "Here they are.\n\nAda",
    });
    expect(second).toMatchObject({ inReplyTo: "<lunch-2@example.com>" });
    expect(String(second?.body)).toMatch(
      /^Yes, see you there\.\n\nAda\n\nOn .* wrote:\n> Still on/,
    );
    expect(app.writing.composing()).toBeNull();
    await expect(
      host.command("endue.mail.send-message", { subject: "x", account: ACCOUNT }),
    ).rejects.toThrow("Add at least one recipient.");
  });

  it("archives and flags a message it names, not the open one", async () => {
    const { host, index } = await mount();
    await host.command("endue.mail.flag", { source: SOURCE, id: "m-build", flagged: true });
    await host.command("endue.mail.archive", { source: SOURCE, id: "m-build" });
    const item = index.items.get(`${CONNECTOR}/work/m-build`) as { raw: Record<string, unknown> };
    expect(item.raw).toMatchObject({ flagged: true, mailbox: "archive" });
  });

  it("opens a named reply or forward for review and preserves the previous draft", async () => {
    const { host, app, store, view, ran, settle } = await mount();
    const before = await host.command("endue.mail.compose", { subject: "Existing draft" });
    app.writing.edit({ body: "Unflushed typing" });
    const original = { source: SOURCE, id: "m-lunch" };
    await host.command("endue.mail.compose", {
      replyTo: original,
      all: true,
      body: "I can make it",
    });
    expect(view.draft()).toMatchObject({
      subject: "Re: Lunch today?",
      replyTo: original,
      body: expect.stringContaining("I can make it"),
    });
    await host.command("endue.mail.compose", { forward: original });
    expect(view.draft()).toMatchObject({ subject: "Fwd: Lunch today?", to: "" });
    expect(view.draft()?.body).toContain("Still on for 12:30");
    await settle();
    expect(store.drafts).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: before, body: "Unflushed typing" })]),
    );
    expect(ran(`${CONNECTOR}.mail.send`)).toEqual([]);
  });

  it("reads and edits the current composer without sending it", async () => {
    const { host, view, ran } = await mount();
    expect(await host.command("endue.mail.draft")).toBeNull();
    const id = await host.command("endue.mail.compose", { subject: "First", body: "Keep this" });
    const fields = { to: "reviewer@example.test", cc: "", subject: "Second" };
    await host.command("endue.mail.edit-draft", fields);
    expect(await host.command("endue.mail.draft")).toMatchObject({
      ...fields,
      id,
      body: "Keep this",
    });
    expect(view.draft()).toMatchObject({ ...fields, body: "Keep this" });
    expect(ran(`${CONNECTOR}.mail.send`)).toEqual([]);
  });

  it("forwards through the existing send action and leaves the composer untouched", async () => {
    const { host, view, ran } = await mount();
    const id = await host.command("endue.mail.compose", { subject: "Still writing" });
    const original = { source: SOURCE, id: "m-lunch" };
    await host.command("endue.mail.send-message", {
      forward: original,
      to: "reviewer@example.test",
      body: "For your reference.",
    });
    expect(ran(`${CONNECTOR}.mail.send`)).toMatchObject([
      {
        instance: "work",
        subject: "Fwd: Lunch today?",
        body: expect.stringMatching(/^For your reference\.[\s\S]*Forwarded message/),
      },
    ]);
    expect(view.draft()).toMatchObject({ id, subject: "Still writing" });
    await expect(
      host.command("endue.mail.send-message", { replyTo: original, forward: original }),
    ).rejects.toThrow(/reply.*forward/i);
  });

  it.each(["archive", "trash"])("moves a named message back to Inbox from %s", async (mailbox) => {
    const { host, ran, index } = await mount();
    const original = { source: SOURCE, id: "m-build" };
    await host.command(`endue.mail.${mailbox}`, original);
    await host.command("endue.mail.move", { ...original, mailbox: "inbox" });
    expect(ran(`${CONNECTOR}.mail.move`)).toMatchObject([
      { id: "m-build", mailbox },
      { id: "m-build", mailbox: "inbox" },
    ]);
    expect(index.items.get(`${ACCOUNT}/m-build`)).toMatchObject({ raw: { mailbox: "inbox" } });
    await expect(
      host.command("endue.mail.move", { ...original, mailbox: "flagged" }),
    ).rejects.toThrow(/mailbox/i);
  });
});

describe("the manifest offers them to agents", () => {
  const manifest = JSON.parse(
    readFileSync(join(import.meta.dirname, "../plugin.json"), "utf8"),
  ) as PluginManifest;
  const byId = (id: string) =>
    manifest.contributes?.commands?.find((c) => c.id === `endue.mail.${id}`);

  it("marks reads read-only, sending and answering invitations irreversible", () => {
    for (const id of ["latest", "find", "read", "draft"])
      expect(byId(id), id).toMatchObject({ agent: true, readOnly: true });
    for (const id of ["send-message", "rsvp"])
      expect(byId(id), id).toMatchObject({ agent: true, irreversible: true });
    for (const id of [
      "show",
      "archive",
      "trash",
      "flag",
      "toggle-unread",
      "compose",
      "edit-draft",
      "move",
    ])
      expect(byId(id), id).toMatchObject({ agent: true, args: { additionalProperties: false } });
    // The person answers from the open message, with no args from the palette.
    expect(byId("rsvp")?.args?.required).toBeUndefined();
    // The person's composer: sending it stays theirs.
    expect(byId("send")?.agent).toBeUndefined();
  });
});
