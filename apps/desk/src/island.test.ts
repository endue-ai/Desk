// @vitest-environment jsdom
// The island (ADR 0204) on a fake native side: the pill says what is going on from the core's
// answers and events, a press asks the shell to open it and the shell's word opens it, a press
// that moves drags it, Escape folds it, and it asks the core only as the desk would.
import type { BridgeEvent } from "@endue-ai/bridge";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type IslandView, type NativeWindow, startIsland } from "./island";

type Handler = (event: { payload: unknown }) => void;
interface Request {
  id: number;
  method: string;
  params: Record<string, unknown>;
}

const prompt = {
  promptId: "p-1",
  caller: "endue.notes",
  permission: { permission: "fs:read", paths: ["~/Notes/**"] },
  duration: "session",
};

/** The shell as the island sees it: its commands, `bridge_call` and the events it hears. */
function nativeSide(answers: Record<string, unknown>) {
  const handlers = new Map<string, Set<Handler>>();
  const invoked: Array<{ command: string; args?: Record<string, unknown> }> = [];
  const api: NativeWindow = {
    invoke: vi.fn(async (command: string, args?: Record<string, unknown>) => {
      invoked.push(args ? { command, args } : { command });
      if (command !== "bridge_call") return undefined;
      const request = (args as { request: Request }).request;
      const result = answers[request.method];
      if (result === undefined)
        return { id: request.id, ok: false, error: { code: "unsupported", message: "no" } };
      return { id: request.id, ok: true, result };
    }),
    listen: vi.fn(async (event: string, handler: Handler) => {
      const set = handlers.get(event) ?? new Set<Handler>();
      set.add(handler);
      handlers.set(event, set);
      return () => set.delete(handler);
    }) as unknown as NativeWindow["listen"],
  };
  const fire = (event: string, payload: unknown = null) => {
    for (const handler of handlers.get(event) ?? []) handler({ payload });
  };
  return {
    api,
    fire,
    core: (event: BridgeEvent | Record<string, unknown>) => fire("bridge://event", event),
    commands: () => invoked.filter((c) => c.command !== "bridge_call"),
    asked: () =>
      invoked
        .filter((c) => c.command === "bridge_call")
        .map((c) => c.args as { request: Request; caller?: string }),
  };
}

const $ = <T extends Element = HTMLElement>(selector: string) =>
  document.querySelector(selector) as T;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("the island", () => {
  let native: ReturnType<typeof nativeSide>;
  let island: IslandView;

  beforeEach(async () => {
    document.body.innerHTML = '<div id="desk"></div>';
    native = nativeSide({
      "agent.list": {
        agents: [
          { id: "eris", name: "Eris", source: "eris", state: "idle" },
          { id: "mira", name: "Mira", source: "init", state: "working", colour: "#3366ff" },
        ],
      },
      "agents.runs": { runs: [] },
      "perm.pending": { prompts: [prompt], approvals: [] },
    });
    island = await startIsland(native.api, { rest: 0 });
  });

  afterEach(() => {
    island.dispose();
    vi.restoreAllMocks();
  });

  it("starts from what the core says: the agents at work and what waits", () => {
    expect($(".island-line").textContent).toBe("1 agent at work · 1 ask waits");
    expect($(".island-badge").textContent).toBe("1");
    expect($(".island-pill").getAttribute("aria-expanded")).toBe("false");
    expect($<HTMLElement>(".island-panel").hidden).toBe(true);
    expect($<HTMLElement>(".island-dot").style.getPropertyValue("--island-dot")).toBe("#3366ff");
    // Each call goes as the desk (the shell pins the caller) with no caller of its own.
    const methods = native.asked().map((a) => a.request.method);
    expect(new Set(methods)).toEqual(new Set(["agent.list", "agents.runs", "perm.pending"]));
    expect(native.asked().every((a) => a.caller === undefined)).toBe(true);
  });

  it("counts asks as they come and go, and an agent program while it runs", async () => {
    native.core({
      event: "perm.approval",
      data: {
        approvalId: "a-1",
        caller: "agent:mira",
        action: "fs.write",
        permission: { permission: "fs:write", paths: ["~/Notes/**"] },
        target: "~/Notes/a.md",
      },
    });
    expect($(".island-line").textContent).toBe("1 agent at work · 2 asks wait");
    native.core({ event: "perm.settled", data: { kind: "prompt", id: "p-1" } });
    native.core({ event: "perm.settled", data: { kind: "approval", id: "a-1" } });
    expect(island.state().asks).toEqual([]);
    expect($<HTMLElement>(".island-badge").hidden).toBe(true);
    native.core({ event: "agents.run", data: { runId: "r-1", agent: "claude", kind: "started" } });
    expect($(".island-line").textContent).toBe("2 agents at work");
    native.core({ event: "agents.run", data: { runId: "r-1", agent: "claude", kind: "done" } });
    await tick();
    expect($(".island-line").textContent).toBe("1 agent at work");
  });

  it("reads the agents again when the core says one of their runs changed", async () => {
    const before = native.asked().filter((a) => a.request.method === "agent.list").length;
    native.core({ event: "agent.changed", data: { agent: "mira", runId: "run-1" } });
    await tick();
    await tick();
    const after = native.asked().filter((a) => a.request.method === "agent.list").length;
    expect(after).toBe(before + 1);
  });

  it("opens when the shell says so after a press, lists both, and folds with Escape", () => {
    $<HTMLButtonElement>(".island-pill").click();
    expect(native.commands()).toEqual([{ command: "island_open", args: { open: true } }]);
    expect(island.isOpen(), "the shell decides").toBe(false);
    native.fire("island://open", { open: true });
    expect(island.isOpen()).toBe(true);
    expect($<HTMLElement>(".island-panel").hidden).toBe(false);
    expect($(".island-pill").getAttribute("aria-expanded")).toBe("true");
    const rows = [...document.querySelectorAll(".island-row")].map((row) =>
      [...row.children].map((part) => part.textContent),
    );
    expect(rows).toEqual([
      ["Mira", "working"],
      ["endue.notes", "asks for fs:read"],
    ]);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(native.commands().at(-1)).toEqual({ command: "island_open", args: { open: false } });
    $<HTMLButtonElement>(".island-desk").click();
    expect(native.commands().at(-1)).toEqual({ command: "island_reveal_main" });
    native.fire("island://open", { open: false });
    expect($<HTMLElement>(".island-panel").hidden).toBe(true);
  });

  it("drags on a press that moves, without opening", () => {
    const pill = $<HTMLButtonElement>(".island-pill");
    pill.dispatchEvent(new MouseEvent("pointerdown", { button: 0, screenX: 10, screenY: 10 }));
    window.dispatchEvent(new MouseEvent("pointermove", { screenX: 12, screenY: 11 }));
    expect(native.commands()).toEqual([]);
    window.dispatchEvent(new MouseEvent("pointermove", { screenX: 30, screenY: 10 }));
    window.dispatchEvent(new MouseEvent("pointerup", {}));
    pill.click();
    expect(native.commands()).toEqual([{ command: "island_drag" }]);
    pill.click();
    expect(native.commands().at(-1)).toEqual({ command: "island_open", args: { open: true } });
  });
});
