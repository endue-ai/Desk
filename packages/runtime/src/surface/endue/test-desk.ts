/**
 * A shell context for the endue windows' and agent bar's tests (never shipped): the browser bridge
 * over the studio stub's sample agents and spaces, a store with desk-wm under it (#83), and a wall
 * clock fixed at `EPOCH`.
 */
import { browserBridge } from "../../bridge/browser";
import { studioHandlers } from "../../bridge/studio";
import type { ShellCtx } from "../../shell/context";
import { t } from "../../shell/copy";
import { emptyState, Store } from "../../shell/state";
import { testWindowManager } from "../../wm/testing";
import { takeDesk } from "../../wm/view";

export const EPOCH = Date.parse("2026-11-09T09:00:00Z");

export function testDesk(lang: "en" | "ko" = "en") {
  const studio = studioHandlers({ epoch: EPOCH });
  const bridge = browserBridge({ now: () => 0, epoch: EPOCH, studio });
  const store = new Store(emptyState(lang));
  const wm = testWindowManager();
  wm.connect((published) => takeDesk(store, published));
  const ctx = {
    store,
    wm,
    bridge,
    runtime: { shortcuts: { focused: null }, focusSurface: () => undefined },
    tr: (key: Parameters<typeof t>[1], vars?: Record<string, string | number>) =>
      t(lang, key, vars),
    wall: () => EPOCH,
    now: () => 0,
    reduced: () => true,
  } as unknown as ShellCtx;
  const signIn = () =>
    bridge.fake.setAccount({ state: "signed-in", profile: { displayName: "Ada Lovelace" } });
  return { ctx, store, bridge, studio, signIn };
}

/** Let pending reads answer. */
export const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
