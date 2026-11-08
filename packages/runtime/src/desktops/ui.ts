/**
 * What commands open on screen: the rename and remove dialogs and the overview, drawn beside the
 * switcher (`shell/Desktops.ts`). The switcher provides them for its desk's store while it is mounted.
 */
import type { DesktopRef } from "../modes/types";
import type { Store } from "../shell/state";

export interface DesktopsUi {
  rename(desktop: DesktopRef): void;
  remove(desktop: DesktopRef): void;
  /** Open the overview, close it (`false`), or toggle it. */
  overview(open?: boolean): void;
}

const NONE: DesktopsUi = { rename() {}, remove() {}, overview() {} };
const provided = new WeakMap<Store, DesktopsUi>();

export function provideUi(store: Store, ui: DesktopsUi): () => void {
  provided.set(store, ui);
  return () => {
    if (provided.get(store) === ui) provided.delete(store);
  };
}

export const uiOf = (store: Store): DesktopsUi => provided.get(store) ?? NONE;
