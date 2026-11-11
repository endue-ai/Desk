/**
 * The window manager's state and the runtime's edits as crates/desk-wm writes and reads them in
 * JSON (#83): `Desk` (`desk/mod.rs`), the `View` the runtime reads (`view.rs`), each desk published
 * (`interact/publish.rs`) and every `Edit` (`edits.rs`). The runtime keeps no window manager of its
 * own: it sends these edits and takes each desk desk-wm publishes.
 */
import type {
  Desktop,
  DesktopId,
  DesktopLayout,
  DesktopRef,
  PaneSplit,
  SurfacePlacement,
} from "../modes/types";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Offset {
  x: number;
  y: number;
}

/** What a filled window takes: the whole app, a half or a quarter (ADR 0128, ADR 0132). */
export type Fill = NonNullable<SurfacePlacement["fill"]>;

export interface DrawerItem {
  id: string;
  kind: "surface" | "file" | "recent";
  name: string;
  /** Wall-clock milliseconds it entered the drawer; recent items fade after 12 h and leave after 24 h. */
  at: number;
  placement?: SurfacePlacement;
}

/** A plugin surface the runtime handed over, the slot its window takes and the pan it arrived at. */
export interface Adopted {
  id: string;
  title: string;
  slot?: number;
  at?: Offset;
}

/** The window, and the pane in it, a desktop had in use when the person left it. */
export interface InUse {
  window: string;
  pane: string | null;
}

/** What the profile in force saves, already layered: its desktops and each one's layout. */
export interface Saved {
  list: Desktop[];
  desktop: DesktopLayout;
  desktops: Record<DesktopId, DesktopLayout>;
}

/** desk-wm's `Desk`: the window manager's state. */
export interface WmDesk {
  saved: Saved;
  desktop: DesktopId;
  session: Record<DesktopId, DesktopLayout>;
  desktops: Desktop[] | null;
  pan: Record<DesktopId, Offset>;
  focusBy: Record<DesktopId, InUse>;
  adopted: Adopted[];
  drawer: DrawerItem[];
  focused: string | null;
  pane: string | null;
}

/** A window of the desktop in front where it is drawn: on screen, at its stacking level. */
export interface Shown {
  id: string;
  rect: Rect;
  z: number;
}

/** What `desk.shell.layouts`' session layer keeps: the list, each desktop with its moved layout. */
export interface StoredMoved {
  desktops: { id: DesktopId; name: string; layout?: DesktopLayout }[];
}

/** A window's whole geometry, as a gesture leaves it (desk-wm's `Geometry`). */
export interface Geometry extends Rect {
  id: string;
  floating?: boolean;
  fill?: Fill;
  restore?: SurfacePlacement["restore"];
}

/** What the runtime reads of the desk (desk-wm's `View`). */
export interface WmView {
  desktops: Desktop[];
  here: DesktopId;
  /** Every desktop's windows in desk order: the plugin windows in their slots, then its layout's. */
  windows: Record<DesktopId, SurfacePlacement[]>;
  layouts: Record<DesktopId, DesktopLayout>;
  dirty: boolean;
  /** The plugin surface the pane in use shows. */
  focusedPlugin: string | null;
  moved: StoredMoved | null;
  /** The desktop in front has an arrangement to put back. */
  restorable: boolean;
  screen: { w: number; h: number };
  /** The desktop in front's windows in desk order, where each is drawn. */
  front: Shown[];
  /** Every desktop's windows on screen as they are when it is in front, by desktop and window. */
  rects: Record<DesktopId, Record<string, Rect>>;
  /** The plugins only windows out of sight show. */
  covered: string[];
  ids: string[];
}

/** What desk-wm publishes on each change. */
export interface Published {
  rev: number;
  desk: WmDesk;
  view: WmView;
  answered?: { seq: number; values: unknown[] };
}

/** What tile and cascade replaced, as the undo stack keeps it (desk-wm's `Arranged`). */
export interface Arranged {
  desktop: DesktopId;
  entry: string;
  kind: "tile" | "cascade";
  windows: unknown[];
}

/** One change the runtime asks of the window manager. */
export type Edit =
  | { op: "saved"; saved: Saved }
  | { op: "switch-profile"; saved: Saved; titles: Record<string, string>; now: number }
  | { op: "moved"; value: unknown }
  | { op: "revert" }
  | {
      op: "restore";
      desktop: unknown;
      pan: unknown;
      drawer?: DrawerItem[];
      slots: unknown;
      now: number;
    }
  | { op: "drawer"; items: DrawerItem[] }
  | { op: "adopt"; id: string; title: string }
  | { op: "release"; id: string }
  | { op: "open"; id: string; placement?: SurfacePlacement }
  | { op: "place"; desktop?: DesktopId; placement: SurfacePlacement }
  | { op: "unplace"; desktop?: DesktopId; id: string }
  | { op: "set-geometry"; geometry: Geometry }
  | { op: "show-plugin"; id: string }
  | { op: "open-view"; view: string }
  | { op: "new-window" }
  | { op: "focus"; window: string; pane?: string | null }
  | { op: "blur" }
  | { op: "focus-next"; step: number }
  | { op: "split"; dir: PaneSplit["dir"] }
  | { op: "close-pane"; window?: string; pane?: string }
  | { op: "close-window"; id: string }
  | { op: "show-in-pane"; window: string; pane: string; view: string }
  | { op: "resize-split"; window: string; split: string; ratio: number }
  | { op: "toggle-pin"; id: string }
  | { op: "toggle-floating"; id: string }
  | { op: "put-away"; id: string; name: string; now: number }
  | { op: "bring-back"; item: string }
  | { op: "move-eris"; at: Offset | null }
  | { op: "switch-to"; desktop: DesktopRef }
  | { op: "set-desktop"; desktop: DesktopRef }
  | { op: "step-desktop"; by: number }
  | { op: "add-desktop"; name?: string; go: boolean }
  | { op: "rename-desktop"; desktop: DesktopRef; name: string }
  | { op: "reorder-desktop"; desktop: DesktopRef; at?: number; by?: number }
  | { op: "remove-desktop"; desktop: DesktopRef; windows: "move" | "close" }
  | { op: "move-to-desktop"; window: string; desktop: DesktopRef; before?: SurfacePlacement }
  | { op: "move-to-new"; window: string; before?: SurfacePlacement }
  | { op: "undo-desktop" }
  | { op: "pan"; desktop?: DesktopId; to: Offset }
  | { op: "reveal"; id: string }
  | { op: "arrange"; kind: "tile" | "cascade"; now: number }
  | { op: "restore-arrangement"; from?: Arranged };

/** What a snapshot reads beyond the window manager's state: titles and the frames' states. */
export interface Told {
  titles: Record<string, string>;
  frames: Record<string, "live" | "asleep" | "late" | "stopped">;
}
