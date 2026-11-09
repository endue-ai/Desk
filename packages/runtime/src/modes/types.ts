/**
 * A profile as the shell sees it: its desktops (window views, ADR 0117) and where things sit on
 * each, what Eris may see and how she behaves. It never holds content. desk.profiles keeps it (a
 * plugin set plus settings, the shell's part in `desk.shell.mode`; `profiles.ts` reads it), so the
 * types still say "mode".
 */

/** A desktop's position in its profile's list, from 1 (1 to 4 before ADR 0117). */
export type DesktopIndex = number;
/** A desktop's stable id. The four a desk starts with are "1" to "4", as four-desktop data keys them. */
export type DesktopId = string;
/** A desktop by id, or by its position when a number. */
export type DesktopRef = DesktopId | DesktopIndex;
/** The positions of the four desktops a desk starts with. */
export const DESKTOPS: readonly DesktopIndex[] = [1, 2, 3, 4];

/** One desktop (window view): its id, which never changes, and the name the switcher shows. */
export interface Desktop {
  id: DesktopId;
  name: string;
}

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
  /** Normal: world pixels on the desktop's canvas. Floating: the 1440×900 reference frame. */
  x: number;
  y: number;
  w: number;
  h: number;
  pinned: boolean;
  /**
   * Absent/false: normal mode, on the desktop's canvas, moving with its pan. True: floating mode,
   * anchored to the app's viewport whatever the pan, and above the normal windows.
   */
  floating?: boolean;
  /** How the surface is split into panes. Absent: one pane showing the view named by `id`. */
  panes?: PaneNode;
  /**
   * Where it was before it filled the app or a part of it, in the coordinates of the mode it had then, and
   * that mode (`floating`; absent in layouts saved before snaps floated). Present only while it
   * fills it. A window maximized from a half or a quarter also keeps that part (`fill`), to come
   * back to it.
   */
  restore?: {
    x: number;
    y: number;
    w: number;
    h: number;
    floating?: boolean;
    fill?: Exclude<SurfacePlacement["fill"], "full" | undefined>;
  };
  /**
   * Fills the whole app (ADR 0132), a half of it (an edge's) or a quarter (a corner's) until moved
   * or resized.
   * A fill floats the window, so it keeps its part at any pan and any app size; a normal window
   * filled before fills floated keeps the world rect it was filled to.
   */
  fill?:
    | "full"
    | "left"
    | "right"
    | "top"
    | "bottom"
    | "top-left"
    | "top-right"
    | "bottom-left"
    | "bottom-right";
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
  /** Its desktops in order: the four named 1 to 4 unless it names its own. */
  list: Desktop[];
  /** Each desktop's own layout over `desktop`, by id. */
  desktops: Partial<Record<DesktopId, Partial<DesktopLayout>>>;
  roles: ModeRoles;
  eris: ModeEris;
  triggers: ModeTriggers;
}
