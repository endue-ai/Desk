import { readFileSync } from "node:fs";
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
    expect(read("dock").provides).toEqual(["role:dock"]);
    expect(read("palette").provides).toEqual(["role:palette"]);
    expect(read("shell").contributes?.settings?.["desk.roles"]?.kind).toBe("object");
  });
});
