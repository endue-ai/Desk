/**
 * The arrange actions the right rail's one button offers (ADR 0220, which moves them there from
 * the strip of ADR 0116): Tile, Cascade and Spread, then Restore. Each runs its desk.windows.*
 * command, so a click lands on the desk's undo stack as a key or the palette would. What can be
 * arranged and restored is the window manager's to say (#83); the spread is the compositor's to
 * draw (#54).
 */
import { CommandError } from "../commands";
import { windowsOf } from "../shell/actions";
import type { ShellCtx } from "../shell/context";
import type { DeskState } from "../shell/state";
import { CASCADE, RESTORE, SPREAD, TILE } from "./commands";
import { type ArrangeCopyKey, arrangeText } from "./copy";
import type { ArrangeIcon } from "./icons";

export interface ArrangeAction {
  key: ArrangeIcon;
  command: string;
  /** What it does, in the desk's language. */
  label: string;
  /** Its key as the person reads it (`⌥⌘G`), when it has one. */
  shortcut?: string;
  /** Its key as `aria-keyshortcuts` wants it. */
  combo?: string;
  /** Nothing to arrange, spread or put back on the desktop in front. */
  disabled: boolean;
  /** Restore stands apart from the three arrangements. */
  apart: boolean;
}

const ITEMS: { key: ArrangeIcon; command: string; label: ArrangeCopyKey }[] = [
  { key: "tile", command: TILE, label: "tile" },
  { key: "cascade", command: CASCADE, label: "cascade" },
  { key: "spread", command: SPREAD, label: "spread" },
  { key: "restore", command: RESTORE, label: "restore" },
];

/** Whether the desktop in front has a normal, unpinned window to arrange. */
const arrangeable = (s: DeskState) => windowsOf(s).some((p) => p.floating !== true && !p.pinned);

/** The four actions as the desk stands: their words, their keys and whether each can run. */
export function arrangeActions(ctx: ShellCtx, s: DeskState): ArrangeAction[] {
  const some = arrangeable(s);
  const off: Record<ArrangeIcon, boolean> = {
    tile: !some,
    cascade: !some,
    spread: windowsOf(s).length === 0,
    restore: !s.wm.restorable,
  };
  const combos = ctx.runtime.keymap.bindings();
  return ITEMS.map((item) => ({
    key: item.key,
    command: item.command,
    label: arrangeText(s.lang, item.label),
    shortcut: ctx.keyOf(item.command) || undefined,
    combo: combos.find((b) => b.command === item.command)?.combo,
    disabled: off[item.key],
    apart: item.key === "restore",
  }));
}

/** What the actions depend on, for a store watch. */
export const arrangeWatch = (s: DeskState) => [
  s.wm.restorable,
  windowsOf(s).map((p) => [p.id, p.floating === true, p.pinned]),
];

/** Run an arrange command; one that fails says why in its notice. */
export function runArrange(ctx: ShellCtx, command: string): void {
  void ctx.runtime.commands.run(command).catch((error: unknown) => {
    if (!(error instanceof CommandError)) throw error;
  });
}
