import { BridgeClient, browserStub, type PluginInfo } from "@endue-ai/bridge";
import { describe, expect, it } from "vitest";
import themeManifest from "../../../../plugins/theme/plugin.json";
import type { Clock } from "../clock";
import { PolicyHub } from "../hub";
import type { DeskContext } from "../policies/context";
import { installTheme } from "../policies/theme";

const paper: PluginInfo = {
  id: "example.paper",
  status: "ready",
  enabled: true,
  builtIn: false,
  revision: 2,
  manifest: {
    id: "example.paper",
    name: "Paper",
    version: "1.0.0",
    kind: "theme",
    theme: { shape: { radius: "none" }, dark: { colors: { background: "#1b1915" } } },
  },
};
const deskTheme = {
  id: "desk.theme",
  status: "ready",
  enabled: true,
  builtIn: true,
  revision: 1,
  manifest: themeManifest,
} as PluginInfo;

function setup() {
  const bridge = new BridgeClient(browserStub({}));
  const hub = new PolicyHub(bridge);
  hub.apply([deskTheme, paper]);
  const shared: unknown[] = [];
  const style = new Map<string, string>();
  const root = {
    dataset: {} as Record<string, string>,
    ownerDocument: { fonts: undefined, defaultView: null },
    style: {
      get length() {
        return style.size;
      },
      item: (i: number) => [...style.keys()][i] ?? "",
      setProperty: (name: string, value: string) => style.set(name, value),
      removeProperty: (name: string) => style.delete(name),
    },
  } as unknown as HTMLElement;
  const ctx = {
    hub,
    root,
    win: { matchMedia: undefined } as unknown as Window,
    clock: {} as Clock,
    bridge,
    share: (message: unknown) => shared.push(message),
  } as unknown as DeskContext;
  const theme = installTheme(ctx, root, (id, path, revision) => `/p/${id}/${path}?v=${revision}`);
  return { hub, theme, style, shared };
}

describe("the studio's preview and apply", () => {
  it("preview shows a theme on the whole desk without touching the setting", () => {
    const { hub, theme, style } = setup();
    expect(style.get("--desk-radius-md")).toBe("8px");
    theme.preview("example.paper");
    expect(theme.previewing()).toBe("example.paper");
    expect(style.get("--desk-radius-md")).toBe("0px");
    expect(style.get("--desk-background")).toBe("#1b1915");
    expect(hub.settings.get("desk.theme.active", "")).toBe("");
    theme.preview(undefined);
    expect(style.get("--desk-radius-md")).toBe("8px");
  });

  it("apply chooses it, ends the preview, and tells listeners", () => {
    const { hub, theme, style } = setup();
    let heard = 0;
    theme.onChange(() => heard++);
    theme.preview("example.paper");
    theme.apply("example.paper");
    expect(theme.previewing()).toBeUndefined();
    expect(hub.settings.get("desk.theme.active", "")).toBe("example.paper");
    expect(theme.active()).toBe("example.paper");
    expect(style.get("--desk-radius-md")).toBe("0px");
    expect(heard).toBeGreaterThanOrEqual(2);
    theme.apply("");
    expect(style.get("--desk-radius-md")).toBe("8px");
  });

  it("ignores a theme that is not installed, and drops a preview whose theme left", () => {
    const { hub, theme, style } = setup();
    theme.preview("example.gone");
    expect(theme.previewing()).toBeUndefined();
    theme.apply("example.gone");
    expect(hub.settings.get("desk.theme.active", "")).toBe("");
    theme.preview("example.paper");
    hub.apply([deskTheme]);
    expect(theme.previewing()).toBeUndefined();
    expect(style.get("--desk-radius-md")).toBe("8px");
  });

  it("resolves any theme for a card, in either scheme, without applying it", () => {
    const { theme, style } = setup();
    expect(theme.resolve("example.paper", "dark").tokens.background).toBe("#1b1915");
    expect(theme.resolve("example.paper", "light").tokens.radiusMd).toBe("0px");
    expect(theme.resolve("", "light").tokens.background).toBe("#faf9fc");
    expect(style.get("--desk-background")).toBe("#141416");
  });
});
