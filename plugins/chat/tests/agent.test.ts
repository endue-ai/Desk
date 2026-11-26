// What Eris reads through the chat plugin (ADR 0088): the conversations with their unread counts, a
// conversation's or a thread's messages and messages found by words, as data, leaving the screen as
// it is; and the commands she acts with, offered to agents in the manifest.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { PluginManifest } from "../../../packages/bridge/src/index";
import { DISCORD, SLACK } from "./chat-fixtures";
import { mount } from "./harness";

type Msg = { id: string; author: string; text: string; self: boolean };

describe("an agent's chat commands", () => {
  it("answers the conversations, narrowed by service, unread and name", async () => {
    const { host } = await mount();
    const all = (await host.command("endue.chat.conversations")) as {
      conversations: Array<{ source: unknown; channel: string; name: string; unread: number }>;
      unread: number;
    };
    expect(all.conversations.map((c) => c.name)).toContain("general");
    expect(all.unread).toBeGreaterThan(0);
    const general = all.conversations.find((c) => c.name === "general");
    expect(general).toMatchObject({ source: SLACK, channel: "C1", platform: "Slack" });
    const discord = (await host.command("endue.chat.conversations", { platform: "discord" })) as {
      conversations: Array<{ name: string }>;
    };
    expect(discord.conversations.map((c) => c.name)).toEqual(["raids"]);
    const unread = (await host.command("endue.chat.conversations", { unread: true })) as {
      conversations: Array<{ unread: number }>;
    };
    expect(unread.conversations.every((c) => c.unread > 0)).toBe(true);
    const named = (await host.command("endue.chat.conversations", { query: "desi" })) as {
      conversations: Array<{ name: string }>;
    };
    expect(named.conversations.map((c) => c.name)).toEqual(["design"]);
  });

  it("reads a conversation oldest first and a thread's replies, leaving the screen alone", async () => {
    const { host, view } = await mount();
    const before = view.shown();
    const general = (await host.command("endue.chat.messages", {
      source: SLACK,
      channel: "C1",
    })) as {
      messages: Msg[];
    };
    expect(general.messages.map((m) => m.id).slice(0, 3)).toEqual(["s-1", "s-2", "s-3"]);
    const thread = (await host.command("endue.chat.messages", {
      source: SLACK,
      channel: "C1",
      thread: "s-3",
    })) as { root: Msg; messages: Msg[] };
    expect(thread.root.id).toBe("s-3");
    expect(thread.messages.map((m) => [m.id, m.self])).toEqual([
      ["s-4", false],
      ["s-5", true],
    ]);
    expect(view.shown()).toEqual(before);
    await expect(host.command("endue.chat.messages", { channel: "C1" })).rejects.toThrow(
      /Name the conversation/,
    );
  });

  it("finds messages by words across accounts", async () => {
    const { host } = await mount();
    const found = (await host.command("endue.chat.find-messages", { text: "lunch" })) as {
      messages: Msg[];
    };
    expect(found.messages.map((m) => m.id)).toEqual(["s-7"]);
    await expect(host.command("endue.chat.find-messages", { text: " " })).rejects.toThrow(/empty/);
  });

  it("reads the open conversation and selection without changing the view", async () => {
    const { app, host, ran, view } = await mount({ settings: { "mark-read": "manual" } });
    await app.openConversation("acme.slack/work@C1");
    await app.activate("acme.slack/work#s-3");
    const before = view.shown();
    expect(await host.command("endue.chat.current")).toMatchObject({
      layout: "conversation",
      filter: "all",
      platform: null,
      search: "",
      conversation: { source: SLACK, channel: "C1" },
      thread: { source: SLACK, id: "s-3" },
      selection: { source: SLACK, id: "s-3" },
    });
    expect(await host.command("endue.chat.messages")).toMatchObject({
      source: SLACK,
      channel: "C1",
      messages: expect.arrayContaining([expect.objectContaining({ id: "s-1" })]),
    });
    expect(view.shown()).toEqual(before);
    expect(ran("acme.slack.chat.read")).toEqual([]);
    await expect(host.command("endue.chat.messages", { channel: "C2" })).rejects.toThrow(
      /Name the conversation/,
    );
  });

  it("prepares a threaded draft without sending, marking read or replacing a person's draft", async () => {
    const { app, host, ran, view } = await mount();
    const destination = { source: SLACK, channel: "C1", thread: "s-3" };
    await host.command("endue.chat.draft", { ...destination, text: "Ready for review" });
    expect(view.threads.at(-1)?.composer.text).toBe("Ready for review");
    expect(view.focused.at(-1)).toBe("thread");
    expect(ran("acme.slack.chat.send")).toEqual([]);
    expect(ran("acme.slack.chat.read")).toEqual([]);
    app.type("thread:acme.slack/work#s-3", "A person's unsent words");
    await expect(
      host.command("endue.chat.draft", { ...destination, text: "A replacement" }),
    ).rejects.toThrow(/draft/i);
    await expect(
      host.command("endue.chat.draft", { ...destination, channel: "C2", text: "Wrong thread" }),
    ).rejects.toThrow(/thread/i);
    expect(app.state().drafts["thread:acme.slack/work#s-3"]).toBe("A person's unsent words");
  });

  it("finds saved messages and marks only the named platform read", async () => {
    const { host, ran } = await mount();
    await host.command("endue.chat.save", { source: SLACK, id: "s-7" });
    expect(await host.command("endue.chat.find-messages", { saved: true })).toMatchObject({
      messages: [expect.objectContaining({ id: "s-7" })],
    });
    await host.command("endue.chat.mark-all-read", { platform: "discord" });
    expect(ran("acme.discord.chat.read")).toHaveLength(1);
    expect(ran("acme.slack.chat.read")).toEqual([]);
  });

  it("sets reaction state idempotently and leaves a toggle when on is omitted", async () => {
    const { host, ran } = await mount();
    const reaction = { source: DISCORD, id: "d-1", emoji: "👍" };
    expect(await host.command("endue.chat.react", { ...reaction, on: true })).toBe(true);
    expect(ran("acme.discord.chat.react")).toEqual([]);
    expect(await host.command("endue.chat.react", { ...reaction, on: false })).toBe(false);
    expect(await host.command("endue.chat.react", reaction)).toBe(true);
    expect(ran("acme.discord.chat.react")).toMatchObject([{ on: false }, { on: true }]);
  });

  it("uses the core's delivered agent invocation without opening a second delete palette", async () => {
    const { host, ran, settle } = await mount();
    host.emit({
      event: "cmd.invoked",
      data: {
        id: "endue.chat.delete",
        invocationId: "reviewed-delete",
        caller: "agent:eris",
        args: { source: SLACK, id: "s-5" },
      },
    });
    await settle();
    expect(ran("desk.palette.pick")).toEqual([]);
    expect(ran("acme.slack.chat.delete")).toMatchObject([{ id: "s-5" }]);
  });
});

describe("the manifest offers them to agents", () => {
  const manifest = JSON.parse(
    readFileSync(join(import.meta.dirname, "../plugin.json"), "utf8"),
  ) as PluginManifest;
  const byId = (id: string) =>
    manifest.contributes?.commands?.find((c) => c.id === `endue.chat.${id}`);

  it("marks the reads read-only, send and delete irreversible, and names every target", () => {
    for (const id of ["conversations", "current", "messages", "find-messages"])
      expect(byId(id), id).toMatchObject({ agent: true, readOnly: true });
    for (const id of ["send", "edit", "delete", "react"])
      expect(byId(id), id).toMatchObject({ agent: true, irreversible: true });
    for (const id of ["show", "conversation", "react", "edit", "mark-read", "save", "pin"])
      expect(byId(id), id).toMatchObject({ agent: true, args: { additionalProperties: false } });
    // The person runs these from the palette with no args (the composer's draft, a picker): the
    // core checks every caller's args, so none of them requires one.
    for (const id of ["send", "react", "edit"])
      expect(byId(id)?.args?.required, id).toBeUndefined();
    for (const id of [
      "draft",
      "layout",
      "filter",
      "platform",
      "search",
      "next-unread",
      "mark-all-read",
    ])
      expect(byId(id), id).toMatchObject({
        agent: true,
        description: expect.any(String),
        args: { additionalProperties: false },
      });
  });
});
