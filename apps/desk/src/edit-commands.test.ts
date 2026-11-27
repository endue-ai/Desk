import { describe, expect, it } from "vitest";
import { EDIT_COMMANDS, installEditCommands } from "./edit-commands";

describe("desk.edit.*", () => {
  it("defines the Edit menu as desk commands that ask the shell to run them where the keys are", async () => {
    const defined = new Map<string, () => Promise<void>>();
    const sent: Array<[string, Record<string, unknown>]> = [];
    const off = installEditCommands(
      {
        define: (id, spec) => {
          defined.set(id, spec.run);
          return () => defined.delete(id);
        },
      },
      async (command, args) => {
        sent.push([command, args]);
      },
    );
    expect([...defined.keys()]).toEqual(EDIT_COMMANDS.map((c) => `desk.edit.${c.name}`));
    await defined.get("desk.edit.paste")?.();
    await defined.get("desk.edit.select-all")?.();
    expect(sent).toEqual([
      ["compositor_edit_command", { command: "paste" }],
      ["compositor_edit_command", { command: "select-all" }],
    ]);
    off();
    expect(defined.size).toBe(0);
  });
});
