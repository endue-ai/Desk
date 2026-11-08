import { describe, expect, it } from "vitest";
import { ManualClock } from "../clock";
import { listenForShortcuts, ShortcutRouter } from "../input";
import type { SequenceEvent } from "./router";

type Mods = Partial<Record<"meta" | "ctrl" | "alt" | "shift", boolean>>;
const key = (k: string, mods: Mods = {}, repeat = false) => ({
  key: k,
  metaKey: mods.meta ?? false,
  ctrlKey: mods.ctrl ?? false,
  altKey: mods.alt ?? false,
  shiftKey: mods.shift ?? false,
  repeat,
});

function desk(platform: "mac" | "other" = "mac") {
  const router = new ShortcutRouter({ platform });
  const ran: string[] = [];
  const events: SequenceEvent[] = [];
  router.sequences.onChange((event) => events.push(event));
  const bind = (combo: string, name = combo, surface?: string) =>
    router.bind(combo, () => ran.push(name), surface ? { surface } : {});
  return { router, ran, events, bind, pending: () => router.sequences.pending };
}

describe("the pending-prefix router", () => {
  it("waits after a prefix, then runs the command when the sequence is complete", () => {
    const d = desk();
    d.bind("Mod+K Mod+S", "save-all");
    d.bind("Mod+S", "save");
    expect(d.router.handle(key("k", { meta: true }))).toBe(true);
    expect(d.pending()).toEqual(["Meta+K"]);
    expect(d.ran).toEqual([]);
    expect(d.router.handle(key("s", { meta: true }))).toBe(true);
    expect(d.ran).toEqual(["save-all"]);
    expect(d.pending()).toEqual([]);
    expect(d.events).toEqual([
      { kind: "pending", chords: ["Meta+K"], capturing: false },
      { kind: "done", chords: ["Meta+K", "Meta+S"], outcome: "ran" },
    ]);
    // With nothing pending the same chord is its own key again.
    d.router.handle(key("s", { meta: true }));
    expect(d.ran).toEqual(["save-all", "save"]);
  });

  it("cancels a pending prefix with Escape or Ctrl+G, and says an unbound continuation", () => {
    const d = desk("other");
    d.bind("Ctrl+X Ctrl+F", "find-file");
    d.bind("Escape", "quit");
    d.router.handle(key("x", { ctrl: true }));
    expect(d.router.handle(key("Escape"))).toBe(true);
    expect(d.pending()).toEqual([]);
    expect(d.ran).toEqual([]);
    d.router.handle(key("x", { ctrl: true }));
    expect(d.router.handle(key("g", { ctrl: true }))).toBe(true);
    expect(d.pending()).toEqual([]);
    d.router.handle(key("x", { ctrl: true }));
    expect(d.router.handle(key("q", { ctrl: true }))).toBe(true);
    expect(d.ran).toEqual([]);
    expect(
      d.events.filter((e) => e.kind === "done").map((e) => e.kind === "done" && e.outcome),
    ).toEqual(["cancelled", "cancelled", "unbound"]);
    // Escape alone, with nothing pending, is still the quit key.
    d.router.handle(key("Escape"));
    expect(d.ran).toEqual(["quit"]);
  });

  it("has no time limit by default, and gives up after desk.keys.sequence-timeout when set", () => {
    const clock = new ManualClock();
    const d = desk();
    d.bind("Mod+K Mod+S", "save-all");
    d.router.sequences.configure({ clock });
    d.router.handle(key("k", { meta: true }));
    for (let i = 0; i < 10; i++) clock.advance(1000);
    expect(d.pending()).toEqual(["Meta+K"]);
    d.router.handle(key("s", { meta: true }));
    expect(d.ran).toEqual(["save-all"]);

    d.router.sequences.configure({ timeoutMs: 1500 });
    d.router.handle(key("k", { meta: true }));
    clock.advance(1000);
    expect(d.pending()).toEqual(["Meta+K"]);
    clock.advance(600);
    expect(d.pending()).toEqual([]);
    expect(d.events.at(-1)).toEqual({ kind: "done", chords: ["Meta+K"], outcome: "timeout" });
    d.router.handle(key("s", { meta: true }));
    expect(d.ran).toEqual(["save-all"]);
  });

  it("restarts the wait at each chord of a three-level or deeper sequence", () => {
    const clock = new ManualClock();
    const d = desk("other");
    d.router.sequences.configure({ clock, timeoutMs: 1500 });
    d.bind("Ctrl+C p f", "project-file");
    d.bind("Ctrl+C p s", "project-search");
    d.bind("Mod+K Mod+T Shift+T Alt+1", "deep");
    d.router.handle(key("c", { ctrl: true }));
    clock.advance(1000);
    d.router.handle(key("p"));
    clock.advance(1000);
    expect(d.pending()).toEqual(["Control+C", "P"]);
    d.router.handle(key("f"));
    for (const press of [
      key("k", { ctrl: true }),
      key("t", { ctrl: true }),
      key("T", { shift: true }),
      key("1", { alt: true }),
    ])
      expect(d.router.handle(press)).toBe(true);
    expect(d.ran).toEqual(["project-file", "deep"]);
    // Backspace in the overlay takes the last chord back.
    d.router.handle(key("c", { ctrl: true }));
    d.router.handle(key("p"));
    d.router.sequences.back();
    expect(d.pending()).toEqual(["Control+C"]);
    d.router.sequences.feed(["P", "S"]);
    expect(d.ran).toEqual(["project-file", "deep", "project-search"]);
  });

  it("gives the desk the keys from a plugin frame while a prefix is pending", () => {
    const d = desk();
    d.bind("Mod+K Mod+S", "desk.save-all");
    d.bind("Ctrl+C p", "desk.project");
    d.bind("Mod+S", "notes.save", "notes");
    // A frame forwards its chords (Meta, Control, Alt, Escape) the way runtime.ts hands them on.
    const fromFrame = (press: ReturnType<typeof key>) => {
      d.router.focus("notes");
      return d.router.handle(press);
    };
    expect(fromFrame(key("k", { meta: true }))).toBe(true);
    expect(fromFrame(key("s", { meta: true }))).toBe(true);
    expect(d.ran).toEqual(["desk.save-all"]);
    // Plain keys after a prefix come through the main window once the overlay has the focus.
    fromFrame(key("c", { ctrl: true }));
    d.router.focus(null);
    expect(d.router.handle(key("p"))).toBe(true);
    expect(d.ran).toEqual(["desk.save-all", "desk.project"]);
    // Without a prefix, the frame's own binding comes first as before.
    fromFrame(key("s", { meta: true }));
    expect(d.ran).toEqual(["desk.save-all", "desk.project", "notes.save"]);
  });

  it("routes a plain key typed in a field while a prefix is pending, not before", () => {
    const d = desk("other");
    d.bind("Ctrl+C p", "project");
    d.bind("P", "plain-p");
    let onKey: ((event: unknown) => void) | undefined;
    const win = {
      addEventListener: (_: string, listener: (event: unknown) => void) => {
        onKey = listener;
      },
      removeEventListener: () => {},
    } as unknown as Window;
    listenForShortcuts(win, d.router);
    const typed = (press: ReturnType<typeof key>) => {
      let prevented = false;
      onKey?.({
        ...press,
        isComposing: false,
        keyCode: 0,
        defaultPrevented: false,
        target: { closest: () => ({}) },
        preventDefault: () => {
          prevented = true;
        },
      });
      return prevented;
    };
    expect(typed(key("p"))).toBe(false);
    expect(typed(key("c", { ctrl: true }))).toBe(true);
    expect(typed(key("p"))).toBe(true);
    expect(d.ran).toEqual(["project"]);
  });

  it("captures a whole sequence for desk.describe, and ignores a chord still held", () => {
    const d = desk();
    d.bind("Mod+K Mod+S", "save-all");
    const captured: string[] = [];
    d.router.captureNext((combo) => captured.push(combo));
    d.router.handle(key("k", { meta: true }));
    expect(d.router.handle(key("k", { meta: true }, true))).toBe(true);
    expect(d.pending()).toEqual(["Meta+K"]);
    d.router.handle(key("s", { meta: true }));
    expect(captured).toEqual(["Meta+K Meta+S"]);
    expect(d.ran).toEqual([]);
    d.router.captureNext((combo) => captured.push(combo));
    d.router.handle(key("k", { meta: true }));
    d.router.handle(key("Escape"));
    expect(captured).toEqual(["Meta+K Meta+S", "Escape"]);
  });

  it("unbinds a sequence and prunes the prefix nothing else needs", () => {
    const d = desk();
    const off = d.bind("Mod+K Mod+S", "save-all");
    off();
    expect(d.router.handle(key("k", { meta: true }))).toBe(false);
    expect(d.pending()).toEqual([]);
  });
});
