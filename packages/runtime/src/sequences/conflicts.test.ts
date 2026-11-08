import { describe, expect, it } from "vitest";
import { type KeyEntry, resolveBindings } from "./conflicts";
import { conflictText, lintLines } from "./report";

const keysYaml = (line: number) => ({ file: "~/.desk/keys.yaml", line });
const manifest = (n: number) => ({
  file: "/desk/plugins/notes/plugin.json",
  path: `contributes.keys[${n}]`,
});

describe("the conflict resolver", () => {
  it("reports two commands on the same sequence, with both sources, and keeps the later one", () => {
    const entries: KeyEntry[] = [
      {
        key: "Mod+K Mod+S",
        command: "example.notes.save-all",
        owner: "example.notes",
        source: manifest(0),
      },
      { key: "Mod+K Mod+S", command: "example.todo.sort", owner: "example.todo" },
    ];
    const { bindings, conflicts } = resolveBindings(entries, "mac");
    expect(bindings.map((b) => [b.combo, b.command])).toEqual([
      ["Meta+K Meta+S", "example.todo.sort"],
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      kind: "duplicate",
      severity: "warning",
      bound: false,
      binding: { command: "example.notes.save-all", source: manifest(0) },
      by: { command: "example.todo.sort", owner: "example.todo" },
    });
    expect(conflictText(conflicts[0] ?? ({} as never), { platform: "mac" })).toBe(
      "⌘K ⌘S for example.notes.save-all (/desk/plugins/notes/plugin.json contributes.keys[0]) is replaced by example.todo.sort (plugin example.todo)",
    );
  });

  it("reports a shorter key that shadows a sequence: the higher layer's binding wins", () => {
    // The person binds Mod+K; a plugin's Mod+K Mod+S can then never be reached.
    const entries: KeyEntry[] = [
      {
        key: "Mod+K Mod+S",
        command: "example.notes.save-all",
        owner: "example.notes",
        source: manifest(1),
      },
      { key: "Mod+K", command: "desk.palette.open", owner: "person", source: keysYaml(4) },
    ];
    const { bindings, conflicts } = resolveBindings(entries, "other");
    expect(bindings.map((b) => b.combo)).toEqual(["Control+K"]);
    expect(conflicts).toMatchObject([
      {
        kind: "shadowed",
        severity: "info",
        binding: { combo: "Control+K Control+S", source: manifest(1) },
        by: { combo: "Control+K", source: keysYaml(4) },
      },
    ]);
    expect(lintLines(conflicts, { platform: "other" })).toEqual([
      "/desk/plugins/notes/plugin.json contributes.keys[1]: info: Ctrl+K Ctrl+S for example.notes.save-all (/desk/plugins/notes/plugin.json contributes.keys[1]) cannot be reached: Ctrl+K runs desk.palette.open (~/.desk/keys.yaml:4)",
    ]);
  });

  it("reports a sequence that shadows a shorter key: the shorter one only waits now", () => {
    const entries: KeyEntry[] = [
      { key: "Mod+K", command: "desk.palette.open", owner: "desk" },
      { key: "Mod+K Mod+S", command: "example.notes.save-all", owner: "example.notes" },
    ];
    const { bindings, conflicts } = resolveBindings(entries, "mac");
    expect(bindings.map((b) => b.combo)).toEqual(["Meta+K Meta+S"]);
    expect(conflicts).toMatchObject([
      {
        kind: "shadowed",
        severity: "info",
        binding: { combo: "Meta+K", command: "desk.palette.open", layer: "default" },
        by: { combo: "Meta+K Meta+S", layer: "plugin" },
      },
    ]);
    expect(conflictText(conflicts[0] ?? ({} as never), { platform: "mac" })).toMatch(
      /^⌘K for desk\.palette\.open \(core default\) is a prefix of ⌘K ⌘S/,
    );
    // Within one layer it is a warning: the layer is at odds with itself.
    const same = resolveBindings(
      [
        { key: "Ctrl+X", command: "example.a.cut", owner: "example.a" },
        { key: "Ctrl+X Ctrl+F", command: "example.b.find", owner: "example.b" },
      ],
      "other",
    );
    expect(same.conflicts.map((c) => [c.kind, c.severity, c.binding.command])).toEqual([
      ["shadowed", "warning", "example.a.cut"],
    ]);
  });

  it("reports chords the system or the desk keeps, and never binds a cancel key after a prefix", () => {
    const entries: KeyEntry[] = [
      { key: "Mod+Q", command: "example.notes.quit", owner: "example.notes" },
      { key: "Mod+Shift+Space", command: "example.notes.find", owner: "person" },
      {
        key: "Ctrl+X Escape",
        command: "example.notes.close",
        owner: "person",
        source: keysYaml(7),
      },
      { key: "Ctrl+X Ctrl+G", command: "example.notes.go", owner: "person" },
      { key: "Mod+Tab", command: "example.notes.next", owner: "person" },
    ];
    const mac = resolveBindings(entries, "mac");
    expect(
      mac.conflicts.map((c) => [c.binding.combo, c.severity, c.bound, c.reserved?.by]),
    ).toEqual([
      ["Control+X Control+G", "error", false, "the desk"],
      ["Control+X Escape", "error", false, "the desk"],
      ["Meta+Q", "warning", true, "macOS"],
      ["Meta+Shift+Space", "warning", true, "the desk"],
      ["Meta+Tab", "warning", true, "macOS"],
    ]);
    expect(mac.bindings.map((b) => b.combo)).toEqual(["Meta+Q", "Meta+Shift+Space", "Meta+Tab"]);
    expect(lintLines(mac.conflicts, { platform: "mac" })[1]).toBe(
      "~/.desk/keys.yaml:7: error: ⌃X Esc for example.notes.close (~/.desk/keys.yaml:7) can never run: Esc cancels a pending prefix",
    );
    // Elsewhere Ctrl+Q and Ctrl+Tab reach the desk; Ctrl+Shift+Space is still the desk's own.
    const other = resolveBindings(entries, "other");
    expect(other.conflicts.map((c) => [c.binding.combo, c.severity])).toEqual([
      ["Control+Shift+Space", "warning"],
      ["Control+X Control+G", "error"],
      ["Control+X Escape", "error"],
    ]);
  });

  it("orders by precedence, personal > plugin > default, whatever order the layers come in", () => {
    const entries: KeyEntry[] = [
      { key: "Mod+J", command: "example.person.jump", owner: "person" },
      { key: "Mod+J", command: "example.notes.jump", owner: "example.notes" },
      { key: "Mod+J", command: "desk.buffers.jump", owner: "desk" },
      { key: "Mod+L", command: "example.notes.list", owner: "example.notes" },
      { key: "Mod+L", command: "desk.keys.list", owner: "desk" },
    ];
    const { bindings, conflicts } = resolveBindings(entries, "other");
    expect(bindings.map((b) => [b.combo, b.command])).toEqual([
      ["Control+J", "example.person.jump"],
      ["Control+L", "example.notes.list"],
    ]);
    expect(conflicts.map((c) => [c.binding.command, c.by?.command, c.severity])).toEqual([
      ["example.notes.jump", "example.person.jump", "info"],
      ["desk.buffers.jump", "example.person.jump", "info"],
      ["desk.keys.list", "example.notes.list", "info"],
    ]);
  });

  it("drops nothing silently: every binding is in force, lost to a conflict, or taken away", () => {
    const entries: KeyEntry[] = [
      { key: "Mod+K", command: "desk.palette.open", owner: "desk" },
      { key: "Mod+W", command: "desk.buffers.close", owner: "desk" },
      { key: "Mod+K Mod+S", command: "example.notes.save-all", owner: "example.notes" },
      { key: "Mod+K Mod+S Mod+A", command: "example.notes.save-as", owner: "example.notes" },
      { key: "Ctrl+C p f", command: "example.project.file", owner: "example.project" },
      { key: "Ctrl+C p", command: "example.project.menu", owner: "example.project" },
      { key: "Mod+W", command: "", owner: "person" },
      { key: "Mod+Q", command: "example.notes.quit", owner: "person" },
      { key: "Ctrl+C p f", command: "example.person.find", owner: "person" },
    ];
    const { bindings, conflicts, removed } = resolveBindings(entries, "mac");
    const accounted = [
      ...bindings.map((b) => b.index),
      ...conflicts.filter((c) => !c.bound).map((c) => c.binding.index),
      ...removed.map((b) => b.index),
    ].sort((a, b) => a - b);
    const withCommand = entries.flatMap((e, i) => (e.command ? [i] : []));
    expect(accounted).toEqual(withCommand);
    // The unbinding is intended: Mod+W is taken away, not reported.
    expect(removed.map((b) => b.command)).toEqual(["desk.buffers.close"]);
    expect(conflicts.some((c) => c.binding.command === "desk.buffers.close")).toBe(false);
    expect(bindings.map((b) => b.command)).toEqual([
      "example.person.find",
      "example.notes.save-as",
      "example.notes.quit",
    ]);
  });
});
