/**
 * The windows closed recently (ADR 0124). The desk keeps a log of them by watching the store: a
 * window that is on no desktop and not in the drawer any more has closed. Each entry keeps the
 * plugin and title of what the window showed, its placement (place, size and panes), the desktop it
 * was on and when it closed; the last CLOSED_MAX, the last closed first, kept across restarts in the
 * shell's storage. A window that comes back leaves the log. The store's changes are looked at as
 * they come and decided on once per task, so a window that goes somewhere else in steps (into the
 * drawer, out of it) never counts, and one that closes keeps the place it had in its layout, not
 * the slot its plugin shows in until it stops. Nothing is logged before the desk has started, nor
 * when a profile or a saved layout is put in place: only the person closes windows.
 */
import type { DesktopId, SurfacePlacement } from "../modes/types";
import { desktopId, desktopsOf, layoutOf, windowsOf } from "../shell/actions";
import type { DeskState, Store } from "../shell/state";
import { surfaceTitle, type Titled } from "../shell/titles";
import { LAUNCHER, leaves, panesOf } from "../surface/tree";
import { resolveView } from "../surface/views";
import { contextOf, provide } from "./registry";
import { readLog } from "./saved";

export const CLOSED_MAX = 20;
/** The shell storage key the log is kept under. */
export const CLOSED_KEY = "closed-windows";

export interface ClosedWindow {
  id: string;
  title: string;
  /** The plugin its first pane showed. */
  plugin?: string;
  /** Every plugin it showed, each once: reopening it starts those that are not running. */
  plugins: string[];
  /** What each pane showed, resolved: a window that shows these again under its id came back. */
  views: string[];
  /** The desktop it was on; absent when it was in the drawer. */
  desktop?: DesktopId;
  placement: SurfacePlacement;
  /** Where it was on screen with its desktop in front, as the window manager placed it. */
  rect?: { x: number; y: number; w: number; h: number };
  /** Wall-clock milliseconds when it closed. */
  at: number;
}

export interface ClosedStorage {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
}

export interface ClosedOptions {
  storage?: ClosedStorage;
  /** Resolves once the desk has started (the saved session is back); absent: at once. */
  ready?: Promise<unknown>;
  /** Whether what changed was a saved layout put back, not the person; asking clears it. */
  restoring?: () => boolean;
}

export interface ClosedLog {
  /** The last closed first. */
  list(): ClosedWindow[];
  forget(id: string): ClosedWindow | undefined;
  /** Put an entry back in front, as a reopen that could not finish does. */
  put(entry: ClosedWindow): void;
  /** Resolves once the saved log is read and the desk has started. */
  readonly ready: Promise<void>;
  dispose(): void;
}

/** A window where it is now; `placed`: its layout or the drawer holds it, not a plugin's slot. */
type Seen = { window: Omit<ClosedWindow, "at">; placed: boolean };
type Watched = Titled & { wall(): number };

export const closedOf = (store: Store): ClosedLog | undefined => contextOf(store).closed;

function seenOf(
  ctx: Titled,
  s: DeskState,
  p: SurfacePlacement,
  desktop: DesktopId | undefined,
  placed: boolean,
  name?: string,
): Seen {
  const views = leaves(panesOf(p)).map((leaf) => resolveView(s, p, leaf.view));
  const plugins = [...new Set(views.filter((v) => v.startsWith("plugin:")).map((v) => v.slice(7)))];
  const plugin = plugins[0];
  const title =
    name ??
    (plugin ? (s.adopted.find((a) => a.id === plugin)?.title ?? plugin) : undefined) ??
    surfaceTitle(ctx, views[0] ?? p.id);
  const rect = desktop ? s.wm.rects[desktop]?.[p.id] : undefined;
  const window = {
    id: p.id,
    title,
    ...(plugin ? { plugin } : {}),
    plugins,
    views,
    ...(desktop ? { desktop } : {}),
    placement: p,
    ...(rect ? { rect } : {}),
  };
  return { window, placed };
}

/** Every window on the desk by id: the desktop in front's first, then the others', then the drawer's. */
function seen(ctx: Titled, s: DeskState): Map<string, Seen> {
  const out = new Map<string, Seen>();
  const here = desktopId(s);
  const order = [here, ...desktopsOf(s).flatMap((d) => (d.id === here ? [] : [d.id]))];
  for (const desktop of order) {
    const layout = layoutOf(s, desktop).surfaces;
    const placed = new Set(layout.map((p) => p.id));
    // A window popped out of the canvas (issue 235) is still on the desk: in its OS window.
    for (const p of [...windowsOf(s, desktop), ...layout.filter((w) => w.out)])
      if (!out.has(p.id)) out.set(p.id, seenOf(ctx, s, p, desktop, placed.has(p.id)));
  }
  for (const item of s.drawer) {
    const p = item.placement;
    if (p && !out.has(p.id)) out.set(p.id, seenOf(ctx, s, p, undefined, true, item.name));
  }
  return out;
}

const same = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((v, i) => v === b[i]);
const backIn = (now: Map<string, Seen>, e: ClosedWindow) =>
  same(now.get(e.id)?.window.views ?? [], e.views);

/** Keep the log of windows closed on this desk; it is the store's (closedOf) until disposed. */
export function watchClosed(ctx: Watched, options: ClosedOptions = {}): ClosedLog {
  const { store } = ctx;
  let entries: ClosedWindow[] = [];
  let armed = false;
  let disposed = false;
  let pending = false;
  let saving = false;
  /** The state last decided on, every window seen since, and the windows as they are now. */
  let decided = store.get();
  let now = seen(ctx, decided);
  let since = new Map(now);
  /** When each window that left since was last seen, in the order they left. */
  const left = new Map<string, { order: number; at: number }>();
  let order = 0;

  const save = () => {
    const storage = options.storage;
    if (!storage || saving || disposed) return;
    saving = true;
    queueMicrotask(() => {
      saving = false;
      void storage.set(CLOSED_KEY, { version: 1, closed: entries }).catch(() => {});
    });
  };
  /** Decide on every change since the last time: what closed, and what came back. */
  const flush = () => {
    if (!pending) return;
    pending = false;
    const s = store.get();
    const prev = decided;
    decided = s;
    const kept = entries.filter((e) => !backIn(now, e));
    let changed = kept.length !== entries.length;
    entries = kept;
    const restoring = options.restoring?.() === true;
    const quiet = !armed || restoring || prev.modeId !== s.modeId || prev.modes !== s.modes;
    const gone = quiet
      ? []
      : [...since.values()]
          .map((w) => w.window)
          .filter((w) => !now.has(w.id) && w.views.some((view) => view !== LAUNCHER))
          .map((w) => ({ ...structuredClone(w), ...(left.get(w.id) ?? { order, at: ctx.wall() }) }))
          .sort((a, b) => b.order - a.order);
    since = new Map(now);
    left.clear();
    if (gone.length) {
      const ids = new Set(gone.map((w) => w.id));
      const closed = gone.map(({ order: _order, ...w }) => w);
      entries = [...closed, ...entries.filter((e) => !ids.has(e.id))].slice(0, CLOSED_MAX);
      changed = true;
    }
    if (changed) save();
  };
  /** Look at a change as it comes: a window that left its layout for its slot keeps its layout's place. */
  const look = () => {
    const before = now;
    now = seen(ctx, store.get());
    for (const id of before.keys())
      if (!now.has(id)) left.set(id, { order: ++order, at: ctx.wall() });
    for (const [id, w] of now) {
      left.delete(id);
      if (!(since.get(id)?.placed && !w.placed)) since.set(id, w);
    }
    if (pending) return;
    pending = true;
    queueMicrotask(flush);
  };

  // A version that moves when anything a window's whereabouts depend on changed: cheap to compare.
  const inputs = (s: DeskState) => [s.session, s.desktops, s.modes, s.modeId, s.drawer, s.adopted];
  let refs = inputs(decided);
  let version = 0;
  const off = store.watch((s) => {
    const next = inputs(s);
    if (next.some((v, i) => v !== refs[i])) {
      refs = next;
      version++;
    }
    return version;
  }, look);

  const load = async () => {
    const saved = await options.storage?.get<unknown>(CLOSED_KEY).catch(() => undefined);
    flush();
    const ids = new Set(entries.map((e) => e.id));
    const back = readLog(saved, CLOSED_MAX).filter((e) => !ids.has(e.id) && !backIn(now, e));
    entries = [...entries, ...back].slice(0, CLOSED_MAX);
  };
  const start = () => {
    flush();
    armed = !disposed;
  };
  const ready = Promise.all([load(), options.ready]).then(start, start);

  const log: ClosedLog = {
    list: () => {
      flush();
      return entries.map((e) => structuredClone(e));
    },
    forget(id) {
      flush();
      const entry = entries.find((e) => e.id === id);
      if (!entry) return undefined;
      entries = entries.filter((e) => e !== entry);
      save();
      return structuredClone(entry);
    },
    put(entry) {
      flush();
      entries = [entry, ...entries.filter((e) => e.id !== entry.id)].slice(0, CLOSED_MAX);
      save();
    },
    ready,
    dispose() {
      disposed = true;
      armed = false;
      off();
      unprovide();
    },
  };
  const unprovide = provide(store, { closed: log });
  return log;
}
