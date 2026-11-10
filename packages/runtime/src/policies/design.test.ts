import {
  BridgeClient,
  type BridgeEvent,
  browserStub,
  type PluginInfo,
  type ThemeTokensParams,
} from "@endue-ai/bridge";
import { componentTokens } from "@endue-ai/ui/design";
import { describe, expect, it } from "vitest";
import designManifest from "../../../../plugins/design/plugin.json";
import softManifest from "../../../../plugins/design-soft/plugin.json";
import themeManifest from "../../../../plugins/theme/plugin.json";
import { themeHandlers } from "../bridge/core-themes";
import type { Clock } from "../clock";
import { PolicyHub } from "../hub";
import type { DeskContext } from "./context";
import { localDesignId } from "./design";
import { installTheme } from "./theme";

const plugin = (manifest: unknown): PluginInfo =>
  ({
    id: (manifest as { id: string }).id,
    status: "ready",
    enabled: true,
    builtIn: true,
    revision: 1,
    manifest,
  }) as PluginInfo;

function setup() {
  const plugins: PluginInfo[] = [themeManifest, designManifest, softManifest].map(plugin);
  const events: BridgeEvent[] = [];
  const calls: Array<{ method: string; params: unknown }> = [];
  const looks: ThemeTokensParams[] = [];
  const handlers = themeHandlers(plugins, (event) => events.push(event));
  const recorded = Object.fromEntries(
    Object.entries(handlers).map(([method, handler]) => [
      method,
      (params: unknown, caller: string | undefined) => {
        // The look in force goes to the core on every change (theme.tokens, ADR 0146).
        if (method === "theme.tokens") looks.push(params as ThemeTokensParams);
        else calls.push({ method, params });
        return (handler as (p: unknown, c: string | undefined) => unknown)(params, caller);
      },
    ]),
  );
  const bridge = new BridgeClient(browserStub(recorded));
  const hub = new PolicyHub(bridge);
  hub.apply(plugins);
  const set = new Map<string, string>();
  const root = {
    dataset: {},
    ownerDocument: { fonts: undefined, defaultView: null },
    style: {
      length: 0,
      item: () => "",
      setProperty: (name: string, value: string) => set.set(name, value),
      removeProperty: (name: string) => set.delete(name),
    },
  } as unknown as HTMLElement;
  const shared: unknown[] = [];
  const ctx = {
    hub,
    root,
    win: {} as Window,
    clock: {} as Clock,
    bridge,
    share: (message: unknown) => shared.push(message),
  } as unknown as DeskContext;
  const theme = installTheme(ctx, root);
  return { theme, designs: theme.designs, hub, calls, looks, plugins, set, shared };
}

describe("desk.design", () => {
  it("starts with the endue design system's component tokens on the desk", () => {
    const { theme, designs, set } = setup();
    expect(designs.active()).toBe("");
    expect(designs.installed().map((d) => d.id)).toEqual(["endue.design-soft"]);
    expect(theme.state().tokens.buttonRadius).toBe(componentTokens.buttonRadius);
    expect(set.get("--desk-button-radius")).toBe("var(--desk-radius-md)");
  });

  it("hands the core the look in force at start and on every change, for the compositor", () => {
    const { designs, hub, looks } = setup();
    expect(looks).toHaveLength(1);
    expect(looks[0]).toMatchObject({
      scheme: "dark",
      design: "",
      scope: { permission: "theme:manage" },
    });
    expect(looks[0]?.tokens.toastRadius).toBe("var(--desk-radius-lg)");
    designs.apply("endue.design-soft");
    expect(looks.at(-1)).toMatchObject({ design: "endue.design-soft" });
    expect(looks.at(-1)?.tokens.buttonRadius).toBe("var(--desk-radius-full)");
    designs.preview("endue.design-soft");
    hub.settings.set("desk.theme.scheme", "light");
    expect(looks.at(-1)?.scheme).toBe("light");
    // A preview of the same look, or an unrelated change, sends nothing new.
    const sent = looks.length;
    designs.preview(undefined);
    hub.settings.set("desk.other", true);
    expect(looks).toHaveLength(sent);
  });

  it("applies a design system over the theme on the desk and in every frame, kept in its setting", () => {
    const { theme, designs, hub, set, shared } = setup();
    designs.apply("endue.design-soft");
    expect(hub.settings.get("desk.design.active", "")).toBe("endue.design-soft");
    expect(theme.state().design).toBe("endue.design-soft");
    expect(set.get("--desk-button-radius")).toBe("var(--desk-radius-full)");
    expect(set.get("--desk-field-bg")).toBe("var(--desk-muted)");
    // The theme's colours stay the theme's.
    expect(set.get("--desk-primary")).toBe(theme.state().tokens.primary);
    const sent = shared.at(-1) as { theme: { variables: Record<string, string> } };
    expect(sent.theme.variables["--desk-tab-selected-bg"]).toBe("var(--desk-primary)");
    designs.apply("");
    expect(set.get("--desk-button-radius")).toBe("var(--desk-radius-md)");
  });

  it("previews a design system or a draft without choosing it, and ends the preview", () => {
    const { designs, hub, set } = setup();
    designs.preview("endue.design-soft");
    expect(set.get("--desk-button-radius")).toBe("var(--desk-radius-full)");
    expect(designs.previewing()).toBe("endue.design-soft");
    designs.previewDraft({ components: { button: { shape: "none" } } });
    expect(set.get("--desk-button-radius")).toBe("0");
    designs.previewDraft(undefined);
    designs.preview(undefined);
    expect(set.get("--desk-button-radius")).toBe("var(--desk-radius-md)");
    expect(hub.settings.get("desk.design.active", "")).toBe("");
    designs.preview("example.nothing");
    expect(designs.previewing()).toBeUndefined();
  });

  it("changes a built-in design system as a copy of the person's, and their own one in place", async () => {
    const { designs, calls, hub, plugins } = setup();
    designs.apply("endue.design-soft");
    const id = await designs.change({ field: { style: "underline" } }, "Soft lines");
    expect(id).toBe("local.soft-lines");
    const saved = calls.at(-1) as { method: string; params: { manifest: Record<string, unknown> } };
    expect(saved.method).toBe("theme.save");
    expect(saved.params.manifest).toMatchObject({
      id: "local.soft-lines",
      kind: "design-system",
      designSystem: {
        origin: { base: "endue.design-soft" },
        components: { field: { style: "underline", shape: "lg" }, button: { shape: "full" } },
      },
    });
    expect(hub.settings.get("desk.design.active", "")).toBe("local.soft-lines");
    hub.apply([...plugins]);
    const again = await designs.change({ button: { case: "uppercase" } });
    expect(again).toBe("local.soft-lines");
  });

  it("finds a free local id for a name", () => {
    const taken = new Set(["local.square", "local.square-2"]);
    expect(localDesignId("Square", (id) => taken.has(id))).toBe("local.square-3");
    expect(localDesignId("네모", () => false)).toBe("local.design-custom");
    expect(localDesignId("2 rounded", () => false)).toBe("local.design-2-rounded");
  });

  it("saves, exports, imports and removes through theme.* as kind design-system", async () => {
    const { designs, calls } = setup();
    await designs.io().save({ id: "local.mine", name: "Mine", designSystem: { components: {} } });
    expect(await designs.io().exportDesign("local.mine")).toBe(
      "~/Downloads/local.mine.desk-design",
    );
    await designs.io().remove("local.mine");
    expect(calls.map((c) => c.method)).toEqual(["theme.save", "theme.export", "theme.remove"]);
  });
});
