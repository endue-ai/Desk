// The floating Eris window (ADR 0121), index.html?view=eris: her figure, her status and a compact
// composer over the OS while the desk is inactive. The view is the runtime's (mountErisFloat); this
// host gives it the core as the desk (src-tauri pins this window's caller and lets it talk to Eris
// only, so it is the desk's one conversation), the window's own commands, the summons of the
// shortcut and the theme the main window keeps (palette-theme.ts).
import { BridgeClient, tauriAdapter } from "@endue-ai/bridge";
import {
  type Clock,
  type ErisFloat,
  mountErisFloat,
  realClock,
  storageChannel,
} from "@endue-ai/runtime";
import "@endue-ai/runtime/shell.css";
import "./eris-window.css";
import { followDeskTheme, KEPT_THEME } from "./palette-theme";

/** Tauri's `invoke` and `listen`, injected so tests drive the window without Tauri. */
export interface NativeWindow {
  invoke(command: string, args?: Record<string, unknown>): Promise<unknown>;
  listen<T>(event: string, handler: (event: { payload: T }) => void): Promise<() => void>;
}

/** The window's own commands: the app's inline plugin `eris-window` (src-tauri/src/eris_window). */
export const PLUGIN = "plugin:eris-window|";

/** What `state` and `eris://shortcut` say of the shortcut. */
export interface ShortcutState {
  shortcut: string;
  label: string;
  registered: boolean;
  problem?: string;
}

export interface ErisWindowOptions {
  win?: Window;
  clock?: Clock;
}

export async function startErisWindow(
  native: NativeWindow,
  options: ErisWindowOptions = {},
): Promise<ErisFloat> {
  const win = options.win ?? window;
  const doc = win.document;
  const root = doc.getElementById("desk");
  if (!root) throw new Error("index.html has no #desk element");
  // No runtime here: the theme in force is the one the main window keeps for its other windows.
  const theme = followDeskTheme({ root: doc.documentElement, post: () => {} }, win);
  const core = new BridgeClient(
    tauriAdapter((command, args) => native.invoke(command, args), native.listen),
  );
  const run = (command: string, args?: Record<string, unknown>) => {
    native.invoke(command, args).catch((error: unknown) => console.error(`${command}:`, error));
  };
  let shortcut = (await native.invoke(`${PLUGIN}state`).catch(() => undefined)) as
    | ShortcutState
    | undefined;
  const view = mountErisFloat(root, {
    core,
    channel: storageChannel(win),
    clock: options.clock ?? realClock(),
    lang: win.navigator.language.startsWith("ko") ? "ko" : "en",
    shortcut: () =>
      shortcut?.registered ? { combo: shortcut.shortcut, label: shortcut.label } : undefined,
    reduced: () => doc.documentElement.dataset.motion === "reduce",
    dismiss: () => run(`${PLUGIN}dismiss`),
    expand: (open) => run(`${PLUGIN}expand`, { open }),
    reveal: () => run(`${PLUGIN}reveal_main`),
    drag: () => run(`${PLUGIN}drag`),
  });
  const offs = await Promise.all([
    // The shortcut summoned her: the composer opens with the focus in it.
    native.listen("eris://open", () => view.open()),
    // The window went away: back to her figure for next time.
    native.listen("eris://fold", () => view.fold()),
    native.listen<ShortcutState>("eris://shortcut", ({ payload }) => {
      shortcut = payload;
      view.refresh();
    }),
  ]);
  const restyle = (event: StorageEvent) => {
    if (event.key === KEPT_THEME) view.restyle();
  };
  win.addEventListener("storage", restyle);
  win.addEventListener(
    "pagehide",
    () => {
      for (const off of offs) off();
      win.removeEventListener("storage", restyle);
      theme.dispose();
      view.dispose();
    },
    { once: true },
  );
  return view;
}
