/**
 * Chords a binding can never have (ADR 0118): the operating system or the webview takes them before
 * the desk sees them, or the desk itself holds them as global shortcuts. A sequence with one of them
 * anywhere is reported; it stays bound, for whoever turned the system's shortcut off. A cancel key
 * after a prefix can never be pressed, so that sequence is not bound. Chords are named as they are
 * canonical on the platform: Mod+Tab is reserved on macOS (⌘Tab switches apps) and free elsewhere
 * (Ctrl+Tab reaches Desk).
 */
import type { Platform } from "./chord";
import { CANCEL_CHORDS } from "./parse";

export interface Reserved {
  /** The canonical chord. */
  chord: string;
  /** Who holds it. */
  by: "macOS" | "Windows and Linux" | "the desk";
  /** What it does there, as a clause: "quits Desk". */
  does: string;
  /** The binding can never run (a cancel key after a prefix), so it is not bound. */
  never?: true;
}

const MAC: Array<[string, string]> = [
  ["Meta+Q", "quits Desk"],
  ["Meta+H", "hides Desk"],
  ["Meta+Alt+H", "hides the other apps"],
  ["Meta+M", "minimizes the window"],
  ["Meta+Tab", "switches apps"],
  ["Meta+Shift+Tab", "switches apps"],
  ["Meta+`", "switches the app's windows"],
  ["Meta+Space", "opens Spotlight"],
  ["Meta+Alt+Escape", "force-quits apps"],
  ["Control+Meta+Q", "locks the screen"],
  ["Meta+Shift+3", "takes a screenshot"],
  ["Meta+Shift+4", "takes a screenshot"],
  ["Meta+Shift+5", "takes a screenshot"],
];

const OTHER: Array<[string, string]> = [
  ["Alt+Tab", "switches windows"],
  ["Alt+Shift+Tab", "switches windows"],
  ["Alt+F4", "closes the window"],
  ["Control+Alt+Delete", "opens the security screen"],
  ["Meta+L", "locks the screen"],
  ["Meta+D", "shows the desktop"],
  ["Meta+Tab", "switches windows"],
];

/** Every chord reserved on `platform`, the desk's global shortcuts included. */
export function reservedChords(platform: Platform): Reserved[] {
  const os = platform === "mac" ? "macOS" : "Windows and Linux";
  return [
    ...(platform === "mac" ? MAC : OTHER).map(([chord, does]) => ({ chord, by: os, does })),
    // apps/desk registers CommandOrControl+Shift+Space system-wide to open the palette.
    {
      chord: platform === "mac" ? "Meta+Shift+Space" : "Control+Shift+Space",
      by: "the desk",
      does: "opens the palette from any app",
    },
  ] as Reserved[];
}

/** Why `chords` cannot be bound, if they cannot: a reserved chord, or a cancel key after a prefix. */
export function reservedIn(chords: string[], reserved: Reserved[]): Reserved | undefined {
  for (const [i, chord] of chords.entries()) {
    const held = reserved.find((r) => r.chord === chord);
    if (held) return held;
    if (i > 0 && CANCEL_CHORDS.includes(chord))
      return { chord, by: "the desk", does: "cancels a pending prefix", never: true };
  }
  return undefined;
}
