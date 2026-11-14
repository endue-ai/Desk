import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { PluginInfo, PluginManifest } from "@endue-ai/bridge";
import { describe, expect, it } from "vitest";
import { chosenOf, DEFAULTS, mayMount, ownsRole, providerOf, ROLES } from "./roles";

// Roles (BR-05, ADR 0104): desk.roles names a role's provider; a role it leaves out keeps its default.
const plugin = (id: string, provides: string[], enabled = true): PluginInfo =>
  ({
    id,
    status: "ready",
    enabled,
    revision: 1,
    manifest: { id, version: "0.1.0", kind: "ui", entry: "ui/index.html", provides },
  }) as unknown as PluginInfo;
const toolbar = plugin("endue.toolbar", ["role:rail"]);
const rail = plugin("test.rail", ["role:rail"]);
const plain = plugin("endue.notes", []);

describe("roles", () => {
  it("leaves every role to its default while the setting names nobody", () => {
    for (const role of ROLES) expect(providerOf(role, {}, [toolbar, rail])).toBe(DEFAULTS[role]);
    expect(DEFAULTS["role:rail"]).toBe("desk.shell");
    expect(DEFAULTS["role:palette"]).toBe("desk.palette");
    expect(mayMount(toolbar, {})).toBe(true);
    expect(mayMount(plain, { "role:rail": "test.rail" })).toBe(true);
    expect(ownsRole("role:rail", {})).toBe(true);
  });

  it("gives a named role to its provider alone, and leaves it empty when that one is off", () => {
    const chosen = { "role:rail": "test.rail" };
    expect(providerOf("role:rail", chosen, [toolbar, rail])).toBe("test.rail");
    expect(mayMount(rail, chosen)).toBe(true);
    expect(mayMount(toolbar, chosen)).toBe(false);
    expect(ownsRole("role:rail", chosen)).toBe(false);
    expect(
      providerOf("role:rail", chosen, [toolbar, plugin("test.rail", ["role:rail"], false)]),
    ).toBe(null);
    // A named plugin that does not provide the role, or is not installed, fills nothing.
    expect(providerOf("role:rail", { "role:rail": "endue.notes" }, [plain])).toBe(null);
    expect(providerOf("role:rail", { "role:rail": "nobody.here" }, [])).toBe(null);
    // Naming the default is the default.
    expect(ownsRole("role:rail", { "role:rail": "desk.shell" })).toBe(true);
  });

  it("reads whatever was stored as role to plugin id", () => {
    expect(chosenOf(null)).toEqual({});
    expect(chosenOf(["role:rail"])).toEqual({});
    expect(chosenOf({ "role:dock": "endue.dock" })).toEqual({ "role:dock": "endue.dock" });
  });

  it("the edge plugins and the palette declare the roles they fill; the shell declares desk.roles", () => {
    const root = join(import.meta.dirname, "../../..");
    const read = (name: string) =>
      JSON.parse(
        readFileSync(join(root, "plugins", name, "plugin.json"), "utf8"),
      ) as PluginManifest & {
        contributes?: { settings?: Record<string, { kind: string }> };
      };
    expect(read("toolbar").provides).toEqual(["role:rail"]);
    expect(read("sidebar").provides).toEqual(["role:agents"]);
    expect(read("palette").provides).toEqual(["role:palette"]);
    expect(read("shell").contributes?.settings?.["desk.roles"]?.kind).toBe("object");
  });

  it("the desk ships no dock: no built-in plugin sits on the bottom edge or fills role:dock (#276)", () => {
    const plugins = join(import.meta.dirname, "../../../plugins");
    const manifests = readdirSync(plugins)
      .filter((name) => existsSync(join(plugins, name, "plugin.json")))
      .map((name) => JSON.parse(readFileSync(join(plugins, name, "plugin.json"), "utf8")));
    const bottom = manifests.filter(
      (m: PluginManifest) =>
        m.provides?.includes("role:dock") || m.surfaces?.some((s) => s.placement === "bottom"),
    );
    expect(bottom.map((m: PluginManifest) => m.id)).toEqual([]);
    // Nor does a sample profile name one to turn off.
    const shell = readFileSync(join(plugins, "shell/plugin.json"), "utf8");
    expect(shell).not.toContain("endue.dock");
  });
});
