import { describe, expect, it } from "vitest";
import { type RecordMode, recordKey } from "./record";

type Mods = Partial<Record<"meta" | "ctrl" | "alt" | "shift", boolean>>;
const key = (k: string, mods: Mods = {}, repeat = false) => ({
  key: k,
  metaKey: mods.meta ?? false,
  ctrlKey: mods.ctrl ?? false,
  altKey: mods.alt ?? false,
  shiftKey: mods.shift ?? false,
  repeat,
});

const several: RecordMode = { several: true, isPrefix: () => false };
/** Keys in force where Ctrl+X and Ctrl+X Ctrl+4 are prefixes, as of Ctrl+X Ctrl+4 F. */
const emacs: RecordMode = {
  several: false,
  isPrefix: (chords) => ["Control+X", "Control+X Control+4"].includes(chords.join(" ")),
};

/** Press keys one after another, as the keyboard settings record them. */
function record(mode: RecordMode, ...presses: ReturnType<typeof key>[]) {
  let chords: string[] = [];
  const steps: string[] = [];
  for (const press of presses) {
    const step = recordKey(chords, press, mode);
    steps.push(step.kind);
    if (step.kind === "chords") chords = step.chords;
    if (step.kind === "save") return { steps, saved: step.sequence };
  }
  return { steps, chords };
}

describe("recording a key sequence in Settings › Keyboard", () => {
  it("ends a key at once unless it is a prefix in force, as Emacs reads one", () => {
    expect(record(emacs, key("n", { meta: true, shift: true })).saved).toBe("Meta+Shift+N");
    expect(record(emacs, key("x", { ctrl: true }), key("f", { ctrl: true })).saved).toBe(
      "Control+X Control+F",
    );
    expect(record(emacs, key("x", { ctrl: true }), key("4", { ctrl: true }), key("f")).saved).toBe(
      "Control+X Control+4 F",
    );
    // Enter keeps a prefix itself, which the screen then asks about.
    expect(record(emacs, key("x", { ctrl: true }), key("Enter")).saved).toBe("Control+X");
  });

  it("with several keys in a row, takes chords until Enter, plain keys after the first", () => {
    const keys = [key("x", { ctrl: true }), key("f", { ctrl: true }), key("Enter")];
    expect(record(several, ...keys).saved).toBe("Control+X Control+F");
    expect(record(several, key("c", { ctrl: true }), key("p"), key("f"), key("Enter")).saved).toBe(
      "Control+C P F",
    );
    expect(record(several, key("j", { meta: true, alt: true }), key("Enter")).saved).toBe(
      "Meta+Alt+J",
    );
    expect(record(several, key("F5"), key("Enter")).saved).toBe("F5");
  });

  it("needs a modifier on the first chord, takes Backspace back and cancels on Escape", () => {
    expect(record(emacs, key("j")).steps).toEqual(["invalid"]);
    const back = record(
      several,
      key("k", { meta: true }),
      key("s", { meta: true }),
      key("Backspace"),
    );
    expect(back.chords).toEqual(["Meta+K"]);
    expect(record(several, key("k", { meta: true }), key("Escape")).steps).toEqual([
      "chords",
      "cancel",
    ]);
    expect(record(emacs, key("Enter")).steps).toEqual(["ignore"]);
    expect(record(emacs, key("Meta"), key("k", { meta: true }, true)).steps).toEqual([
      "ignore",
      "ignore",
    ]);
    // With a modifier, Enter is a chord like any other.
    const chorded = [key("c", { ctrl: true }), key("Enter", { meta: true }), key("Enter")];
    expect(record(several, ...chorded).saved).toBe("Control+C Meta+Enter");
  });
});
