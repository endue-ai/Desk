import type { BridgeRequest, PluginInfo } from "@endue-ai/bridge";
import { describe, expect, it } from "vitest";
import { deskPluginUrl, named, pluginLabel, surfaceHost, surfaceOf } from "./plugin-origins";

describe("plugin origins (#36)", () => {
  it("make a plugin id one host label: hyphens doubled, dots one hyphen", () => {
    expect(pluginLabel("endue.notes")).toBe("endue-notes");
    expect(pluginLabel("example.hello-ui")).toBe("example-hello--ui");
    expect(pluginLabel("a.b.c")).toBe("a-b-c");
    // Ids that a plain dot-to-hyphen would merge stay apart.
    expect(pluginLabel("a.b-c")).not.toBe(pluginLabel("a-b.c"));
    expect(pluginLabel("a-.b")).not.toBe(pluginLabel("a.b-"));
  });

  it("put the surface first and the plugin after it", () => {
    expect(surfaceHost("example.hello-ui", "main")).toBe("main.example-hello--ui");
    expect(surfaceHost("endue.notes", "side-panel")).toBe("side-panel.endue-notes");
    expect(surfaceHost("endue.notes")).toBe("main.endue-notes");
  });

  it("give no host to ids a host cannot carry, so those surfaces keep the shared one", () => {
    expect(surfaceHost("Endue.Notes", "main")).toBeUndefined();
    expect(surfaceHost("notes", "main")).toBeUndefined();
    expect(surfaceHost("endue.notes", "Main")).toBeUndefined();
    expect(surfaceHost("endue.notes", "a.b")).toBeUndefined();
    // A label that starts xn-- is punycode to a URL parser.
    expect(surfaceHost("xn-a.notes", "main")).toBeUndefined();
    expect(surfaceHost("endue.notes", "xn--a")).toBeUndefined();
  });

  it("open the first surface a manifest declares, or main", () => {
    const manifest = { id: "a.b", version: "0.1.0", kind: "ui" as const };
    expect(surfaceOf(undefined)).toBe("main");
    expect(surfaceOf(manifest)).toBe("main");
    const surfaces = [
      { id: "board", placement: "center" as const },
      { id: "side", placement: "right" as const },
    ];
    expect(surfaceOf({ ...manifest, surfaces })).toBe("board");
  });

  it("build the app's URLs per surface on every platform's form of the scheme", () => {
    const mac = deskPluginUrl(false);
    const windows = deskPluginUrl(true);
    expect(mac("example.hello-ui", "ui/index.html", 3, "main")).toBe(
      "desk-plugin://main.example-hello--ui/example.hello-ui/ui/index.html?v=3",
    );
    expect(windows("example.hello-ui", "ui/index.html", 3, "main")).toBe(
      "http://desk-plugin.main.example-hello--ui.localhost/example.hello-ui/ui/index.html?v=3",
    );
    // What the desk loads itself (a theme's font) stays on the shared host.
    expect(mac("acme.theme", "plex.woff2", 1)).toBe(
      "desk-plugin://localhost/acme.theme/plex.woff2?v=1",
    );
    expect(windows("acme.theme", "plex.woff2", 1)).toBe(
      "http://desk-plugin.localhost/acme.theme/plex.woff2?v=1",
    );
    expect(mac("xn-a.notes", "ui/index.html", 1, "main")).toBe(
      "desk-plugin://localhost/xn-a.notes/ui/index.html?v=1",
    );
  });

  it("name the calling window's surface in web.open, whatever the plugin sent (ADR 0216)", () => {
    const scope = { permission: "web:browse" } as const;
    const open = (params: object): BridgeRequest =>
      ({ id: 7, method: "web.open", params: { scope, ...params } }) as BridgeRequest;
    const info = { id: "endue.browser", manifest: { surfaces: [{ id: "main" }] } } as PluginInfo;
    const mounted = new Map([[info.id, info]]);
    const url = "https://example.com/";
    expect(named("endue.browser", open({ url }), mounted)).toEqual(
      open({ url, surface: "main.endue-browser" }),
    );
    // Its second window, and a plugin that names another's surface: its own all the same.
    expect(named("endue.browser@2", open({ surface: "main.endue-notes" }), mounted)).toEqual(
      open({ surface: "main--2.endue-browser" }),
    );
    // Every other call goes as it came.
    const load = { id: 8, method: "web.load", params: { viewId: "w-1", url, scope } };
    expect(named("endue.browser", load as BridgeRequest, mounted)).toBe(load);
  });
});
