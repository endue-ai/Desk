import { BridgeClient, browserStub, type PluginInfo } from "@endue-ai/bridge";
import { describe, expect, it } from "vitest";
import { PluginHost } from "./plugins";

const DB = "endue.database";

function database(): PluginInfo {
  return {
    id: DB,
    status: "ready",
    enabled: true,
    builtIn: true,
    revision: 1,
    manifest: {
      id: DB,
      version: "0.1.0",
      kind: "ui",
      entry: "ui/index.html",
      surfaces: [{ id: "main", title: "Database", placement: "center", instances: "many" }],
    },
  } as PluginInfo;
}

const OPEN = {
  engine: "postgresql",
  host: "db.example",
  port: 5432,
  database: "app",
  user: "app",
  scope: { permission: "db:connect", hosts: ["db.example:5432"] },
};

/** A host over fake frames whose db.open answers sessions one by one, or when `hold` lets it. */
async function mount() {
  const closes: Array<{ sessionId: string; caller: string | undefined }> = [];
  let opened = 0;
  let held: Array<() => void> = [];
  let hold = false;
  const stub = browserStub({
    "plugin.list": () => ({ plugins: [database()] }),
    "db.open": () => {
      const answer = { sessionId: `d-${++opened}`, pid: 100 + opened };
      if (!hold) return answer;
      return new Promise((resolve) => held.push(() => resolve(answer)));
    },
    "db.close": (params, caller) => {
      closes.push({ sessionId: (params as { sessionId: string }).sessionId, caller });
      return {};
    },
  });
  const frames = new Map<string, Window>();
  const closed: string[] = [];
  let receive = (_event: MessageEvent) => {};
  const win = {
    addEventListener: (_type: string, listener: typeof receive) => {
      receive = listener;
    },
    removeEventListener() {},
  } as unknown as Window;
  const host = new PluginHost(
    {
      bridge: new BridgeClient(stub),
      win,
      open: (spec) => {
        frames.set(spec.id, { postMessage() {} } as unknown as Window);
      },
      close: (id) => void closed.push(id),
      reload() {},
      frame: (id) => (closed.includes(id) ? null : (frames.get(id) ?? null)),
    },
    { url: (id, path, _revision, surface) => `desk-plugin://${surface}.${id}/${path}` },
  );
  await host.start();
  const say = (id: string, data: unknown) =>
    receive({ source: frames.get(id), data } as unknown as MessageEvent);
  say(DB, { type: "desk:hello" });
  let n = 0;
  /** A db.open from window `key`. */
  const open = (key: string) =>
    say(key, { type: "desk:calls", calls: [{ id: ++n, method: "db.open", params: OPEN }] });
  return {
    stub,
    host,
    say,
    open,
    closes,
    holdOpens: () => {
      hold = true;
    },
    release: () => {
      for (const go of held) go();
      held = [];
    },
  };
}

const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

describe("a window's database sessions (ADR 0339)", () => {
  it("closes the sessions a window opened when it closes, as its plugin", async () => {
    const { host, say, open, closes } = await mount();
    const second = host.another(DB);
    say(second, { type: "desk:hello" });
    open(second);
    open(second);
    open(DB);
    await settle();
    host.unmount(second);
    await settle();
    expect(closes).toEqual([
      { sessionId: "d-1", caller: DB },
      { sessionId: "d-2", caller: DB },
    ]);
    // The plugin's first window, its last, closes its own too.
    host.unmount(DB);
    await settle();
    expect(closes.map((c) => c.sessionId)).toEqual(["d-1", "d-2", "d-3"]);
  });

  it("closes at once a session whose db.open answers after its window closed", async () => {
    const { host, say, open, closes, holdOpens, release } = await mount();
    const second = host.another(DB);
    say(second, { type: "desk:hello" });
    holdOpens();
    open(second);
    await settle();
    host.unmount(second);
    await settle();
    expect(closes).toEqual([]);
    release();
    await settle();
    expect(closes).toEqual([{ sessionId: "d-1", caller: DB }]);
  });

  it("keeps a sleeping window's sessions for its next page (ADR 0134)", async () => {
    const { host, open, closes } = await mount();
    open(DB);
    await settle();
    host.unloaded(DB, { kept: true });
    await settle();
    expect(closes).toEqual([]);
  });

  it("does not close again a session that ended on its own", async () => {
    const { host, open, closes, stub } = await mount();
    open(DB);
    open(DB);
    await settle();
    stub.emit({
      event: "db.closed",
      data: { sessionId: "d-1", reason: "server" },
    } as never);
    host.unmount(DB);
    await settle();
    expect(closes).toEqual([{ sessionId: "d-2", caller: DB }]);
  });
});
