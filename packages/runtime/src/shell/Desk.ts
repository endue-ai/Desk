/**
 * The desk shell in two layers. The system layer holds the desk's own controls at fixed places (mode
 * switcher, desktops, agent bar); the mode layer holds what a mode lays out (Eris, the rail, the
 * bottom edge, surfaces). The centre stays empty. Tab order follows the DOM:
 * modes → desktops → agent bar → Eris → rail → bottom → surfaces.
 */
import type { ShellBridge } from "../bridge/types";
import { type Clock, realClock } from "../clock";
import { type ErisHandle, mountEris } from "../eris/Eris";
import type { Platform } from "../input";
import { sampleModes } from "../modes/load";
import type { Mode } from "../modes/types";
import { mountSurfaces } from "../surface/Surface";
import { loadDirectory } from "../system/agents";
import { detectPlatform, Keymap } from "../system/keys";
import { mountSystemLayer } from "../system/layer";
import { mountKeyRouter } from "../system/router";
import { layoutOf } from "./actions";
import { mountBottom } from "./Bottom";
import type { ShellCtx } from "./context";
import { type Lang, t } from "./copy";
import { h, listen } from "./dom";
import { mountRail } from "./Rail";
import { type DeskState, Store, sampleState } from "./state";
import { Ticker } from "./ticker";

export interface DeskOptions {
  root: HTMLElement;
  bridge: ShellBridge;
  clock?: Clock;
  lang?: Lang;
  modes?: Mode[];
  /** Restore and save the desk through `bridge.storage` (default true). */
  persist?: boolean;
  /** Override prefers-reduced-motion (tests). */
  reducedMotion?: boolean;
  /** "Mod" is ⌘ on mac and Ctrl elsewhere; detected from the browser unless given. */
  platform?: Platform;
}

export interface Desk {
  store: Store;
  ticker: Ticker;
  eris: ErisHandle;
  keys: Keymap;
  /** Resolves once the saved desk, the key bindings, and the agents and spaces are loaded. */
  ready: Promise<void>;
  /** Read agents and spaces again. */
  refresh(): Promise<void>;
  dispose(): void;
}

const SAVED = [
  "modes",
  "modeId",
  "desktop",
  "session",
  "theme",
  "drawer",
  "eris",
  "spaceId",
] as const;
type Saved = Partial<Pick<DeskState, (typeof SAVED)[number]>>;

export function mountDesk(options: DeskOptions): Desk {
  const clock = options.clock ?? realClock();
  const ticker = new Ticker(clock);
  const store = new Store(sampleState(options.modes ?? sampleModes(), options.lang ?? "ko"));
  const media =
    typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
  const reduced = () => options.reducedMotion ?? media?.matches ?? false;
  const platform = options.platform ?? detectPlatform();
  const keys = new Keymap(platform);
  const root = options.root;
  root.classList.add("shell");
  root.replaceChildren();

  const pending: ShellCtx["eris"] = {
    say: () => undefined,
    setState: () => undefined,
  };
  const ctx: ShellCtx = {
    store,
    bridge: options.bridge,
    now: () => ticker.now(),
    ticker,
    tr: (key, vars) => t(store.get().lang, key, vars),
    reduced,
    platform,
    keys,
    eris: { say: (text, words) => pending.say(text, words), setState: (s) => pending.setState(s) },
  };

  const glow = h("div", { class: "shell-glow", "aria-hidden": "true" });
  const modeLayer = h("div", { class: "layer layer-mode", "data-layer": "mode" });
  root.append(glow);
  const parts = [mountSystemLayer(root, ctx)];
  root.append(modeLayer);
  const eris = mountEris(modeLayer, ctx, () => layoutOf(store.get()).eris);
  pending.say = eris.say;
  pending.setState = eris.setState;
  parts.push(mountRail(modeLayer, ctx), mountBottom(modeLayer, ctx), mountSurfaces(modeLayer, ctx));

  const html = document.documentElement;
  const applyTheme = (theme: DeskState["theme"]) => {
    html.dataset.theme = theme;
  };
  applyTheme(store.get().theme);
  const offs = [
    store.watch((s) => s.theme, applyTheme),
    mountKeyRouter(ctx),
    listen(document, "pointerdown", (e) => {
      const target = e.target as Element | null;
      if (!target?.closest(".popover, .dialog, [aria-expanded], .composer")) {
        if (store.get().popover) store.set({ popover: null });
      }
    }),
  ];

  const persist = options.persist ?? true;
  const restore = async () => {
    if (!persist) return;
    const [saved, bindings] = await Promise.all([
      options.bridge.storage.get<Saved>("desk"),
      options.bridge.storage.get<unknown>("keybindings"),
    ]);
    if (saved)
      store.set((s) => ({
        ...saved,
        eris: { ...s.eris, ...saved.eris, state: "idle", saying: "" },
      }));
    if (bindings) keys.load(bindings);
    offs.push(
      store.watch(
        (s) => ({
          ...Object.fromEntries(SAVED.map((k) => [k, s[k]])),
          eris: { density: s.eris.density, soul: s.eris.soul },
        }),
        (value) => void options.bridge.storage.set("desk", value),
      ),
      keys.onChange(() => void options.bridge.storage.set("keybindings", keys.overrides())),
    );
  };
  const refresh = () => loadDirectory(ctx);
  const ready = restore().then(refresh);

  return {
    store,
    ticker,
    eris,
    keys,
    ready,
    refresh,
    dispose() {
      for (const off of offs) off();
      for (const off of parts) off();
      eris.dispose();
      ticker.dispose();
      glow.remove();
      modeLayer.remove();
      root.classList.remove("shell");
    },
  };
}
