// @vitest-environment jsdom
// The floating Eris window (ADR 0121, #546) on a fake native side: her states, the composer opened
// and folded, a line sent to the desk's one conversation, Esc sending her away, and the shortcut's
// summons.
import type { BridgeEvent } from "@endue-ai/bridge";
import { BACK_KEY, ManualClock, SNAPSHOT_KEY } from "@endue-ai/runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type NativeWindow, startErisWindow } from "./eris-window";

type Handler = (event: { payload: unknown }) => void;
interface Request {
  id: number;
  method: string;
  params: Record<string, unknown>;
}

/** The shell as this window sees it: its commands, `bridge_call`, and the events it hears. */
function nativeSide() {
  const handlers = new Map<string, Set<Handler>>();
  const invoked: Array<{ command: string; args?: Record<string, unknown> }> = [];
  const api: NativeWindow = {
    invoke: vi.fn(async (command: string, args?: Record<string, unknown>) => {
      invoked.push(args ? { command, args } : { command });
      if (command === "plugin:eris-window|state")
        return { shortcut: "Alt+Enter", label: "⌥↩", registered: true };
      if (command !== "bridge_call") return undefined;
      const request = (args as { request: Request }).request;
      if (request.method === "brain.say")
        return { id: request.id, ok: true, result: { turnId: "t-1" } };
      return { id: request.id, ok: false, error: { code: "unsupported", message: "no" } };
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
  const said = () =>
    invoked
      .filter((c) => c.command === "bridge_call")
      .map((c) => c.args as { request: Request; caller?: string })
      .filter((a) => a.request.method === "brain.say");
  return {
    api,
    invoked,
    fire,
    said,
    core: (event: BridgeEvent | Record<string, unknown>) => fire("bridge://event", event),
    commands: () => invoked.map((c) => c.command).filter((c) => c !== "bridge_call"),
  };
}

/** The desk writes her snapshot, as the main window's runtime does. */
function deskWrites(snapshot: Record<string, unknown>) {
  const newValue = JSON.stringify({
    v: 1,
    seq: Date.now(),
    talk: "off",
    saying: "",
    lines: [],
    ...snapshot,
  });
  localStorage.setItem(SNAPSHOT_KEY, newValue);
  window.dispatchEvent(new StorageEvent("storage", { key: SNAPSHOT_KEY, newValue }));
}

const $ = <T extends Element = HTMLElement>(selector: string) =>
  document.querySelector(selector) as T;

describe("the floating Eris window", () => {
  let clock: ManualClock;
  let native: ReturnType<typeof nativeSide>;
  let dispose: () => void;

  beforeEach(async () => {
    localStorage.clear();
    document.body.innerHTML = '<div id="desk"></div>';
    clock = new ManualClock();
    native = nativeSide();
    const view = await startErisWindow(native.api, { clock });
    dispose = () => view.dispose();
  });
  afterEach(() => dispose());

  const status = () => $(".eris-float").dataset.status;
  const frame = (ms = 16) => clock.advance(ms);

  it("renders her states: idle, thinking, listening, waiting for approval and speaking", () => {
    expect(status()).toBe("idle");
    expect($(".eris-float-status").textContent).toBe("Ready");
    expect($(".eris-float-figure").getAttribute("aria-label")).toBe("Eris: Ready");
    deskWrites({ state: "thinking" });
    frame();
    expect(status()).toBe("thinking");
    expect($(".eris-float-status").textContent).toBe("Thinking…");
    expect($(".eris-float-figure").dataset.state).toBe("thinking");
    deskWrites({ state: "idle", talk: "listening" });
    frame();
    expect(status()).toBe("listening");
    expect($(".eris-float-figure").dataset.state).toBe("listening");
    native.core({
      event: "perm.approval",
      data: {
        approvalId: "a-1",
        caller: "agent:writer",
        action: "fs.write",
        permission: { permission: "fs:write", paths: ["~/notes/**"] },
        target: "~/notes/plan.md",
        task: "t-9",
      },
    });
    expect(status()).toBe("approval");
    expect($(".eris-float-status").textContent).toBe("Waiting for your approval");
    expect($(".eris-float-approval").hidden).toBe(false);
    native.core({ event: "brain.turn", data: { turnId: "t-9", kind: "completed" } });
    deskWrites({ state: "idle", saying: "The plan is saved." });
    frame();
    expect(status()).toBe("speaking");
    expect($(".eris-float-status").textContent).toBe("Speaking…");
    frame(9000);
    expect(status()).toBe("idle");
  });

  it("opens her composer on a click and folds it back", () => {
    expect($(".eris-float-panel").hidden).toBe(true);
    $(".eris-float-figure").click();
    expect($(".eris-float-panel").hidden).toBe(false);
    expect($(".eris-float").dataset.open).toBe("true");
    expect($(".eris-float-figure").getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe($(".eris-float-input"));
    expect(native.invoked).toContainEqual({
      command: "plugin:eris-window|expand",
      args: { open: true },
    });
    $<HTMLButtonElement>(".eris-float-fold").click();
    expect($(".eris-float-panel").hidden).toBe(true);
    expect(native.invoked).toContainEqual({
      command: "plugin:eris-window|expand",
      args: { open: false },
    });
    // Enter on her figure opens it too.
    $(".eris-float-figure").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect($(".eris-float-panel").hidden).toBe(false);
  });

  it("drags the window when a press moves, without opening the composer", () => {
    const figure = $(".eris-float-figure");
    figure.dispatchEvent(new MouseEvent("pointerdown", { button: 0, screenX: 10, screenY: 10 }));
    window.dispatchEvent(new MouseEvent("pointermove", { screenX: 30, screenY: 12 }));
    figure.click();
    expect(native.commands()).toContain("plugin:eris-window|drag");
    expect($(".eris-float-panel").hidden).toBe(true);
  });

  it("sends a line to the desk's one conversation and shows her answer", async () => {
    $(".eris-float-figure").click();
    const input = $<HTMLInputElement>(".eris-float-input");
    input.value = "What is next?";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    await vi.waitFor(() => expect(native.said()).toHaveLength(1));
    const [call] = native.said();
    // No caller: the native side calls the core as the desk, whose conversation this is.
    expect(call?.caller).toBeUndefined();
    expect(call?.request.params).toEqual({
      text: "What is next?",
      scope: { permission: "brain:converse" },
    });
    expect(status()).toBe("thinking");
    expect(JSON.parse(localStorage.getItem(BACK_KEY) ?? "{}")).toMatchObject({
      line: { who: "you", text: "What is next?" },
      state: "thinking",
    });
    native.core({ event: "brain.turn", data: { turnId: "t-1", kind: "started" } });
    native.core({ event: "brain.turn", data: { turnId: "t-1", kind: "delta", text: "Lunch " } });
    native.core({
      event: "brain.turn",
      data: { turnId: "t-1", kind: "delta", text: "with Mina." },
    });
    native.core({ event: "brain.turn", data: { turnId: "t-1", kind: "completed" } });
    await vi.waitFor(() => expect(document.querySelectorAll(".eris-float-line")).toHaveLength(2));
    const lines = [...document.querySelectorAll<HTMLElement>(".eris-float-line")];
    expect(
      lines.map((l) => [l.dataset.who, l.querySelector(".eris-float-text")?.textContent]),
    ).toEqual([
      ["you", "What is next?"],
      ["eris", "Lunch with Mina."],
    ]);
    expect(JSON.parse(localStorage.getItem(BACK_KEY) ?? "{}")).toMatchObject({
      line: { who: "eris", text: "Lunch with Mina." },
      state: "idle",
      said: "Lunch with Mina.",
    });
    expect(status()).toBe("speaking");
  });

  it("keeps the question to send again when the turn fails", async () => {
    $(".eris-float-figure").click();
    const input = $<HTMLInputElement>(".eris-float-input");
    input.value = "Book the room";
    $(".eris-float-composer").dispatchEvent(new Event("submit", { cancelable: true }));
    await vi.waitFor(() => expect(native.said()).toHaveLength(1));
    native.core({ event: "brain.turn", data: { turnId: "t-1", kind: "error", text: "offline" } });
    await vi.waitFor(() => expect($(".eris-float-error").hidden).toBe(false));
    expect($(".eris-float-error").textContent).toBe("Eris could not answer. Try again.");
    expect(input.value).toBe("Book the room");
    expect(status()).toBe("idle");
  });

  it("goes away on Esc, but not on the Esc that ends a composition", () => {
    $(".eris-float-figure").click();
    const input = $<HTMLInputElement>(".eris-float-input");
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", isComposing: true, bubbles: true }),
    );
    expect(native.commands()).not.toContain("plugin:eris-window|dismiss");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(native.commands()).toContain("plugin:eris-window|dismiss");
    expect($(".eris-float-panel").hidden).toBe(true);
  });

  it("opens her composer when the shortcut summons her and folds it when the window goes", () => {
    native.fire("eris://open");
    expect($(".eris-float-panel").hidden).toBe(false);
    expect(document.activeElement).toBe($(".eris-float-input"));
    native.fire("eris://fold");
    expect($(".eris-float-panel").hidden).toBe(true);
    expect(native.invoked.filter((c) => c.command === "plugin:eris-window|expand")).toEqual([
      { command: "plugin:eris-window|expand", args: { open: true } },
    ]);
  });

  it("names the shortcut while the desk holds it", () => {
    expect($(".eris-float-figure").getAttribute("aria-keyshortcuts")).toBe("Alt+Enter");
    expect($(".eris-float-empty").textContent).toContain("⌥↩");
    native.fire("eris://shortcut", { shortcut: "Alt+Enter", label: "⌥↩", registered: false });
    expect($(".eris-float-figure").hasAttribute("aria-keyshortcuts")).toBe(false);
    expect($(".eris-float-empty").textContent).not.toContain("⌥↩");
  });
});
