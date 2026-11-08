import { describe, expect, it } from "vitest";
import { explain, type Facts } from "../describe/describe";

/** desk.describe's facts with a few sequences bound (ADR 0118). */
const world = (keys: Facts["keys"]): Facts => ({
  platform: "mac",
  commands: [
    { id: "desk.palette.open", title: "Search Desk", provider: "desk.palette" },
    { id: "desk.files.save", title: "Save the file", provider: "desk" },
    { id: "example.notes.save-all", title: "Save every note", provider: "example.notes" },
  ],
  keys,
  plugins: [],
  declared: {},
  layers: { init: {}, profile: {}, session: {} },
  grants: [],
});

const line = (text: string, label: string) =>
  text.split("\n").find((l) => l.startsWith(`${label}: `));

describe("desk.describe says keys with their sequences", () => {
  const keys: Facts["keys"] = [
    { key: "Mod+K", command: "desk.palette.open", owner: "desk" },
    { key: "Mod+K Mod+S", command: "example.notes.save-all", owner: "example.notes" },
    { key: "Mod+S", command: "desk.files.save", owner: "desk" },
  ];

  it("a sequence: what it runs, and that it shadows the shorter key", () => {
    const answer = explain("key", "Mod+K Mod+S", world(keys));
    expect(answer.name).toBe("Meta+K Meta+S");
    expect(answer.summary).toBe("⌘K ⌘S runs example.notes.save-all.");
    expect(line(answer.text, "What it is")).toBe(
      "What it is: the key sequence ⌘K ⌘S (Meta+K Meta+S)",
    );
    expect(line(answer.text, "Shadows")).toBe("Shadows: ⌘K → desk.palette.open (core default)");
  });

  it("a prefix: every key that continues it; a shadowed key: what shadows it", () => {
    const answer = explain("key", "Mod+K", world(keys));
    expect(answer.summary).toBe("⌘K would run desk.palette.open, but ⌘K ⌘S shadows it.");
    expect(line(answer.text, "Shadowed by")).toBe(
      "Shadowed by: ⌘K ⌘S → example.notes.save-all (manifest default, example.notes)",
    );
    expect(line(answer.text, "Continues with")).toBe(
      "Continues with: ⌘K ⌘S → example.notes.save-all (manifest default, example.notes)",
    );
    const prefix = explain(
      "key",
      "Ctrl+X",
      world([{ key: "Ctrl+X Ctrl+F", command: "desk.files.open", owner: "person" }]),
    );
    expect(prefix.summary).toBe("⌃X is a prefix of 1 key.");
  });

  it("a command lists the sequences in force that run it, not the shadowed ones", () => {
    const save = explain("command", "example.notes.save-all", world(keys));
    expect(line(save.text, "Keys")).toBe("Keys: ⌘K ⌘S (manifest default, example.notes)");
    const palette = explain("command", "desk.palette.open", world(keys));
    expect(line(palette.text, "Keys")).toBeUndefined();
  });
});
