import type { Ctx } from "./actions";
import type { CopyKey } from "./copy";
import type { Ticker } from "./ticker";

/** What every shell part gets: the store and bridge, the frame loop, copy and motion settings. */
export interface ShellCtx extends Ctx {
  ticker: Ticker;
  tr(key: CopyKey, vars?: Record<string, string | number>): string;
  reduced(): boolean;
  /** Eris's controls for parts that make her react (the composer, the rail). */
  eris: {
    say(text: string, words?: { word: string; at: number }[]): void;
    setState(state: import("../eris/states").ErisState): void;
  };
}

/** Desk size in CSS pixels; layout positions are given in this 1440×900 frame. */
export const REFERENCE = { width: 1440, height: 900 } as const;
