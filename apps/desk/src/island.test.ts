// @vitest-environment jsdom
// The island (ADR 0204) on a fake native side: the pill says what is going on from the core's
// answers and events; an ask never opens it, the person's press does (the shell's word opens it) and
// the card in front is answered here, its choices taking no press in the first moment; opened for
// asks, it folds when they are done; a press that moves drags it; Escape folds it; it asks the core
// only as the desk would.
import type { BridgeEvent } from "@endue-ai/bridge";
import { ManualClock } from "@endue-ai/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type IslandView, type NativeWindow, startIsland } from "./island";

type Handler = (event: { payload: unknown }) => void;
interface Request {
  id: number;
  method: string;
  params: Record<string, unknown>;
}
type Answer = unknown | ((params: Record<string, unknown>) => unknown);

const prompt = (promptId: string) => ({
  promptId,
  caller: "endue.notes",
  permission: { permission: "fs:read", paths: ["~/Notes/**"] },
  duration: "session",
});

const plugins = {
  plugins: [
    {
      id: "endue.notes",
      status: "ready",
      enabled: true,
      builtIn: true,
      revision: 1,
      manifest: {
        id: "endue.notes",
        name: "Notes",
        version: "0.1.0",
        kind: "ui",
        entry: "ui/index.html",
      },
    },
  ],
};

/** The shell as the island sees it: its commands, `bridge_call` and the events it hears. */
function nativeSide(answers: Record<string, Answer>) {
  const handlers = new Map<string, Set<Handler>>();
  const invoked: Array<{ command: string; args?: Record<string, unknown> }> = [];
  const api: NativeWindow = {
    invoke: vi.fn(async (command: string, args?: Record<string, unknown>) => {
      invoked.push(args ? { command, args } : { command });
      if (command === "island_state")
        return {
          shortcut: "⌥↩",
          notify: {
            durations: { info: 4000, success: 4000, warning: 8000, error: 0 },
            dnd: false,
            dndAllows: ["error"],
            history: 200,
          },
        };
      if (command !== "bridge_call") return undefined;
      const request = (args as { request: Request }).request;
      const answer = answers[request.method];
      if (answer === undefined)
        return { id: request.id, ok: false, error: { code: "unsupported", message: "no" } };
      try {
        const result = typeof answer === "function" ? answer(request.params) : answer;
        return { id: request.id, ok: true, result };
      } catch (error) {
        const code = error instanceof Error ? error.message : "failed";
        return { id: request.id, ok: false, error: { code, message: "refused" } };
      }
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
    commands: () =>
      invoked.filter((c) => !["bridge_call", "island_fit", "island_state"].includes(c.command)),
    asked: () =>
      invoked
        .filter((c) => c.command === "bridge_call")
        .map((c) => c.args as { request: Request; caller?: string }),
  };
}

const $ = <T extends Element = HTMLElement>(selector: string) =>
  document.querySelector(selector) as T;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const OPEN = { command: "island_open", args: { open: true } };
const FOLD = { command: "island_open", args: { open: false } };

describe("the island", () => {
  let native: ReturnType<typeof nativeSide>;
  let island: IslandView;

  let clock = 0;
  let notices = new ManualClock();
  const start = async (pending: unknown[], extra: Record<string, Answer> = {}, guard = 0) => {
    document.body.innerHTML = '<div id="desk"></div>';
    native = nativeSide({
      "agent.list": {
        agents: [
          { id: "eris", name: "Eris", source: "eris", state: "idle" },
          { id: "mira", name: "Mira", source: "init", state: "working", colour: "#3366ff" },
        ],
      },
      "agents.runs": { runs: [] },
      "perm.pending": { prompts: pending, approvals: [] },
      "plugin.list": plugins,
      "perm.answer": {},
      "perm.approve": {},
      ...extra,
    });
    island = await startIsland(native.api, {
      rest: 0,
      guard,
      now: () => clock,
      clock: notices,
    });
  };

  afterEach(() => {
    island.dispose();
    vi.restoreAllMocks();
  });

  it("starts from what the core says; an ask waiting does not open it, a press does", async () => {
    await start([prompt("p-1")]);
    expect($(".island-line").textContent).toBe("1 agent at work · 1 ask waits");
    expect($(".island-badge").textContent).toBe("1");
    expect($(".island").dataset.asks).toBe("1");
    expect($<HTMLElement>(".island-dot").style.getPropertyValue("--island-dot")).toBe("#3366ff");
    expect(native.commands()).toEqual([]);
    $<HTMLButtonElement>(".island-pill").click();
    expect(native.commands()).toEqual([OPEN]);
    expect(island.isOpen(), "the shell decides").toBe(false);
    native.fire("island://open", { open: true });
    expect($<HTMLElement>(".island-panel").hidden).toBe(false);
    expect($(".island-card-title").textContent).toBe("Notes asks for permission");
    // Each call goes as the desk (the shell pins the caller) with no caller of its own.
    const methods = new Set(native.asked().map((a) => a.request.method));
    expect(methods).toEqual(new Set(["agent.list", "agents.runs", "perm.pending", "plugin.list"]));
    expect(native.asked().every((a) => a.caller === undefined)).toBe(true);
  });

  it("answers the card in front and folds when the asks it was opened for are done", async () => {
    await start([prompt("p-1"), prompt("p-2")]);
    $<HTMLButtonElement>(".island-pill").click();
    native.fire("island://open", { open: true });
    expect($(".island-card").textContent).toContain("1 more waits");
    $<HTMLButtonElement>("[data-answer=session]").click();
    await tick();
    const answered = native.asked().filter((a) => a.request.method === "perm.answer");
    expect(answered.map((a) => a.request.params)).toEqual([
      { promptId: "p-1", granted: true, duration: "session", scope: { permission: "perm:manage" } },
    ]);
    expect(island.state().asks.map((a) => a.id)).toEqual(["p-2"]);
    expect(native.commands()).toEqual([OPEN]);
    // The other one settled elsewhere (the overlay): nothing waits, and the island folds.
    native.core({ event: "perm.settled", data: { kind: "prompt", id: "p-2" } });
    expect(native.commands().at(-1)).toEqual(FOLD);
  });

  it("drops an ask already decided elsewhere, and says why another answer failed", async () => {
    let refuse = "not_found";
    await start([prompt("p-1"), prompt("p-2")], {
      "perm.answer": () => {
        throw new Error(refuse);
      },
    });
    $<HTMLButtonElement>(".island-pill").click();
    native.fire("island://open", { open: true });
    $<HTMLButtonElement>("[data-answer=once]").click();
    await tick();
    expect(island.state().asks.map((a) => a.id)).toEqual(["p-2"]);
    refuse = "internal";
    $<HTMLButtonElement>("[data-answer=once]").click();
    await tick();
    expect(island.state().asks.map((a) => a.id)).toEqual(["p-2"]);
    expect($(".island-said").textContent).toBe("Could not answer: internal.");
  });

  it("stays open when the person opened it, and counts what comes and goes", async () => {
    await start([]);
    expect(native.commands()).toEqual([]);
    $<HTMLButtonElement>(".island-pill").click();
    expect(native.commands()).toEqual([OPEN]);
    native.fire("island://open", { open: true });
    native.core({ event: "perm.prompt", data: prompt("p-7") });
    expect($(".island-line").textContent).toBe("1 agent at work · 1 ask waits");
    expect(native.commands(), "already open").toEqual([OPEN]);
    native.core({ event: "perm.settled", data: { kind: "prompt", id: "p-7" } });
    expect(native.commands(), "the person's island stays").toEqual([OPEN]);
    native.core({ event: "agents.run", data: { runId: "r-1", agent: "claude", kind: "started" } });
    expect($(".island-line").textContent).toBe("2 agents at work");
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(native.commands().at(-1)).toEqual(FOLD);
    $<HTMLButtonElement>(".island-desk").click();
    expect(native.commands().at(-1)).toEqual({ command: "island_reveal_main" });
  });

  it("takes no press on a card in the moment after it shows, nor on the next one", async () => {
    clock = 1000;
    await start([prompt("p-1"), prompt("p-2")], {}, 500);
    native.core({ event: "perm.prompt", data: prompt("p-3") });
    expect(native.commands(), "a new ask does not open it").toEqual([]);
    $<HTMLButtonElement>(".island-pill").click();
    native.fire("island://open", { open: true });
    const answered = () => native.asked().filter((a) => a.request.method === "perm.answer");
    clock = 1200;
    $<HTMLButtonElement>("[data-answer=always]").click();
    await tick();
    expect(answered(), "too soon after it opened").toEqual([]);
    clock = 1600;
    $<HTMLButtonElement>("[data-answer=once]").click();
    await tick();
    expect(answered().map((a) => a.request.params.promptId)).toEqual(["p-1"]);
    // The next card came to the front at 1600: a second press at once allows nothing.
    clock = 1700;
    $<HTMLButtonElement>("[data-answer=always]").click();
    await tick();
    expect(answered()).toHaveLength(1);
    clock = 2200;
    $<HTMLButtonElement>("[data-answer=refuse]").click();
    await tick();
    expect(answered().map((a) => a.request.params.promptId)).toEqual(["p-1", "p-2"]);
  });

  it("puts the keys in Eris's field for Option+Enter, and Escape gives them back", async () => {
    await start([]);
    native.fire("island://open", { open: true });
    native.fire("island://talk");
    const input = $<HTMLInputElement>(".island-talk-input");
    expect(document.activeElement).toBe(input);
    expect($(".island-talk-empty").textContent).toContain("⌥↩ summons her anywhere");
    // An Escape that ends a composition in her field leaves the island open.
    input.dispatchEvent(new CompositionEvent("compositionstart"));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(native.commands()).toEqual([]);
    input.dispatchEvent(new CompositionEvent("compositionend"));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(native.commands()).toEqual([FOLD]);
  });

  it("says a notice on the pill as desk.notify says to, and a press has seen it", async () => {
    notices = new ManualClock();
    await start([]);
    native.core({
      event: "ui.notified",
      data: { notificationId: "n-1", caller: "endue.notes", title: "Saved", level: "info" },
    });
    expect($(".island-line").textContent).toBe("Saved");
    expect($(".island").dataset.level).toBe("info");
    notices.advance(4001);
    expect($(".island-line").textContent).toBe("1 agent at work");
    // Do-not-disturb from the shell: an info notice is held back, an error still says itself.
    native.fire("island://notify", {
      durations: { info: 4000, success: 4000, warning: 8000, error: 0 },
      dnd: true,
      dndAllows: ["error"],
      history: 200,
    });
    native.core({
      event: "ui.notified",
      data: { notificationId: "n-2", caller: "endue.mail", title: "Synced", level: "info" },
    });
    expect($(".island-line").textContent).toBe("1 agent at work");
    native.core({
      event: "ui.notified",
      data: {
        notificationId: "n-3",
        caller: "endue.mail",
        title: "Sync failed",
        body: "offline",
        level: "error",
      },
    });
    expect($(".island-line").textContent).toBe("Sync failed — offline");
    $<HTMLButtonElement>(".island-pill").click();
    expect($(".island-line").textContent, "seen when it opens").toBe("1 agent at work");
    native.fire("island://open", { open: true });
    const listed = [...document.querySelectorAll(".island-list .island-who")].map(
      (who) => who.textContent,
    );
    expect(listed).toContain("Sync failed");
    expect(listed).not.toContain("Synced");
  });

  it("reads the agents again when the core says one of their runs changed", async () => {
    await start([]);
    const count = () => native.asked().filter((a) => a.request.method === "agent.list").length;
    const before = count();
    native.core({ event: "agent.changed", data: { agent: "mira", runId: "run-1" } });
    await tick();
    await tick();
    expect(count()).toBe(before + 1);
  });

  it("drags on a press that moves, without opening", async () => {
    await start([]);
    const pill = $<HTMLButtonElement>(".island-pill");
    pill.dispatchEvent(new MouseEvent("pointerdown", { button: 0, screenX: 10, screenY: 10 }));
    window.dispatchEvent(new MouseEvent("pointermove", { screenX: 12, screenY: 11 }));
    expect(native.commands()).toEqual([]);
    window.dispatchEvent(new MouseEvent("pointermove", { screenX: 30, screenY: 10 }));
    window.dispatchEvent(new MouseEvent("pointerup", {}));
    pill.click();
    expect(native.commands()).toEqual([{ command: "island_drag" }]);
    pill.click();
    expect(native.commands().at(-1)).toEqual(OPEN);
  });
});
