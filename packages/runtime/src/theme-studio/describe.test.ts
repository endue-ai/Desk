// @vitest-environment jsdom
import {
  type BrainAskParams,
  type BrainStatusResult,
  BridgeClient,
  browserStub,
  type PluginInfo,
} from "@endue-ai/bridge";
import { describe, expect, it, vi } from "vitest";
import themeManifest from "../../../../plugins/theme/plugin.json";
import themeSchema from "../../../../specs/plugin/v0/theme.schema.json";
import type { Clock } from "../clock";
import { PolicyHub } from "../hub";
import type { DeskContext } from "../policies/context";
import { installTheme, type ThemeIo } from "../policies/theme";
import { createDescribe } from "./describe";
import { describePrompt, PROPOSE_THEME } from "./prompt";

const deskTheme = {
  id: "desk.theme",
  status: "ready",
  enabled: true,
  builtIn: true,
  revision: 1,
  manifest: themeManifest,
} as PluginInfo;

// What a brain might answer for "warm paper": a light theme, with values the desk must not take.
const WARM = {
  name: "Warm Paper",
  description: "A light theme from: warm, paper.",
  theme: {
    origin: { prompt: "the brain's own" },
    shape: { radius: "soft", density: "roomy" },
    motion: { personality: "calm" },
    type: { sans: "Georgia, serif", scale: 3, fonts: [{ family: "Ink", src: "fonts/ink.woff2" }] },
    light: {
      colors: {
        background: "#f6f1e7",
        text: "#2a2118",
        textMuted: "#d8cfbf",
        primary: "#9a4a12",
        card: "url(https://example.com/x.png)",
        muted: "#ede4d3; }",
        "bad name": "#ffffff",
      },
      material: { noise: 0.5, blur: 40.4, shadow: "huge" },
      backdrop: { image: "images/paper.png", gradient: ["#f6f1e7", "#ede4d3"], angle: 180 },
    },
  },
};
// The same, cleaned: unsafe tokens, unknown presets, files and the brain's origin gone, numbers in range.
const CLEAN = {
  shape: { radius: "soft" },
  motion: { personality: "calm" },
  type: { sans: "Georgia, serif", scale: 1.25 },
  light: {
    colors: { background: "#f6f1e7", text: "#2a2118", textMuted: "#d8cfbf", primary: "#9a4a12" },
    material: { noise: 0.15, blur: 24 },
    backdrop: { gradient: ["#f6f1e7", "#ede4d3"], angle: 180 },
  },
};

/** The real theme policy over a stub core that serves brain.ask (and brain.status when given). */
function setup(status?: BrainStatusResult) {
  const asked: BrainAskParams[] = [];
  const stub = browserStub({
    "brain.ask": (params) => {
      asked.push(params);
      const turnId = `a${asked.length}`;
      // An event may come before the answer that names its turn; another turn's never counts.
      stub.emit({ event: "brain.turn", data: { turnId: "t1", kind: "delta", text: "hi" } });
      stub.emit({ event: "brain.turn", data: { turnId, kind: "started" } });
      return { turnId };
    },
    ...(status ? { "brain.status": () => status } : {}),
  });
  const bridge = new BridgeClient(stub);
  const hub = new PolicyHub(bridge);
  hub.apply([deskTheme]);
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
    share: () => {},
  } as unknown as DeskContext;
  const themes = installTheme(ctx, root);
  const save = vi.fn(async () => {});
  const io: ThemeIo = { save, exportTheme: vi.fn(), importBundle: vi.fn(), remove: vi.fn() };
  const back = vi.fn();
  const tune = vi.fn();
  const panel = createDescribe({
    themes,
    lang: () => "en",
    io: () => io,
    open: vi.fn(),
    back,
    tune,
  });
  document.body.replaceChildren(panel.element);
  const turn = (turnId: string, kind: "completed" | "error" | "offline" | "online", more = {}) =>
    stub.emit({ event: "brain.turn", data: { turnId, kind, ...more } });
  return { panel, asks: asked, turn, stub, themes, hub, style, save, back, tune };
}

/** Wait for the `n`th ask, and for its answer to reach the panel. */
async function answered(list: unknown[], n: number) {
  await vi.waitFor(() => expect(list).toHaveLength(n));
  await new Promise((done) => setTimeout(done, 0));
}

const key = <T extends HTMLElement = HTMLButtonElement>(name: string) =>
  document.querySelector<T>(`[data-key="${name}"]`);
const status = () => document.querySelector(".theme-describe-status")?.textContent ?? "";
const say = (text: string, button: string) => {
  const field = key<HTMLInputElement>("describe-sentence");
  if (!field) throw new Error("no sentence field");
  field.value = text;
  key(button)?.click();
};

describe("Describe", () => {
  it("sends only the schema, the current values, the rules and the sentence, the sentence last", async () => {
    const { panel, asks, themes } = setup();
    panel.start({ text: "warm paper\n  with grain", run: true });
    await answered(asks, 1);
    const { prompt, tool, scope } = asks[0] as BrainAskParams;
    expect(scope).toEqual({ permission: "brain:ask" });
    expect(tool).toEqual(PROPOSE_THEME);
    expect((tool.schema.properties as Record<string, unknown>).theme).toEqual({
      $ref: "https://endue.ai/specs/plugin/v0/theme.schema.json#/$defs/ThemePackage",
    });
    const lines = prompt.split("\n");
    expect(lines.filter((l) => l.startsWith("## "))).toEqual([
      "## Rules",
      "## Schema",
      "## Current theme",
      "## Sentence",
    ]);
    expect(lines.at(-1)).toBe("warm paper with grain");
    // The rules: what the roles are for, the contrast pairs and the ranges.
    expect(prompt).toContain("primaryForeground");
    expect(prompt).toContain("textMuted/background");
    expect(prompt).toContain("opacity 0.6–1");
    // The theme block's schema, as the desk's spec has it.
    expect(prompt).toContain(JSON.stringify(themeSchema.$defs.ThemeMaterial));
    // The values in force, and nothing else: no files, no paths.
    const current = themes.resolve("");
    expect(prompt).toContain(`"background":"${current.tokens.background}"`);
    expect(prompt).toBe(
      describePrompt({
        sentence: "warm paper with grain",
        current: { name: "endue", scheme: current.scheme, tokens: current.tokens },
      }),
    );
    expect(prompt.length).toBeLessThan(32000);
    // A theme's image is a path to its files: the values leave it out.
    const withImage = describePrompt({
      sentence: "warm paper",
      current: {
        name: "Tiles",
        scheme: "dark",
        tokens: { background: "#102030", backdrop: 'url("/plugins/test.theme/images/tiles.png")' },
      },
    });
    const values = withImage.slice(
      withImage.indexOf("## Current theme"),
      withImage.indexOf("## Sentence"),
    );
    expect(values).toContain('"background":"#102030"');
    expect(values).not.toMatch(/url\(|\/plugins\//);
  });

  it("cleans a proposal and previews it on the whole desk through the gate, in the scheme it has", async () => {
    const { panel, asks, turn, themes, style } = setup();
    panel.start({ text: "warm paper", run: true });
    await answered(asks, 1);
    expect(status()).toContain("Asking the brain");
    turn("a1", "completed", { structured: WARM });
    expect(themes.previewing()).toBe("local.draft");
    expect(themes.installed()).toEqual([]);
    const draft = themes.resolve("local.draft", "light");
    expect(draft.scheme).toBe("light");
    expect(style.get("--desk-background")).toBe("#f6f1e7");
    expect(style.get("--desk-blur")).toBe("24px");
    expect(style.get("--desk-card")).not.toContain("url(");
    // The gate moved the faint muted text, and the panel lists the fix as the editor does.
    const fix = themes.state().fixes.find((f) => f.token === "textMuted");
    expect(fix?.from).toBe("#d8cfbf");
    expect(style.get("--desk-text-muted")).toBe(fix?.to);
    const proposal = document.querySelector(".theme-proposal");
    expect(proposal?.textContent).toContain("Warm Paper");
    expect(proposal?.querySelector(".theme-fixes")?.textContent).toContain("textMuted #d8cfbf →");
  });

  it("refines with the proposal sent back, then applies it as my theme with origin.prompt", async () => {
    const { panel, asks, turn, hub, save, back } = setup();
    panel.start({ text: "warm paper", run: true });
    await answered(asks, 1);
    turn("a1", "completed", { structured: WARM });
    say("warmer", "describe-refine");
    await answered(asks, 2);
    const prompt = (asks[1] as BrainAskParams).prompt;
    expect(prompt).toContain("## Proposal");
    expect(prompt).toContain('"name":"Warm Paper"');
    expect(prompt).toContain('"background":"#f6f1e7"');
    expect(prompt.split("\n").at(-1)).toBe("warmer");
    turn("a2", "completed", { structured: { ...WARM, name: "Warmer Paper" } });
    key("describe-apply")?.click();
    await vi.waitFor(() => expect(save).toHaveBeenCalled());
    const [entry] = save.mock.calls[0] as unknown as [
      { id: string; name: string; theme: { origin?: unknown; light?: unknown } },
    ];
    expect(entry).toMatchObject({ id: "local.warmer-paper", name: "Warmer Paper" });
    expect(entry.theme.origin).toEqual({ prompt: "warm paper → warmer" });
    expect(entry.theme.light).toEqual(CLEAN.light);
    // Applied as it was previewed: the theme, and the light scheme it has.
    await vi.waitFor(() => expect(back).toHaveBeenCalledWith("local.warmer-paper"));
    expect(hub.settings.get("desk.theme.active", "")).toBe("local.warmer-paper");
    expect(hub.settings.get("desk.theme.scheme", "dark")).toBe("light");
  });

  it("tunes the proposal in the editor, or discards it and the preview ends", async () => {
    const { panel, asks, turn, themes, tune } = setup();
    panel.start({ text: "warm paper", run: true });
    await answered(asks, 1);
    turn("a1", "completed", { structured: WARM });
    key("describe-tune")?.click();
    expect(tune).toHaveBeenCalledWith(CLEAN, "Warm Paper");
    key("describe-discard")?.click();
    expect(themes.previewing()).toBeUndefined();
    expect(document.querySelector(".theme-proposal")).toBeNull();
  });

  it("says the brain gave no theme when it answers in words, and previews nothing", async () => {
    const { panel, asks, turn, themes } = setup();
    panel.start({ text: "warm paper", run: true });
    await answered(asks, 1);
    turn("a1", "completed", { text: "Here is a warm theme for you." });
    expect(status()).toContain("The brain gave no theme");
    expect(themes.previewing()).toBeUndefined();
  });

  it("turns Generate off while the brain is offline or refuses, and on again when it is back", async () => {
    const { panel, asks, turn } = setup();
    panel.start({ text: "warm paper", run: true });
    await answered(asks, 1);
    expect(key("describe-generate")?.disabled).toBe(false);
    turn("a1", "offline", { text: "The brain is not reachable; trying again." });
    expect(key("describe-generate")?.disabled).toBe(true);
    expect(status()).toContain("offline");
    turn("a1", "online");
    expect(key("describe-generate")?.disabled).toBe(false);
    turn("a1", "error", { text: "No credits left." });
    expect(key("describe-generate")?.disabled).toBe(true);
    expect(status()).toContain("No credits left.");
  });

  it("starts with Generate off when the brain is offline or out of credits", async () => {
    for (const [brain, line] of [
      [{ mode: "offline" }, "offline"],
      [{ mode: "cloud", credits: 0 }, "credits"],
    ] as const) {
      const { panel } = setup(brain);
      panel.start({ text: "warm paper" });
      await vi.waitFor(() => expect(key("describe-generate")?.disabled).toBe(true));
      expect(status()).toContain(line);
    }
  });

  it("hears only its own turn, from before the answer named it until the turn ends", async () => {
    const { themes, stub } = setup();
    const heard: string[] = [];
    await themes
      .brain()
      .ask("warm paper", PROPOSE_THEME, (t) => heard.push(`${t.turnId} ${t.kind}`));
    stub.emit({ event: "brain.turn", data: { turnId: "a2", kind: "completed" } });
    stub.emit({ event: "brain.turn", data: { turnId: "a1", kind: "completed" } });
    stub.emit({ event: "brain.turn", data: { turnId: "a1", kind: "delta", text: "late" } });
    expect(heard).toEqual(["a1 started", "a1 completed"]);
  });
});
