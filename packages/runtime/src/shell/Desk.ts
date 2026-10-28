/**
 * The desk shell. The centre stays empty: every part floats at an edge. Tab order follows the DOM:
 * modes → desktops → left bar → Eris → rail → bottom → surfaces.
 */
import type { ShellBridge } from "../bridge/types";
import { type Clock, realClock } from "../clock";
import { type ErisHandle, mountEris } from "../eris/Eris";
import { sampleModes } from "../modes/load";
import type { Mode } from "../modes/types";
import { mountSurfaces } from "../surface/Surface";
import { layoutOf } from "./actions";
import { mountBottom } from "./Bottom";
import type { ShellCtx } from "./context";
import { type Lang, t } from "./copy";
import { mountDesktops } from "./Desktops";
import { h, listen } from "./dom";
import { mountModes } from "./Modes";
import { mountRail } from "./Rail";
import { mountSideBar } from "./SideBar";
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
}

export interface Desk {
  store: Store;
  ticker: Ticker;
  eris: ErisHandle;
  /** Resolves once the saved desk is restored. */
  ready: Promise<void>;
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
    eris: { say: (text, words) => pending.say(text, words), setState: (s) => pending.setState(s) },
  };

  const glow = h("div", { class: "shell-glow", "aria-hidden": "true" });
  root.append(glow);
  const parts = [mountModes(root, ctx), mountDesktops(root, ctx), mountSideBar(root, ctx)];
  const eris = mountEris(root, ctx, () => layoutOf(store.get()).eris);
  pending.say = eris.say;
  pending.setState = eris.setState;
  parts.push(mountRail(root, ctx), mountBottom(root, ctx), mountSurfaces(root, ctx));

  const html = document.documentElement;
  const applyTheme = (theme: DeskState["theme"]) => {
    html.dataset.theme = theme;
  };
  applyTheme(store.get().theme);
  const closeAll = () =>
    store.set((s) => ({
      popover: null,
      dialog: null,
      composer: s.composer.open ? { open: false, text: "", selected: 0 } : s.composer,
    }));
  const offs = [
    store.watch((s) => s.theme, applyTheme),
    listen(window, "keydown", (e) => {
      if ((e as KeyboardEvent).key === "Escape") closeAll();
    }),
    listen(document, "pointerdown", (e) => {
      const target = e.target as Element | null;
      if (!target?.closest(".popover, .dialog, [aria-expanded], .composer")) {
        if (store.get().popover) store.set({ popover: null });
      }
    }),
  ];

  const persist = options.persist ?? true;
  const ready = (async () => {
    if (!persist) return;
    const saved = await options.bridge.storage.get<Saved>("desk");
    if (saved)
      store.set((s) => ({
        ...saved,
        eris: { ...s.eris, ...saved.eris, state: "idle", saying: "" },
      }));
    offs.push(
      store.watch(
        (s) => ({
          ...Object.fromEntries(SAVED.map((k) => [k, s[k]])),
          eris: { density: s.eris.density, soul: s.eris.soul },
        }),
        (value) => void options.bridge.storage.set("desk", value),
      ),
    );
  })();

  return {
    store,
    ticker,
    eris,
    ready,
    dispose() {
      for (const off of offs) off();
      for (const off of parts) off();
      eris.dispose();
      ticker.dispose();
      glow.remove();
      root.classList.remove("shell");
    },
  };
}
