/**
 * What commands open on screen: the rename and remove dialogs and the overview, drawn beside the
 * switcher (`shell/Desktops.ts`). The switcher provides them for its desk's store while it is mounted.
 * The window menu (`menu.ts`, ADR 0117 and ADR 0255) is provided the same way, for the tool on each
 * window's title bar that opens it (`surface/title-bar.ts`).
 */
import type { DesktopRef } from "../modes/types";
import type { Store } from "../shell/state";

export interface DesktopsUi {
  rename(desktop: DesktopRef): void;
  remove(desktop: DesktopRef): void;
  /** Open the overview, close it (`false`), or toggle it. */
  overview(open?: boolean): void;
}

/** The one window menu, from a window's title bar. */
export interface WindowMenu {
  /** Open window `window`'s menu under `tool`, or close it when that tool opened it. */
  toggle(window: string, tool: HTMLElement): void;
}

const NONE: DesktopsUi = { rename() {}, remove() {}, overview() {} };
const NO_MENU: WindowMenu = { toggle() {} };
const provided = new WeakMap<Store, DesktopsUi>();
const menus = new WeakMap<Store, WindowMenu>();

export function provideUi(store: Store, ui: DesktopsUi): () => void {
  provided.set(store, ui);
  return () => {
    if (provided.get(store) === ui) provided.delete(store);
  };
}

export const uiOf = (store: Store): DesktopsUi => provided.get(store) ?? NONE;

export function provideWindowMenu(store: Store, menu: WindowMenu): () => void {
  menus.set(store, menu);
  return () => {
    if (menus.get(store) === menu) menus.delete(store);
  };
}

export const windowMenuOf = (store: Store): WindowMenu => menus.get(store) ?? NO_MENU;
