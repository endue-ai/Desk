/**
 * The closed windows as brain.say's desk and desk.windows.closed carry them (BrainDeskClosed, ADR
 * 0124): where each was in CSS pixels when it closed, as the window manager placed it on its
 * desktop (one closed from the drawer: where it would come back), within the contract's limits.
 */
import type { BrainDeskClosed } from "@endue-ai/bridge";
import { desktopsOf } from "../shell/actions";
import type { DeskState } from "../shell/state";
import type { ClosedWindow } from "./closed";

/** The contract's limits (specs/bridge/v0/brain.schema.json, BrainDesk). */
export const LIMITS = { closed: 20, desktops: 32, id: 128, desktopId: 64, name: 40, title: 200 };
export const PLUGIN_ID = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/;

/** A whole number of pixels, as the contract takes it: never NaN, never below `min`. */
export const int = (n: number, min = Number.NEGATIVE_INFINITY) =>
  Number.isFinite(n) ? Math.max(min, Math.round(n)) : Math.max(min, 0);

/** The log, the last closed first; a desktop that is gone is left out, the window kept. */
export function closedForBrain(s: DeskState, entries: readonly ClosedWindow[]): BrainDeskClosed[] {
  const list = desktopsOf(s);
  return entries.slice(0, LIMITS.closed).map((e): BrainDeskClosed => {
    const desktop = list.some((d) => d.id === e.desktop) ? e.desktop : undefined;
    const { x, y, w, h } = e.rect ?? e.placement;
    return {
      id: e.id.slice(0, LIMITS.id),
      ...(e.plugin && PLUGIN_ID.test(e.plugin) ? { plugin: e.plugin } : {}),
      ...(e.title ? { title: e.title.slice(0, LIMITS.title) } : {}),
      x: int(x),
      y: int(y),
      w: int(w, 0),
      h: int(h, 0),
      ...(e.placement.floating === true ? { floating: true } : {}),
      ...(desktop ? { desktop: desktop.slice(0, LIMITS.desktopId) } : {}),
      closedAt: new Date(e.at).toISOString(),
    };
  });
}
