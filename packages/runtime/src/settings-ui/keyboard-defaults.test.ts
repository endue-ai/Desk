import { readdirSync, readFileSync } from "node:fs";
import type { PluginManifest } from "@endue-ai/bridge";
import { describe, expect, test } from "vitest";
import { DEFAULT_KEYS } from "../core/keys";
import { type KeyEntry, resolveBindings } from "../sequences/conflicts";
import { shownConflicts } from "./key-conflicts";

// Settings › Keyboard on a fresh desk (#158 finding 16): the desk's own keys and every built-in
// plugin's, as they ship, hold no conflict a person is shown, on any platform. (Elsewhere Mod+1 is
// the core's Control+1 again, for the same command: nothing is lost, so nothing is shown.)
const plugins = new URL("../../../../plugins/", import.meta.url);
const builtIn = (): KeyEntry[] =>
  readdirSync(plugins, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      let manifest: PluginManifest;
      try {
        manifest = JSON.parse(
          readFileSync(new URL(`${entry.name}/plugin.json`, plugins), "utf8"),
        ) as PluginManifest;
      } catch {
        return [];
      }
      return (manifest.contributes?.keys ?? []).map((key) => ({ ...key, owner: manifest.id }));
    });

describe("the keys a fresh desk ships with", () => {
  test.each(["mac", "other"] as const)("hold no conflict on %s", (platform) => {
    const { conflicts } = resolveBindings([...DEFAULT_KEYS, ...builtIn()], platform);
    const shown = shownConflicts(conflicts).map(
      (c) => `${c.kind} ${c.binding.combo} ${c.binding.command}`,
    );
    expect(shown).toEqual([]);
  });

  test("moving a window to a desktop keeps clear of the Mac's screenshot keys", () => {
    const { bindings } = resolveBindings([...DEFAULT_KEYS, ...builtIn()], "mac");
    const move = bindings.filter((b) => /^desk\.shell\.move-to-desktop-\d$/.test(b.command));
    expect(move.map((b) => b.combo)).toEqual(
      Array.from({ length: 9 }, (_, i) => `Control+Shift+${i + 1}`),
    );
  });
});
