import { FIXTURE_CONNECTOR, type Item, type UniversalView } from "@endue-ai/bridge";
import { beforeEach, describe, expect, it, vi } from "vitest";
// The universal view element and the small DOM it runs on in Node, from @endue-ai/ui's own tests.
import "../../ui/src/elements/test-dom";
import { defineElements } from "../../ui/src/elements/index";
import { reset } from "../../ui/src/elements/test-dom";
import {
  assetUrl,
  BridgeCallError,
  defineUiPlugin,
  entriesFromItems,
  fillArgs,
  UniversalError,
} from "./index";
import { createTestHost, type TestHostOptions } from "./testing/index";

defineElements();

const BOARD = `universal: v0
title: Launch
map: { group: column }
entries:
  - id: t1
    title: Write the spec
    column: done
  - id: t2
    title: Build
    column: doing
`;

async function mounted(options: Omit<TestHostOptions, "pluginId"> = {}) {
  const host = createTestHost({ pluginId: "example.board", ...options });
  const ctx = await defineUiPlugin({ mount() {} }, host.transport);
  return { host, ctx };
}

const flush = async (host: { settle(): Promise<void> }) => {
  for (let i = 0; i < 4; i++) {
    await host.settle();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

describe("ctx.universal.load", () => {
  it("reads inline data, a desk file and a URL as one format", async () => {
    const fetched = vi.fn(() => ({
      status: 200,
      headers: {},
      body: BOARD,
      bodyEncoding: "utf8" as const,
    }));
    const { host, ctx } = await mounted({
      files: { "~/boards/launch.yaml": BOARD },
      grants: [{ permission: "fs:read", paths: ["~/boards/**"] }],
      handlers: { "net.fetch": fetched },
    });
    const inline = await ctx.universal.load({ data: { entries: [{ title: "Here" }] } });
    expect(inline.entries).toEqual([{ title: "Here" }]);

    const file = await ctx.universal.load({ file: "~/boards/launch.yaml" });
    expect(file.title).toBe("Launch");
    expect(file.entries.map((entry) => entry.id)).toEqual(["t1", "t2"]);
    expect(host.calls.find((call) => call.method === "fs.read")?.params).toMatchObject({
      path: "~/boards/launch.yaml",
      scope: { permission: "fs:read", paths: ["~/boards/launch.yaml"] },
    });

    const url = await ctx.universal.load({ url: "https://tasks.example.com:8443/launch.yaml" });
    expect(url).toEqual(file);
    expect((fetched.mock.calls as unknown[][])[0]?.[0]).toMatchObject({
      url: "https://tasks.example.com:8443/launch.yaml",
      scope: { permission: "net:fetch", hosts: ["tasks.example.com:8443"] },
    });
  });

  it("asks another plugin's command and takes its answer as an object or as YAML", async () => {
    const { ctx } = await mounted({
      grants: [{ permission: "cmd:invoke", ids: ["example.feed.*"] }],
      commands: {
        "example.feed.object": () => ({ entries: [{ id: "o" }] }),
        "example.feed.yaml": (args) => `- id: y\n  board: ${(args as { board: string }).board}\n`,
      },
    });
    expect((await ctx.universal.load({ command: "example.feed.object" })).entries).toEqual([
      { id: "o" },
    ]);
    const yaml = await ctx.universal.load({ command: "example.feed.yaml", args: { board: "b1" } });
    expect(yaml.entries).toEqual([{ id: "y", board: "b1" }]);
  });

  it("turns the desk's items into entries with their kinds' roles", async () => {
    const { ctx } = await mounted({ grants: [{ permission: "data:read" }] });
    const data = await ctx.universal.load({ items: { kinds: ["task"], limit: 2 } });
    expect(data.entries.length).toBe(2);
    expect(data.entries[0]).toMatchObject({
      kind: "task",
      source: { connector: FIXTURE_CONNECTOR },
    });
    expect(typeof data.entries[0]?.group).toBe("string");
  });

  it("rejects what is not the format, a failed fetch and a refused read", async () => {
    const { ctx } = await mounted({
      handlers: {
        "net.fetch": () => ({ status: 404, headers: {}, body: "no", bodyEncoding: "utf8" }),
      },
      files: { "~/a.yaml": "title: no entries\n" },
    });
    await expect(ctx.universal.load({ url: "https://example.com/a.yaml" })).rejects.toThrow(
      "404 from example.com",
    );
    await expect(ctx.universal.load({ file: "~/a.yaml" })).rejects.toBeInstanceOf(BridgeCallError);
    expect(() => ctx.universal.parse("title: no entries\n")).toThrow(UniversalError);
    expect(() => ctx.universal.parse("entries: [1, {a: b}]\n")).toThrow("entries/0: not an object");
    expect(() => ctx.universal.parse("universal: v9\nentries: []\n")).toThrow("is not v0");
    expect(ctx.universal.parse("- a: 1\n").entries).toEqual([{ a: 1 }]);
  });
});

describe("the helpers", () => {
  it("fill action args from the entry: one placeholder keeps its type, braces escape", () => {
    const scope = { id: "t1", estimate: 3, raw: { owner: "Mina" }, move: { to: "done" } };
    expect(
      fillArgs(
        { id: "{id}", n: "{estimate}", to: "{move.to}", text: "{raw.owner} {{x}}", list: ["{id}"] },
        scope,
      ),
    ).toEqual({ id: "t1", n: 3, to: "done", text: "Mina {x}", list: ["t1"] });
    expect(fillArgs("{missing}", scope)).toBe("");
  });

  it("find assets under the plugin's folder on the desk's scheme, else next to the frame", () => {
    expect(
      assetUrl(
        "example.board",
        "data/b.yaml",
        "desk-plugin://localhost/example.board/ui/index.html",
      ),
    ).toBe("desk-plugin://localhost/example.board/data/b.yaml");
    expect(assetUrl("example.board", "b.yaml", "http://127.0.0.1:5173/plugins/x/index.html")).toBe(
      "http://127.0.0.1:5173/plugins/x/b.yaml",
    );
  });

  it("give an all-day event its date and a message its sender", () => {
    const source = { connector: "c", instance: "i" };
    const items: Item[] = [
      {
        kind: "event",
        id: "e",
        source,
        title: "Holiday",
        updatedAt: "2026-11-01T00:00:00Z",
        start: "2026-11-04T00:00:00+09:00",
        end: "2026-11-05T00:00:00+09:00",
        allDay: true,
      },
      {
        kind: "message",
        id: "m",
        source,
        title: "Hi",
        updatedAt: "2026-11-01T00:00:00Z",
        from: { name: "Mina" },
        receivedAt: "2026-11-01T09:00:00Z",
        unread: true,
        snippet: "Lunch?",
      },
    ];
    const [event, message] = entriesFromItems(items);
    expect(event).toMatchObject({ start: "2026-11-04", end: "2026-11-05T00:00:00+09:00" });
    expect(message).toMatchObject({
      author: "Mina",
      start: "2026-11-01T09:00:00Z",
      status: "unread",
      text: "Lunch?",
    });
  });

  it("give a run its state as its column, its agent as its author and its approval (ADR 0100)", () => {
    const source = { connector: "desk.agents", instance: "default" };
    const items: Item[] = [
      {
        kind: "run",
        id: "run-4",
        source,
        title: "Local agents: hand an agent a task",
        updatedAt: "2026-11-05T09:31:00Z",
        agent: "eris",
        state: "waiting",
        startedAt: "2026-11-05T09:31:00Z",
        command: "endue.local-agents.work",
        approval: "a-7",
      },
      {
        kind: "run",
        id: "run-3",
        source,
        title: "Latest mail",
        updatedAt: "2026-11-05T09:30:05Z",
        agent: "eris",
        state: "done",
        startedAt: "2026-11-05T09:30:01Z",
        endedAt: "2026-11-05T09:30:05Z",
        result: "2 new messages",
      },
    ];
    const [waiting, done] = entriesFromItems(items);
    expect(waiting).toMatchObject({
      group: "waiting",
      status: "waiting",
      author: "eris",
      start: "2026-11-05T09:31:00Z",
      approval: "a-7",
      tags: ["endue.local-agents.work"],
    });
    expect(done).toMatchObject({
      group: "done",
      end: "2026-11-05T09:30:05Z",
      detail: "2 new messages",
    });
    expect(done).not.toHaveProperty("approval");
  });
});

describe("ctx.universal.open", () => {
  beforeEach(reset);

  const board: UniversalView = {
    type: "kanban",
    source: { file: "~/boards/launch.yaml" },
    options: { groups: ["todo", "doing", "done"] },
    actions: [{ command: "example.tasks.open", args: { id: "{id}" } }],
    move: { command: "example.tasks.move", args: { id: "{id}", to: "{move.to}" } },
  };

  it("draws the view, loads its source and runs its commands with the entry's args", async () => {
    const moved = vi.fn(() => ({ ok: true }));
    const opened = vi.fn(() => ({ ok: true }));
    const { host, ctx } = await mounted({
      files: { "~/boards/launch.yaml": BOARD },
      grants: [
        { permission: "fs:read", paths: ["~/boards/**"] },
        { permission: "cmd:invoke", ids: ["example.tasks.*"] },
      ],
      commands: { "example.tasks.open": opened, "example.tasks.move": moved },
    });
    const handle = ctx.universal.open(document.body, board);
    expect(handle.element.getAttribute("state")).toBe("loading");
    await flush(host);
    expect(handle.element.getAttribute("state")).toBe("ready");
    expect(handle.data?.title).toBe("Launch");
    const element = handle.element as unknown as HTMLElement & { rows: Array<{ key: string }> };
    expect(element.rows.map((row) => row.key)).toEqual(["t1", "t2"]);

    element.dispatchEvent(
      new CustomEvent("desk-select", { detail: { entry: handle.data?.entries[1] } }),
    );
    element.focus();
    // Shift+Right on t2 (doing) moves it to done.
    const card = (element.shadowRoot as unknown as { activeElement: HTMLElement }).activeElement;
    card.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowRight",
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    await flush(host);
    expect(opened).toHaveBeenCalledWith({ id: "t2" });
    expect(moved).toHaveBeenCalledWith({ id: "t2", to: "done" });
    expect(handle.data?.entries[1]).toMatchObject({ column: "done" });
    handle.close();
    expect(handle.element.isConnected).toBe(false);
  });

  it("says denied when the source is refused, and the error otherwise", async () => {
    const errors: unknown[] = [];
    const { host, ctx } = await mounted({ files: { "~/boards/launch.yaml": BOARD } });
    const refused = ctx.universal.open(document.body, board, { onError: (e) => errors.push(e) });
    await flush(host);
    expect(refused.element.getAttribute("state")).toBe("denied");
    expect(errors[0]).toBeInstanceOf(BridgeCallError);
    const broken = ctx.universal.open(document.body, {
      type: "list",
      source: { command: "example.nobody.serves" },
    });
    await flush(host);
    expect(broken.element.getAttribute("state")).toBe("error");
    expect(broken.element.getAttribute("message")).toBeTruthy();
  });

  it("keeps an items source live: a change in the index loads the view again", async () => {
    const { host, ctx } = await mounted({ grants: [{ permission: "data:read" }] });
    const handle = ctx.universal.open(document.body, {
      type: "list",
      source: {
        items: { kinds: ["task"], where: [{ field: "title", op: "eq", value: "New one" }] },
      },
    });
    await flush(host);
    expect(handle.data?.entries).toEqual([]);
    host.upsert({
      kind: "task",
      id: "task-new",
      source: { connector: FIXTURE_CONNECTOR, instance: "default" },
      title: "New one",
      updatedAt: "2026-10-30T09:00:00+09:00",
      status: "open",
    });
    await flush(host);
    expect(handle.data?.entries.map((entry) => entry.id)).toEqual(["task-new"]);
    handle.close();
    await flush(host);
    expect(host.calls.some((call) => call.method === "data.unsubscribe")).toBe(true);
  });

  it("sends the composer's text through the send command and loads again", async () => {
    let said: string[] = [];
    const { host, ctx } = await mounted({
      grants: [{ permission: "cmd:invoke", ids: ["example.chat.*"] }],
      commands: {
        "example.chat.log": () => ({ entries: said.map((text) => ({ author: "me", text })) }),
        "example.chat.say": (args) => {
          said = [...said, (args as { text: string }).text];
          return {};
        },
      },
    });
    const handle = ctx.universal.open(document.body, {
      type: "chat",
      source: { command: "example.chat.log" },
      send: { command: "example.chat.say", args: { text: "{send.text}" } },
    });
    await flush(host);
    handle.element.dispatchEvent(
      new CustomEvent("desk-send", { detail: { text: "Hello" }, cancelable: true }),
    );
    await flush(host);
    expect(said).toEqual(["Hello"]);
    expect(handle.data?.entries).toEqual([{ author: "me", text: "Hello" }]);
  });
});
