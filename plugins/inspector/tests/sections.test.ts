import { describe, expect, it } from "vitest";
import { exported, fetchSection, pluginState, SECTIONS } from "../ui/sections.js";
import { ANSWERS, EXPORT } from "./harness";

const MANAGE = { permission: "perm:manage" };

/** The bridge and the command runner as the answers give them, recording every call. */
function sources() {
  const calls: Array<[string, unknown]> = [];
  return {
    calls,
    call: async (method: string, params: unknown) => {
      calls.push([method, params]);
      return ANSWERS[method];
    },
    run: async (id: string, args: { section: string }) => {
      calls.push([id, args]);
      return ANSWERS[id][args.section];
    },
  };
}

describe("the sections", () => {
  it("are read from their methods under their scopes", async () => {
    expect(SECTIONS).toEqual([
      "tree",
      "surfaces",
      "commands",
      "grants",
      "settings",
      "plugins",
      "calls",
    ]);
    const asked = sources();
    for (const section of SECTIONS) await fetchSection(section, asked as never);
    expect(asked.calls).toEqual([
      ["desk.inspect.open", { section: "tree" }],
      ["desk.inspect.open", { section: "surfaces" }],
      ["cmd.recent", { scope: MANAGE }],
      ["perm.list", { scope: MANAGE }],
      ["desk.inspect.open", { section: "settings" }],
      ["plugin.list", { scope: { permission: "plugin:manage" } }],
      ["plugin.stats", { scope: MANAGE }],
    ]);
    expect(await fetchSection("commands", sources() as never)).toEqual(
      ANSWERS["cmd.recent"].invocations,
    );
    expect(await fetchSection("grants", sources() as never)).toEqual(ANSWERS["perm.list"].grants);
    expect(await fetchSection("calls", sources() as never)).toEqual(ANSWERS["plugin.stats"]);
  });

  it("name a plugin's state, and quarantined or not responding only when plugin.list says", () => {
    const [palette, sheets, terminal, broken] = ANSWERS["plugin.list"].plugins;
    expect(pluginState(palette)).toEqual({
      id: "desk.palette",
      name: "Palette",
      kind: "ui",
      version: "0.1.0",
      state: "on",
      autoload: false,
      builtIn: true,
      status: "ready",
    });
    expect(pluginState(sheets)).toMatchObject({ state: "off", autoload: true });
    expect(pluginState(sheets)).not.toHaveProperty("quarantined");
    expect(pluginState(terminal)).toMatchObject({ quarantined: false, notResponding: true });
    expect(pluginState(broken)).toEqual({
      id: "example.broken",
      state: "off",
      autoload: false,
      builtIn: false,
      status: "failed",
      error: "plugin.json: /kind must be one of ui, logic, tool",
      quarantined: true,
    });
  });

  it("export every section as desk inspect prints it, byte for byte", async () => {
    const asked = sources();
    const all: Record<string, unknown> = {};
    for (const section of SECTIONS) all[section] = await fetchSection(section, asked as never);
    expect(`${exported(all)}\n`).toBe(EXPORT);
  });

  it("export one section as an object with that section alone, keys sorted", async () => {
    const commands = await fetchSection("commands", sources() as never);
    const text = exported({ commands });
    expect(JSON.parse(text)).toEqual({ commands: JSON.parse(EXPORT).commands });
    expect(text.split("\n").slice(0, 4)).toEqual([
      "{",
      '  "commands": [',
      "    {",
      '      "at": "2026-11-02T09:00:00.120Z",',
    ]);
  });
});
