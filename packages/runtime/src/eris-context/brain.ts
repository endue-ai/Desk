/**
 * The closed windows as brain.say's desk and desk.windows.closed carry them (BrainDeskClosed, ADR
 * 0124): where each was in CSS pixels, as for a window on its desktop, within the contract's limits.
 */
import type { BrainDeskClosed } from "@endue-ai/bridge";
import { desktopId, desktopsOf } from "../shell/actions";
import type { DeskState } from "../shell/state";
import { isFloating, screenRect } from "../surface/coordinates";
import type { ClosedWindow } from "./closed";

/** The contract's limits (specs/bridge/v0/brain.schema.json, BrainDesk). */
export const LIMITS = { closed: 20, desktops: 32, id: 128, desktopId: 64, name: 40, title: 200 };
export const PLUGIN_ID = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/;
const ORIGIN = { x: 0, y: 0 };

export type Size = { vw: number; vh: number };

/** A whole number of pixels, as the contract takes it: never NaN, never below `min`. */
export const int = (n: number, min = Number.NEGATIVE_INFINITY) =>
  Number.isFinite(n) ? Math.max(min, Math.round(n)) : Math.max(min, 0);

/** The log, the last closed first; a desktop that is gone is left out, the window kept. */
export function closedForBrain(
  s: DeskState,
  entries: readonly ClosedWindow[],
  size: Size,
): BrainDeskClosed[] {
  const list = desktopsOf(s);
  return entries.slice(0, LIMITS.closed).map((e): BrainDeskClosed => {
    const desktop = list.some((d) => d.id === e.desktop) ? e.desktop : undefined;
    const pan = s.pan[desktop ?? desktopId(s)] ?? ORIGIN;
    const rect = screenRect(e.placement, pan, size.vw, size.vh);
    return {
      id: e.id.slice(0, LIMITS.id),
      ...(e.plugin && PLUGIN_ID.test(e.plugin) ? { plugin: e.plugin } : {}),
      ...(e.title ? { title: e.title.slice(0, LIMITS.title) } : {}),
      x: int(rect.x),
      y: int(rect.y),
      w: int(rect.w, 0),
      h: int(rect.h, 0),
      ...(isFloating(e.placement) ? { floating: true } : {}),
      ...(desktop ? { desktop: desktop.slice(0, LIMITS.desktopId) } : {}),
      closedAt: new Date(e.at).toISOString(),
    };
  });
}
