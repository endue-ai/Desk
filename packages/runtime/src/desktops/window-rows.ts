/**
 * The rows of a window's menu above ADR 0117's "Move to" rows (ADR 0255): what the title bar's tools
 * did before it kept three. New tab (ADR 0270), Maximize or restore, Floating mode and Pin (checked
 * rows), and Put in drawer (issue 280's command). Each runs what its tool, its key or its command
 * ran, and shows the first key bound to its command when it has one. Floating mode and Pin have no
 * key: desk.windows.float and desk.windows.pin (ADR 0269) take the state they set, so none toggles.
 */
import { PUT_AWAY } from "../arrange/away";
import { reportFailure } from "../gesture";
import { togglePin, windowsOf } from "../shell/actions";
import type { ShellCtx } from "../shell/context";
import { newTab, tabKindOf, toggleFloating } from "../shell/windows";
import { isFloating } from "../surface/coordinates";
import { tx } from "./actions";

export const NEW_TAB = "desk.display.new-tab";
export const MAXIMIZE = "desk.display.maximize";

export interface WindowRow {
  /** Its `data-key`: what keeps the focus on it through a render. */
  key: string;
  label: string;
  /** The key bound to its command, as people read it; none when it has none. */
  shortcut?: string;
  /** A checked row's state; absent for a row that only runs. */
  checked?: boolean;
  enabled: boolean;
  run: () => void;
}

export function windowRows(ctx: ShellCtx, window: string): WindowRow[] {
  const p = windowsOf(ctx.store.get()).find((w) => w.id === window);
  // A desk that names no keys (a part mounted on its own) shows none.
  const keyOf = (command: string) => ctx.keyOf?.(command) || undefined;
  const failed = (title: string) => (error: unknown) =>
    reportFailure(ctx.runtime.notify, title, error);
  return [
    {
      key: "menu-new-tab",
      label: ctx.tr("newTab"),
      shortcut: keyOf(NEW_TAB),
      // A window of the desk's own views takes no tab (ADR 0270).
      enabled: tabKindOf(ctx, window) !== undefined,
      run: () => void newTab(ctx, window).catch(failed(ctx.tr("newTab"))),
    },
    {
      key: "menu-maximize",
      label: tx(ctx, "maximize"),
      shortcut: keyOf(MAXIMIZE),
      enabled: true,
      run: () => ctx.wm.run({ op: "maximize" }, window),
    },
    {
      key: "menu-floating",
      label: ctx.tr("floating"),
      checked: p !== undefined && isFloating(p),
      enabled: true,
      run: () => void toggleFloating(ctx, window),
    },
    {
      key: "menu-pin",
      label: ctx.tr("pin"),
      checked: p?.pinned === true,
      enabled: true,
      run: () => void togglePin(ctx, window),
    },
    {
      key: "menu-drawer",
      label: tx(ctx, "putInDrawer"),
      shortcut: keyOf(PUT_AWAY),
      enabled: true,
      run: () =>
        void ctx.runtime.commands.run(PUT_AWAY, { window }).catch(failed(tx(ctx, "putInDrawer"))),
    },
  ];
}
