import { describe, expect, it } from "vitest";
import { at, chat, DISCORD, SLACK } from "./chat-fixtures";
import { installed, mount, READ } from "./harness";

const GENERAL = "acme.slack/work@C1";
const RAIDS = "acme.discord/default@G1";

describe("one place for every chat", () => {
  it("lists every service's conversations by workspace, DMs together, mail left out", async () => {
    const { view, params } = await mount();
    expect(view.nav()).toEqual([
      "Gamers: #raids(1/0)",
      "Acme: #design(1/1)",
      "Acme: #general(2/0)",
      "Direct messages: Mina(1/1)",
      "Direct messages: Mina, Jun(0/0)",
    ]);
    const chrome = view.chromes.at(-1);
    expect(chrome?.platforms.map((p) => `${p.name}:${p.unread}`)).toEqual([
      "Discord:1",
      "Microsoft Teams:0",
      "Slack:4",
    ]);
    expect(chrome?.filters.map((f) => `${f.id}:${f.count}`)).toEqual([
      "all:",
      "unread:5",
      "mentions:1",
      "direct:1",
      "saved:",
    ]);
    expect(params("data.query").every((p) => (p as { scope: unknown }).scope !== undefined)).toBe(
      true,
    );
    expect(params("data.subscribe")).toEqual([
      {
        query: { kinds: ["message"], where: [{ field: "raw.channel", op: "exists" }] },
        scope: READ,
      },
    ]);
    expect(view.last()).toMatchObject({
      layout: "conversation",
      pane: null,
      empty: "Pick a conversation.",
    });
  });

  it("opens a conversation oldest first with its day, the New line and thread replies folded", async () => {
    const { app, view, ran } = await mount();
    await app.openConversation(GENERAL);
    const main = view.last();
    expect(main.layout === "conversation" && main.pane?.name).toBe("general");
    expect(view.shown()).toEqual([
      "[Today]",
      "Mina: Good morning team! 👋",
      "Jun: Morning! Standup at 10",
      "--new--",
      "Mina: Deploy is done build 1042",
    ]);
    // Opening marks it read through the connector, which syncs the index back.
    expect(ran("acme.slack.chat.read")).toEqual([{ instance: "work", channel: "C1", id: "s-5" }]);
    expect(view.nav()).toContain("Acme: #general(0/0)");
    const root = main.layout === "conversation" ? main.pane?.rows.at(-1) : undefined;
    expect(root?.type === "message" && root.message.replies).toBe(2);
  });

  it("opens a thread beside it and replies there", async () => {
    const { app, view, host, settle } = await mount();
    await host.command("endue.chat.show", { source: SLACK, id: "s-4" });
    await settle();
    const thread = view.threads.at(-1);
    expect(thread?.root.key).toBe("acme.slack/work#s-3");
    expect(thread?.rows.filter((r) => r.type === "message").map((r) => r.key)).toEqual([
      "acme.slack/work#s-4",
      "acme.slack/work#s-5",
    ]);
    const target = thread?.composer.target ?? "";
    app.type(target, "On it");
    await host.command("endue.chat.send", { target });
    await settle();
    const after = view.threads.at(-1);
    expect(after?.rows.filter((r) => r.type === "message").map((r) => r.message.author)).toEqual([
      "Jun",
      "Me",
      "Me",
    ]);
    expect(after?.composer.text).toBe("");
  });

  it("switches layouts: Inbox cards, the Timeline, Columns; and remembers them", async () => {
    const store: Record<string, unknown> = {};
    const { app, view } = await mount({ store });
    await app.command("endue.chat.layout", { layout: "inbox" });
    const inbox = view.last();
    expect(inbox.layout === "inbox" && inbox.cards.map((c) => c.name)).toEqual(
      ["D1", "design", "raids", "general"].map((n) => (n === "D1" ? "Mina" : n)),
    );
    await app.command("endue.chat.layout", { layout: "timeline" });
    expect(view.shown()[0]).toBe("[Today]");
    expect(view.shown()[1]).toMatch(/^Kai: /);
    await app.command("endue.chat.layout", { layout: "columns" });
    const columns = view.last();
    expect(columns.layout === "columns" && columns.columns.map((c) => c.name)).toEqual([
      "raids",
      "Mina",
      "design",
    ]);
    expect(store.view).toMatchObject({ layout: "columns" });
    await expect(app.command("endue.chat.layout", { layout: "grid" })).rejects.toThrow(
      /not a layout/,
    );
    const back = await mount({ store });
    expect(back.view.last().layout).toBe("columns");
  });

  it("narrows by service and filter; searches across services into the Timeline", async () => {
    const { app, view } = await mount();
    await app.command("endue.chat.platform", { platform: "discord" });
    expect(view.nav()).toEqual(["Gamers: #raids(1/0)"]);
    await app.command("endue.chat.platform", { platform: "all" });
    await app.command("endue.chat.filter", { filter: "direct" });
    expect(view.nav()).toEqual(["Direct messages: Mina(1/1)", "Direct messages: Mina, Jun(0/0)"]);
    await app.command("endue.chat.search", { text: "raid" });
    const main = view.last();
    expect(main.layout).toBe("timeline");
    expect(main.layout === "timeline" && main.title).toBe('Results for "raid"');
    await app.command("endue.chat.filter", { filter: "all" });
    expect(view.shown().filter((l) => !l.startsWith("["))).toHaveLength(1);
  });

  it("follows the index: a new mention arrives, is counted and announced", async () => {
    const { index, view, notices, settle } = await mount();
    index.upsert(
      chat(DISCORD, {
        id: "d-3",
        receivedAt: at(30, "09:00"),
        from: { name: "Rex" },
        unread: true,
        body: "@me are you in?",
        raw: { workspace: "Gamers", channel: "G1", channelName: "raids", mentioned: true },
      }),
    );
    await settle();
    expect(view.nav()[0]).toBe("Gamers: #raids(2/1)");
    expect(notices).toEqual([{ title: "Rex in #raids · Discord", body: "@me are you in?" }]);
    index.remove(DISCORD, "d-3");
    await settle();
    expect(view.nav()[0]).toBe("Gamers: #raids(1/0)");
  });

  it("names the installed message connectors when no chat account is connected", async () => {
    const handlers = installed(
      ["acme.slack", "Slack", ["message"]],
      ["desk.github", "GitHub", ["task"]],
    );
    const { app, view, params } = await mount({ items: [], handlers });
    expect(view.last()).toMatchObject({ layout: "conversation", pane: null });
    expect(view.chromes.at(-1)?.connected).toBe(false);
    expect(params("connector.list")).toContainEqual({ scope: { permission: "connector:manage" } });
    const said =
      "No chat account is connected yet. Connect Slack and your conversations show here.";
    expect(view.last().empty).toBe(said);
    for (const layout of ["inbox", "columns", "timeline"]) {
      await app.command("endue.chat.layout", { layout });
      expect(view.last()).toMatchObject({ layout, empty: said });
    }
  });

  it("says no installed connector brings messages when none is installed", async () => {
    const { app, view } = await mount({
      items: [],
      handlers: installed(["desk.github", "GitHub", ["task"]]),
    });
    const said = "No installed connector brings messages yet.";
    expect(view.last()).toMatchObject({ layout: "conversation", pane: null, empty: said });
    for (const layout of ["inbox", "columns", "timeline"]) {
      await app.command("endue.chat.layout", { layout });
      expect(view.last()).toMatchObject({ layout, empty: said });
    }
  });

  it("the palette finds conversations by name, workspace or service", async () => {
    const { app } = await mount();
    const found = (await app.command("endue.chat.find", { query: "acme gen", limit: 5 })) as {
      results: Array<{ id: string; title: string; detail: string }>;
    };
    expect(found.results).toEqual([
      expect.objectContaining({
        id: GENERAL,
        title: "#general",
        detail: "Slack · Acme · 2 unread",
      }),
    ]);
    const none = (await app.command("endue.chat.find", { query: "" })) as { results: unknown[] };
    expect(none.results).toEqual([]);
    void RAIDS;
  });
});
