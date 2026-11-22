// A key a built-in plugin binds desk-wide is the compositor's before any page hears it (ADR 0118), so
// two built-in plugins never bind the same key on one platform, and no desk-wide key takes a chord the
// Database page keeps for itself (PG-01g): on macOS the terminal's split once took Mod+Shift+Enter,
// and the console's run-script key never reached the editor. The editor's footer names the key that
// runs the script.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canonical } from "../../../packages/runtime/src/input";
import { DEFAULT_KEYS } from "../../../packages/runtime/src/core/keys";
import { actionFor, BINDINGS, hints } from "../ui/keys.js";

const PLUGINS = new URL("../../", import.meta.url);
type Key = { key: string; mac?: string; command: string };
/** Every desk-wide key of the built-in plugins, with the plugin that binds it. */
const bound = readdirSync(PLUGINS).flatMap((name) => {
  try {
    const manifest = JSON.parse(readFileSync(new URL(`${name}/plugin.json`, PLUGINS), "utf8"));
    const keys = (manifest.contributes?.keys ?? []) as Key[];
    return keys.map((key) => ({ plugin: manifest.id as string, ...key }));
  } catch {
    return [];
  }
});
const PLATFORMS = ["mac", "other"] as const;
const on = (key: { key: string; mac?: string }, platform: "mac" | "other") =>
  canonical(platform === "mac" && key.mac ? key.mac : key.key, platform);

describe("built-in keys that clash (PG-01g)", () => {
  it("no two built-in plugins bind the same desk-wide key on one platform", () => {
    expect(bound.length).toBeGreaterThan(10);
    for (const platform of PLATFORMS) {
      const owners = new Map<string, string>();
      const clashes: string[] = [];
      for (const key of bound) {
        const combo = on(key, platform);
        const owner = owners.get(combo);
        if (owner && owner !== key.plugin)
          clashes.push(`${platform} ${combo}: ${owner} and ${key.plugin}`);
        owners.set(combo, key.plugin);
      }
      expect(clashes).toEqual([]);
    }
  });

  it("no desk-wide key takes a chord the Database page keeps", () => {
    const kept = [...BINDINGS.editor, ...BINDINGS.grid]
      .map((b) => b.chord)
      .filter((chord) => chord.startsWith("Mod+"));
    expect(kept).toContain("Mod+Shift+Enter");
    for (const platform of PLATFORMS) {
      const desk = [
        ...bound.map((key) => ({ who: key.plugin, combo: on(key, platform) })),
        ...DEFAULT_KEYS.map((key) => ({ who: "desk", combo: on(key, platform) })),
      ];
      const taken = kept.flatMap((chord) => {
        const combo = canonical(chord, platform);
        return desk.filter((d) => d.combo === combo).map((d) => `${platform} ${chord}: ${d.who}`);
      });
      expect(taken).toEqual([]);
    }
  });

  it("the editor's footer names the run-script key the editor runs", () => {
    const press = { key: "Enter", mod: true, shift: true, alt: false };
    expect(actionFor("editor", press)).toBe("runAll");
    expect(hints("editor")).toMatch(/Mod\+Shift\+Enter run script/u);
  });
});
