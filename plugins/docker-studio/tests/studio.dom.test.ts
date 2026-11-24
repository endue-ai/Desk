// @vitest-environment jsdom
// The whole window on the preview's seeded engine: the studio mounted with a bridge whose
// proc.spawn runs dev/fake's docker, so the dashboard, the containers, an action, a container's
// logs and the agents' commands are checked end to end, streams and all.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { docker } from "../dev/fake/cli.mjs";
import { createWorld, seedEvents } from "../dev/fake/world.mjs";
import { PAGES } from "../ui/pages.js";
import { createStudio } from "../ui/studio.js";

type Listener = (event: { event: string; data: Record<string, unknown> }) => void;
type Io = { kill: Array<() => void>; input: Array<(data: string, close: boolean) => void> };

function fakeBridge() {
  const world = createWorld();
  seedEvents(world);
  const listeners = new Set<Listener>();
  const emit: Listener = (e) => {
    for (const l of listeners) l(e);
  };
  const procs = new Map<string, Io>();
  let next = 0;
  const handlers = new Map<string, (args: unknown) => unknown>();
  const bridge = {
    onEvent: (l: Listener) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    call: async (method: string, params: Record<string, unknown>) => {
      if (method === "proc.spawn") {
        const procId = `p${++next}`;
        const io: Io = { kill: [], input: [] };
        procs.set(procId, io);
        let ended = false;
        const out = (stream: string) => (text: string) => {
          if (!ended)
            emit({ event: "proc.output", data: { procId, stream, data: text, encoding: "utf8" } });
        };
        setTimeout(() =>
          docker(world, params.args as string[], {
            out: out("stdout"),
            err: out("stderr"),
            exit: (code: number) => {
              if (ended) return;
              ended = true;
              emit({ event: "proc.exit", data: { procId, code, signal: null } });
            },
            onKill: (fn: () => void) => io.kill.push(fn),
            onInput: (fn: (data: string, close: boolean) => void) => io.input.push(fn),
          }),
        );
        return { procId };
      }
      if (method === "proc.kill") {
        for (const fn of procs.get(String(params.procId))?.kill ?? []) fn();
        return {};
      }
      if (method === "proc.write") {
        for (const fn of procs.get(String(params.procId))?.input ?? [])
          fn(String(params.data), params.close === true);
        return {};
      }
      throw Object.assign(new Error(`${method} is not here`), { code: "unsupported" });
    },
  };
  const ctx = {
    bridge,
    commands: {
      on: (id: string, fn: (a: unknown) => unknown) => handlers.set(id, fn),
      run: async () => ({}),
    },
    state: { get: () => undefined, set: () => {} },
    settings: { get: async () => undefined, set: async () => {}, onChange: () => () => {} },
  };
  return { ctx, handlers, world };
}

const until = async (test: () => boolean, ms = 4000) => {
  const end = Date.now() + ms;
  while (!test()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
};

let stop = () => {};

beforeEach(() => {
  document.body.replaceChildren();
  globalThis.requestAnimationFrame ??= (cb: FrameRequestCallback) =>
    setTimeout(() => cb(0), 0) as unknown as number;
});
afterEach(() => stop());

it("stops queued and running fixture streams without late output", async () => {
  vi.useFakeTimers();
  try {
    const { ctx } = fakeBridge();
    const { bridge } = ctx;
    let output = 0;
    bridge.onEvent((event) => {
      if (event.event === "proc.output") output++;
    });
    const pending = await bridge.call("proc.spawn", { args: ["stats"] });
    await bridge.call("proc.kill", pending);
    await vi.advanceTimersByTimeAsync(0);
    expect(output).toBe(0);
    expect(vi.getTimerCount()).toBe(0);

    const running = await bridge.call("proc.spawn", { args: ["stats"] });
    await vi.advanceTimersByTimeAsync(0);
    expect(output).toBeGreaterThan(0);
    await bridge.call("proc.kill", running);
    const stopped = output;
    await vi.advanceTimersByTimeAsync(3000);
    expect(output).toBe(stopped);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.clearAllTimers();
    vi.useRealTimers();
  }
});

describe("Docker Studio on the seeded engine", () => {
  it("draws the dashboard, the containers by stack, an action and a container's logs", async () => {
    const { ctx, handlers } = fakeBridge();
    const app = createStudio(ctx, document, PAGES);
    const { wireCommands } = await import("../ui/commands.js");
    wireCommands(ctx, app);
    await app.start();
    stop = () => app.live.stop();
    await until(
      () => app.store.state.containers.length === 14 && app.store.state.images.length > 0,
    );

    await until(() => document.querySelector(".tile .tile-value")?.textContent === "10");
    expect(document.querySelectorAll(".tile")).toHaveLength(4);
    expect(document.querySelector(".tile")?.textContent).toContain("Running containers");
    expect(document.querySelector(".attention")?.textContent).toContain("shop-migrate-1");

    app.go("containers");
    await until(() => document.querySelectorAll(".row-item").length === 14);
    expect([...document.querySelectorAll(".group-name")].map((b) => b.textContent)).toEqual([
      "blog",
      "observability",
      "shop",
    ]);

    await handlers.get("endue.docker-studio.act")?.({ action: "stop", containers: ["shop-web-1"] });
    await until(
      () => app.store.state.containers.find((c) => c.name === "shop-web-1")?.state === "exited",
    );

    const api = app.store.state.containers.find((c) => c.name === "shop-api-1");
    app.open({ kind: "container", id: api?.id ?? "", tab: "logs" });
    await until(() => document.querySelectorAll(".log-line").length > 50);
    expect(document.querySelector(".level-chip.lv-error .tab-count")?.textContent).not.toBe("0");

    const state = (await handlers.get("endue.docker-studio.state")?.({})) as {
      containers: { running: number };
      problems: unknown[];
    };
    expect(state.containers.running).toBe(9);
    expect(state.problems.length).toBeGreaterThan(0);
  }, 20_000);
});
