/**
 * A profile as the shell sees it: where things sit on desktops 1–4, what Eris may see and how she
 * behaves. It never holds content. desk.profiles keeps it (a plugin set plus settings, the shell's
 * part in `desk.shell.mode`; `profiles.ts` reads it), so the types still say "mode".
 */

export type DesktopIndex = 1 | 2 | 3 | 4;
export const DESKTOPS: readonly DesktopIndex[] = [1, 2, 3, 4];

export interface ModeManifest {
  id: string;
  name: string;
  icon: string;
  author: string;
  version: string;
  /** One level of inheritance at most; a mode never contains or extends another mode. */
  extends: "base" | null;
  copiedFrom?: { author: string; id: string; version: string };
}

export interface SurfacePlacement {
  id: string;
  plugin: string;
  /** Position and size in the 1440×900 reference frame; the shell maps it onto the window. */
  x: number;
  y: number;
  w: number;
  h: number;
  pinned: boolean;
  /** How the surface is split into panes. Absent: one pane showing the view named by `id`. */
  panes?: PaneNode;
  /** Where it was before it filled the free area; present only while it fills it. */
  restore?: { x: number; y: number; w: number; h: number };
}

/** One pane: shows a view ("calendar", "notes", "agent:<id>", "launcher", ...). */
export interface PaneLeaf {
  kind: "view";
  id: string;
  view: string;
}

/** Two panes side by side ("row") or stacked ("column"); `ratio` is the first one's share. */
export interface PaneSplit {
  kind: "split";
  id: string;
  dir: "row" | "column";
  ratio: number;
  a: PaneNode;
  b: PaneNode;
}

export type PaneNode = PaneLeaf | PaneSplit;

export interface DesktopLayout {
  surfaces: SurfacePlacement[];
  /** null: Eris's default place (centred, top 40). */
  eris: { x: number; y: number } | null;
  rail: { visible: boolean };
  drawer: { visible: boolean };
}

export interface ModeRoles {
  /** Copied modes arrive with `agent: null`; the user binds an agent when installing. */
  roles: { role: string; agent: string | null }[];
}

export interface ModeEris {
  scope: { folders: string[]; calendar: boolean; mail: boolean; mic: "wake-word" | "off" | "push" };
  manner: { interrupt: "attention-only" | "all" | "none"; voice: boolean; greeting: string };
}

export interface ModeTriggers {
  manual: boolean;
  time?: string;
  calendar?: string;
}

export interface Mode {
  manifest: ModeManifest;
  /** It lays the desk out (`desk.shell.mode`), rather than leaving the base (desk.profiles' own). */
  lays: boolean;
  /** The layout every desktop starts from. */
  desktop?: Partial<DesktopLayout>;
  /** Each desktop's own, over that. */
  desktops: Partial<Record<DesktopIndex, Partial<DesktopLayout>>>;
  roles: ModeRoles;
  eris: ModeEris;
  triggers: ModeTriggers;
}
