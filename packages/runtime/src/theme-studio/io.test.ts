import { BridgeClient, type BridgeEvent, browserStub, type PluginInfo } from "@endue-ai/bridge";
import { describe, expect, it } from "vitest";
import themeManifest from "../../../../plugins/theme/plugin.json";
import { themeHandlers } from "../bridge/core-themes";
import type { Clock } from "../clock";
import { PolicyHub } from "../hub";
import type { DeskContext } from "../policies/context";
import { installTheme } from "../policies/theme";

const deskTheme = {
  id: "desk.theme",
  status: "ready",
  enabled: true,
  builtIn: true,
  revision: 1,
  manifest: themeManifest,
} as PluginInfo;
const amber: PluginInfo = {
  id: "endue.theme-amber",
  status: "ready",
  enabled: true,
  builtIn: true,
  revision: 1,
  manifest: {
    id: "endue.theme-amber",
    name: "Amber CRT",
    version: "1.0.0",
    kind: "theme",
    theme: { dark: { colors: { background: "#120c04" } } },
  },
};

function setup() {
  const plugins: PluginInfo[] = [deskTheme, amber];
  const events: BridgeEvent[] = [];
  const calls: Array<{ method: string; params: unknown }> = [];
  const handlers = themeHandlers(plugins, (event) => events.push(event));
  const recorded = Object.fromEntries(
    Object.entries(handlers).map(([method, handler]) => [
      method,
      (params: unknown, caller: string | undefined) => {
        calls.push({ method, params });
        return (handler as (p: unknown, c: string | undefined) => unknown)(params, caller);
      },
    ]),
  );
  const bridge = new BridgeClient(browserStub(recorded));
  const hub = new PolicyHub(bridge);
  hub.apply(plugins);
  const root = {
    dataset: {},
    ownerDocument: { fonts: undefined, defaultView: null },
    style: { length: 0, item: () => "", setProperty: () => {}, removeProperty: () => {} },
  } as unknown as HTMLElement;
  const ctx = {
    hub,
    root,
    win: {} as Window,
    clock: {} as Clock,
    bridge,
    share: () => {},
  } as unknown as DeskContext;
  return { theme: installTheme(ctx, root), plugins, events, calls, hub };
}

describe("the studio's theme.* (save, export, import, remove)", () => {
  it("saves a draft as a kind theme manifest under its local id, with new files and copyFrom", async () => {
    const { theme, calls, plugins } = setup();
    await theme.io().save(
      {
        id: "local.my-amber",
        name: "My Amber",
        description: "Mine.",
        theme: { dark: { colors: { primary: "#ffb000" } } },
      },
      [{ path: "images/tile.png", base64: "iVBORw0K" }],
      "endue.theme-amber",
    );
    expect(calls[0]).toEqual({
      method: "theme.save",
      params: {
        manifest: {
          id: "local.my-amber",
          name: "My Amber",
          version: "1.0.0",
          kind: "theme",
          description: "Mine.",
          theme: { dark: { colors: { primary: "#ffb000" } } },
        },
        files: [{ path: "images/tile.png", base64: "iVBORw0K" }],
        copyFrom: "endue.theme-amber",
        scope: { permission: "theme:manage" },
      },
    });
    expect(plugins.some((p) => p.id === "local.my-amber")).toBe(true);
  });

  it("exports a theme to a file, imports a bundle under a local id, and removes a user theme", async () => {
    const { theme, calls, plugins } = setup();
    expect(await theme.io().exportTheme("endue.theme-amber")).toBe(
      "~/Downloads/endue.theme-amber.desk-theme",
    );
    const id = await theme.io().importBundle({
      format: "desk-theme/1",
      manifest: { ...amber.manifest, id: "someone.amber", name: "Their Amber" },
      files: {},
    });
    expect(id).toBe("local.their-amber");
    await theme.io().remove(id);
    expect(plugins.some((p) => p.id === id)).toBe(false);
    expect(calls.map((c) => c.method)).toEqual(["theme.export", "theme.import", "theme.remove"]);
    await expect(theme.io().remove("endue.theme-amber")).rejects.toThrow();
  });

  it("chooses a theme just saved before plugin.list lists it", () => {
    const { theme, hub } = setup();
    theme.apply("local.not-listed-yet");
    expect(hub.settings.get("desk.theme.active", "")).toBe("local.not-listed-yet");
    theme.apply("example.unknown");
    expect(hub.settings.get("desk.theme.active", "")).toBe("");
  });
});
