/**
 * A mode is a recipe for one way of using the desk: which plugins, where things sit on desktops 1–4,
 * what Eris may see and how she behaves. It never holds content, and it can only narrow permissions.
 * On disk it is a folder like a plugin's: modes/<id>/{mode.json, layout/, plugins.json, ...}.
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
}

export interface DesktopLayout {
  surfaces: SurfacePlacement[];
  /** null: Eris's default place (centred, top 40). */
  eris: { x: number; y: number } | null;
  rail: { visible: boolean };
  drawer: { visible: boolean };
}

export interface ModePlugins {
  enabled: string[];
  settings: Record<string, Record<string, unknown>>;
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
  /** layout/desktop.json, the mode-wide default every desktop starts from. */
  desktop?: Partial<DesktopLayout>;
  /** layout/desktop-N.json, per-desktop overrides. */
  desktops: Partial<Record<DesktopIndex, Partial<DesktopLayout>>>;
  plugins: ModePlugins;
  roles: ModeRoles;
  eris: ModeEris;
  triggers: ModeTriggers;
}
