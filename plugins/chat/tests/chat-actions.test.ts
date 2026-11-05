import { describe, expect, it } from "vitest";
import { StubError } from "../../../packages/bridge/src/index";
import { SLACK } from "./chat-fixtures";
import { mount } from "./harness";

const GENERAL = "acme.slack/work@C1";
const RAIDS = "acme.discord/default@G1";
const target = (key: string) => `conversation:${key}`;
const pane = (view: Awaited<ReturnType<typeof mount>>["view"]) => {
  const main = view.last();
  if (main.layout !== "conversation" || !main.pane) throw new Error("no conversation open");
  return main.pane;
};

describe("sending", () => {
  it("shows the message at once, then the index's copy replaces it", async () => {
    const { app, view, ran, settle } = await mount();
    await app.openConversation(RAIDS);
    app.type(target(RAIDS), "  Count me in  ");
    await app.command("endue.chat.send", {});
    await settle();
    expect(ran("acme.discord.chat.send")).toEqual([
      { instance: "default", channel: "G1", text: "Count me in" },
    ]);
    expect(view.shown().at(-1)).toBe("Me: Count me in");
    expect(app.state().sending).toEqual([]);
    expect(pane(view).composer.text).toBe("");
    await expect(app.command("endue.chat.send", {})).rejects.toThrow("Write something first.");
  });

  it("an agent sends to a conversation it names, and into a thread", async () => {
    const { host, ran, settle } = await mount();
    await host.command("endue.chat.send", { source: SLACK, channel: "C2", text: "Looks great" });
    await host.command("endue.chat.send", {
      source: SLACK,
      channel: "C1",
      thread: "s-3",
      text: "+1",
    });
    await settle();
    expect(ran("acme.slack.chat.send")).toEqual([
      { instance: "work", channel: "C2", text: "Looks great" },
      { instance: "work", channel: "C1", text: "+1", thread: "s-3" },
    ]);
  });

  it("a refused message stays with Retry; Discard puts its text back", async () => {
    let fail = true;
    const { app, view, settle } = await mount({
      commands: {
        "acme.discord.chat.send": () => {
          if (fail) throw new Error("rate limited");
          return { id: "late" };
        },
      },
    });
    await app.openConversation(RAIDS);
    await app.command("endue.chat.send", { text: "hello?" }).catch(() => {});
    await settle();
    expect(view.shown().at(-1)).toBe("You: hello? (failed)");
    expect(view.statuses.at(-1)).toBe("Could not send: rate limited.");
    const [p] = app.state().sending;
    fail = false;
    await app.retry(p?.key ?? "");
    expect(app.state().sending[0]?.state).toBe("sent");
    expect(view.shown().at(-1)).toBe("You: hello? (sent)");
    fail = true;
    await app.command("endue.chat.send", { text: "again" }).catch(() => {});
    app.discard(app.state().sending.at(-1)?.key ?? "");
    expect(pane(view).composer.text).toBe("again");
  });

  it("a connector that cannot send says so, and its composer is off", async () => {
    const { app, view } = await mount({ actions: ["read", "react"] });
    await app.openConversation(RAIDS);
    expect(pane(view).composer.disabled).toBe("acme.discord cannot send messages.");
    await expect(app.command("endue.chat.send", { text: "x" })).rejects.toThrow(
      "acme.discord cannot send messages: it provides no acme.discord.chat.send.",
    );
  });

  it("drafts are kept per conversation in the store and come back after a restart", async () => {
    const store: Record<string, unknown> = {};
    const first = await mount({ store });
    await first.app.openConversation(GENERAL);
    first.app.type(target(GENERAL), "half a thought");
    await first.settle();
    expect(store.drafts).toEqual({ [target(GENERAL)]: "half a thought" });
    const second = await mount({ store });
    await second.app.openConversation(GENERAL);
    expect(pane(second.view).composer.text).toBe("half a thought");
  });
});

describe("acting on messages", () => {
  it("reactions toggle at once and go through the connector", async () => {
    const { app, view, ran, settle } = await mount();
    await app.openConversation(RAIDS);
    await app.command("endue.chat.react", {
      source: { connector: "acme.discord", instance: "default" },
      id: "d-1",
      emoji: ":+1:",
    });
    await settle();
    expect(ran("acme.discord.chat.react")).toEqual([
      { instance: "default", channel: "G1", id: "d-1", emoji: "👍", on: false },
    ]);
    const row = pane(view).rows.find((r) => r.key === "acme.discord/default#d-1");
    expect(row?.type === "message" && row.message.reactions).toEqual([
      { emoji: "👍", count: 2, self: false, label: "👍 2" },
    ]);
  });

  it("a refused reaction is undone and said", async () => {
    const { app, view } = await mount({
      commands: {
        "acme.discord.chat.react": () => {
          throw new Error("missing access");
        },
      },
    });
    await app.openConversation(RAIDS);
    app.select("acme.discord/default#d-2");
    await app.command("endue.chat.react", { emoji: "🎉" }).catch(() => {});
    const row = pane(view).rows.find((r) => r.key === "acme.discord/default#d-2");
    expect(row?.type === "message" && row.message.reactions.map((r) => r.emoji)).toEqual(["🔥"]);
    expect(view.statuses.at(-1)).toBe("Could not react: missing access.");
  });

  it("edits the person's newest message from the empty composer, and saves it on send", async () => {
    const { app, view, ran, settle } = await mount();
    await app.openConversation(RAIDS);
    await app.command("endue.chat.send", { text: "Im in" });
    await settle();
    await app.command("endue.chat.edit", { last: true, target: target(RAIDS) });
    expect(pane(view).composer).toMatchObject({ text: "Im in", editing: true });
    app.type(target(RAIDS), "I'm in");
    await app.command("endue.chat.send", {});
    await settle();
    expect(ran("acme.discord.chat.edit")).toEqual([
      { instance: "default", channel: "G1", id: "sent-1", text: "I'm in" },
    ]);
    const last = pane(view).rows.at(-1);
    expect(last?.type === "message" && last.message.edited).toBe(true);
    await expect(
      app.command("endue.chat.edit", { source: SLACK, id: "s-1", text: "x" }),
    ).rejects.toThrow("Only your own messages can be edited.");
  });

  it("deletes the person's own message after one confirmation", async () => {
    let answer = "keep";
    const { app, index, ran, settle } = await mount({ pick: () => answer });
    const own = { source: SLACK, id: "s-5" };
    expect(await app.command("endue.chat.delete", own)).toBe(false);
    answer = "delete";
    expect(await app.command("endue.chat.delete", own)).toBe(true);
    await settle();
    expect(ran("acme.slack.chat.delete")).toEqual([{ instance: "work", channel: "C1", id: "s-5" }]);
    expect(index.items.has("acme.slack/work/s-5")).toBe(false);
    await expect(app.command("endue.chat.delete", { source: SLACK, id: "s-1" })).rejects.toThrow(
      "Only your own messages can be deleted.",
    );
  });

  it("marks everything read, conversation by conversation", async () => {
    const { app, view, ran, settle } = await mount();
    expect(await app.command("endue.chat.mark-all-read", {})).toBe(5);
    await settle();
    expect(ran("acme.slack.chat.read")).toHaveLength(3);
    expect(view.chromes.at(-1)?.filters.find((f) => f.id === "unread")?.count).toBe("");
    expect(view.statuses.at(-1)).toBe("Marked 5 messages read.");
  });

  it("next unread walks the navigation's order and says when nothing is left", async () => {
    const { app, view, settle } = await mount({ init: { "endue.chat.mark-read": "never" } });
    expect(await app.command("endue.chat.next-unread", {})).toBe(RAIDS);
    expect(await app.command("endue.chat.next-unread", {})).toBe("acme.slack/work@C2");
    await app.command("endue.chat.mark-all-read", {});
    await settle();
    await expect(app.command("endue.chat.next-unread", {})).rejects.toThrow("Nothing unread.");
    expect(view.statuses.at(-1)).toBe("Nothing unread.");
  });

  it("saves messages for later and lists them under Saved", async () => {
    const store: Record<string, unknown> = {};
    const { app, view, settle } = await mount({ store });
    await app.command("endue.chat.save", { source: SLACK, id: "s-6" });
    expect(store.saved).toEqual(["acme.slack/work#s-6"]);
    await app.command("endue.chat.filter", { filter: "saved" });
    await app.command("endue.chat.layout", { layout: "timeline" });
    await settle();
    expect(view.shown().filter((l) => !l.startsWith("["))).toEqual([
      "Sora: @me can you review the mockups?",
    ]);
    expect(await app.command("endue.chat.save", { source: SLACK, id: "s-6" })).toBe(false);
    await settle();
    expect(view.last()).toMatchObject({
      layout: "timeline",
      empty: "Nothing saved yet. Press s on a message to save it.",
    });
  });

  it("pins conversations as columns, in pin order", async () => {
    const { app, view } = await mount();
    await app.command("endue.chat.layout", { layout: "columns" });
    await app.command("endue.chat.pin", { conversation: GENERAL });
    await app.command("endue.chat.pin", { conversation: RAIDS });
    const main = view.last();
    expect(main.layout === "columns" && main.columns.map((c) => `${c.name}:${c.pinned}`)).toEqual([
      "general:true",
      "raids:true",
    ]);
    expect(await app.command("endue.chat.pin", { conversation: GENERAL })).toBe(false);
  });

  it("opens only web and mail links", async () => {
    const { app, params, view } = await mount();
    await app.link("https://ci.example.com/1042");
    await app.link("javascript:alert(1)");
    expect(params("shell.open")).toEqual([
      {
        target: "https://ci.example.com/1042",
        scope: { permission: "shell:open", schemes: ["http", "https", "mailto"] },
      },
    ]);
    expect(view.statuses.at(-1)).toBe("Only web and mail links open from a message.");
  });
});

describe("permissions", () => {
  it("asks once for data:read on a refusal, then says it", async () => {
    let asks = 0;
    const { view } = await mount({
      handlers: {
        "data.query": () => {
          throw new StubError("permission_denied", "data:read is not granted");
        },
        "perm.request": () => {
          asks += 1;
          return { granted: false };
        },
      },
    });
    expect(asks).toBe(1);
    expect(view.statuses).toContain("Not allowed to read messages.");
  });
});
