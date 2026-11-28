// The controller on the SDK's test host: the connector's state, the session items read and kept
// current, the agent tools, notes written into the knowledge folder.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Permission } from "../../../packages/bridge/src/index";
import { defineUiPlugin } from "../../../packages/plugin-sdk/src/index";
import { createTestHost } from "../../../packages/plugin-sdk/src/testing/index";
import { MANAGE, READ, WRITE } from "../ui/kinds.js";
import { startPlugin } from "../ui/plugin.js";
import { SOURCE, sample, session } from "./fixtures";

const INVOKE: Permission = { permission: "cmd:invoke", ids: ["desk.files.open"] };
const wait = (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms));

type Handlers = NonNullable<Parameters<typeof createTestHost>[0]["handlers"]>;
type Row = { id: string; key: string; kind: string; sessions: number };
/** What the controller hands the view, as far as these tests read it. */
interface Screen {
  status: string;
  mode: string;
  selectedId: string | null;
  scene?: { ids: string[]; x: Float32Array };
  only?: Set<number>;
  counts: { agents: Record<string, number> };
  panel?: { title: string };
  note?: { markdown: string };
}
type Found = { entities: Row[]; sessions: Row[] };
type Related = { id: string; sessions: Row[]; together: Row[]; alike: Row[] };

async function mount({ connected = true, items = sample() } = {}) {
  const screens: Screen[] = [];
  const opened: unknown[] = [];
  const connects: unknown[] = [];
  const instance = (state: string) => ({
    connector: SOURCE.connector,
    instance: "default",
    status: { state },
  });
  let instances = connected ? [instance("connected")] : [];
  const handlers = {
    "connector.list": () => ({
      connectors: [{ id: SOURCE.connector, instances, resources: [{ kind: "record" }] }],
    }),
    "connector.connect": (params: unknown) => {
      connects.push(params);
      instances = [instance("syncing")];
      return { instance: "default" };
    },
    "connector.sync": () => ({ started: true }),
  };
  const host = createTestHost({
    pluginId: "endue.knowledge",
    grants: [READ, MANAGE, WRITE, INVOKE] as Permission[],
    settings: { hub: 20 },
    files: {},
    handlers: handlers as unknown as Handlers,
    commands: {
      "desk.files.open": (args) => {
        opened.push(args);
        return {};
      },
    },
  });
  for (const item of items) host.upsert(item);
  // The runtime registers what the manifest contributes, as the plugin, when it mounts.
  const manifest = JSON.parse(readFileSync(join(import.meta.dirname, "../plugin.json"), "utf8"));
  for (const { id, title } of manifest.contributes.commands as Array<{ id: string; title: string }>)
    await host.call("cmd.register", { id, title }, "endue.knowledge");
  let app: ReturnType<typeof startPlugin> | undefined;
  await defineUiPlugin(
    {
      async mount(ctx) {
        app = startPlugin(ctx, { render: (s: Screen) => screens.push(s) }, { settle: 0 });
        await app.start();
      },
    },
    host.transport,
  );
  await host.settle();
  if (!app) throw new Error("the plugin did not mount");
  const last = () => {
    const screen = screens.at(-1);
    if (!screen) throw new Error("nothing was rendered");
    return screen;
  };
  return { host, opened, connects, app, last };
}

describe("the controller", () => {
  it("asks to connect before reading anything, and connects desk.agent-sessions when told", async () => {
    const { host, last, connects } = await mount({ connected: false });
    expect(last().status).toBe("off");
    expect(last().scene).toBeUndefined();
    expect(host.calls.some((c) => c.method === "data.query")).toBe(false);
    await host.invoke("endue.knowledge.connect");
    expect(connects).toEqual([
      { connector: "desk.agent-sessions", scope: { permission: "connector:manage" } },
    ]);
    expect(last().status).toBe("reading");
  });

  it("reads the sessions, builds the graph and lays it out", async () => {
    const screen = (await mount()).last();
    expect(screen.status).toBe("ready");
    expect(screen.counts.agents).toMatchObject({ claude: 23, codex: 1 });
    expect(screen.scene?.ids).toContain("ticket:ACME-2001");
    expect(screen.scene?.ids).not.toContain("repo:~/work/desk");
    expect([...(screen.scene?.x ?? [])].every(Number.isFinite)).toBe(true);
  });

  it("keeps the graph current as the connector writes", async () => {
    const { host, last } = await mount();
    const link = { kind: "ticket", key: "ACME-2002", rel: "mentioned", where: "prompt" } as const;
    host.upsert(session("codex:new", "Second look", [link]));
    await host.settle();
    await wait();
    expect(last().counts.agents.codex).toBe(2);
    expect(last().scene?.ids).toContain("ticket:ACME-2002");
  });

  it("selects, shows what lies around, and the note", async () => {
    const { host, app, last } = await mount();
    await host.invoke("endue.knowledge.focus", { name: "ACME-2001" });
    expect(last()).toMatchObject({ mode: "local", selectedId: "ticket:ACME-2001" });
    expect(last().only?.size).toBeGreaterThan(2);
    expect(last().panel?.title).toBe("ACME-2001");
    app.actions.mode("note");
    expect(last().note?.markdown).toContain("# ACME-2001");
    app.actions.select(null);
    expect(last()).toMatchObject({ mode: "graph", panel: undefined });
  });
});

describe("agent tools", () => {
  it("search finds things by name and sessions by title", async () => {
    const { host } = await mount();
    const found = (await host.invoke("endue.knowledge.search", { query: "acme-2001" })) as Found;
    expect(found.entities[0]).toMatchObject({ kind: "ticket", key: "ACME-2001", sessions: 2 });
    const args = { query: "explorer", kinds: ["session"] };
    const titled = (await host.invoke("endue.knowledge.search", args)) as Found;
    expect(titled.sessions.map((s) => s.id).sort()).toEqual(["claude:a", "codex:b"]);
    const blank = host.invoke("endue.knowledge.search", { query: " " });
    await expect(blank).rejects.toThrow(/what to search/);
  });

  it("related answers a file's sessions by the end of its path, and what came up with it", async () => {
    const { host } = await mount();
    const name = "plugins/explorer/ui/tree.js";
    const related = (await host.invoke("endue.knowledge.related", { name })) as Related;
    expect(related.id).toBe("file:~/work/desk/plugins/explorer/ui/tree.js");
    expect(related.sessions.map((s) => s.id)).toEqual(["codex:b", "claude:a", "claude:a1"]);
    expect(related.together.map((t) => t.key)).toContain("ACME-2001");
    const of = (await host.invoke("endue.knowledge.related", { name: "codex:b" })) as Related;
    expect(of.alike[0]?.id).toBe("claude:a");
    const unknown = host.invoke("endue.knowledge.related", { name: "nope" });
    await expect(unknown).rejects.toThrow(/Nothing/);
  });

  it("note answers the Markdown note", async () => {
    const { host } = await mount();
    const note = (await host.invoke("endue.knowledge.note", { name: "ACME-2001" })) as {
      path: string;
      markdown: string;
    };
    expect(note.path).toBe("~/.desk/knowledge/ACME-2001.md");
    expect(note.markdown).toContain("## Sessions");
  });
});

describe("notes", () => {
  it("writes every noteworthy thing and an index into the knowledge folder", async () => {
    const { host } = await mount();
    const done = await host.invoke("endue.knowledge.write-notes");
    const writes = host.calls.flatMap((c) => (c.method === "fs.write" ? [c.params.path] : []));
    expect(done).toEqual({ folder: "~/.desk/knowledge", written: writes.length });
    expect(writes).toContain("~/.desk/knowledge/ACME-2001.md");
    expect(writes.at(-1)).toBe("~/.desk/knowledge/index.md");
    expect(writes.every((p) => p.startsWith("~/.desk/knowledge/"))).toBe(true);
  });

  it("writes and opens one note in the desk", async () => {
    const { app, opened } = await mount();
    await app.actions.openNote("pr:github.com/example/desk#9001");
    expect(opened).toEqual([{ path: "~/.desk/knowledge/pr-github.com-example-desk-9001.md" }]);
  });
});
