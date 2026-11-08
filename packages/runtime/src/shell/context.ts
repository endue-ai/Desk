import type { ErisState } from "../eris/states";
import type { Platform } from "../input";
import type { PluginWindows } from "../surface/host";
import type { Ctx } from "./actions";
import type { CopyKey } from "./copy";
import type { Ticker } from "./ticker";

/** What every shell part gets: the store, the bridges, the runtime, the frame loop, copy and keys. */
export interface ShellCtx extends Ctx {
  ticker: Ticker;
  tr(key: CopyKey, vars?: Record<string, string | number>): string;
  /** Reduced motion, as desk.theme says. */
  reduced(): boolean;
  /** Wall-clock milliseconds now: the epoch the shell started at plus the clock's time. */
  wall(): number;
  platform: Platform;
  /** The first key bound to a command, as people read it on this platform. */
  keyOf(command: string): string | undefined;
  /** The plugin surfaces the runtime handed to the shell's windows (ADR 0040). */
  windows: PluginWindows;
  /** Eris's controls for parts that make her react (the composer, the rail). */
  eris: {
    say(text: string, words?: { word: string; at: number }[]): void;
    setState(state: ErisState): void;
  };
}

/** Desk size in CSS pixels; layout positions are given in this 1440×900 frame. */
export const REFERENCE = { width: 1440, height: 900 } as const;
