/**
 * Surfaces as windows: ⌘N opens a new one with a launcher, a plugin's window takes further
 * windows of that plugin as tabs (ADR 0270), and a tab closes or takes another view. Each is an edit the window manager makes (crates/desk-wm, #83),
 * as are maximizing, snapping and moving or resizing by a step (`window-commands.ts`, ADR 0153).
 * What stays the runtime's: the plugin surface in use takes the keys once the desk that made it is
 * in, and closing a window unmounts the plugins it showed for the session (ADR 0040), once the
 * person said what becomes of their unsaved changes (desk.buffers).
 */
import { windowPlugins } from "../surface/placed";
import { shownTab, tabKind, tabsOf } from "../surface/tree";
import { resolveView } from "../surface/views";
import type { Edit, Published } from "../wm/types";
import { takeDesk } from "../wm/view";
import { type Ctx, edit, settled, windowsOf } from "./actions";

/**
 * The runtime's surfaces follow the tab in use: a plugin's takes the keys, a view of the shell's
 * own takes them from the plugins. Only after a focus the person or a command asked for.
 */
function follow(ctx: Ctx): void {
  const s = ctx.store.get();
  if (s.focused === null) return;
  const plugin = s.wm.focusedPlugin;
  // Following asks for nothing (ADR 0230): the window manager has this tab in use already, and
  // asking for its window again could take the window in use back from a later press.
  if (plugin) {
    if (ctx.runtime.shortcuts.focused !== plugin) ctx.runtime.followSurface(plugin);
  } else if (ctx.runtime.shortcuts.focused) {
    ctx.runtime.followSurface(null);
  }
}

/** The desks (by their store) taking what the window manager published now. */
const taking = new WeakSet<object>();

/**
 * Whether the desk is taking a desk the window manager published: a focus the page moves
 * meanwhile is the page following, never the person asking for a window.
 */
export const isFollowing = (ctx: Pick<Ctx, "store">): boolean => taking.has(ctx.store);

/**
 * Take a desk the window manager published; when it put another window or tab in use (a press
 * it heard, a close, an agent's call), the page's focus goes along (ADR 0230). The page asks for
 * nothing here. While a move the runtime asked for is on its way, its own desk is the one to
 * follow (`focusing`): one that answers an earlier move names a focus already given away.
 */
export function takeAndFollow(ctx: Ctx, published: Published): void {
  const was = ctx.store.get();
  taking.add(ctx.store);
  try {
    takeDesk(ctx.store, published);
    const s = ctx.store.get();
    const same =
      s.focused === was.focused && s.tab === was.tab && s.wm.focusedPlugin === was.wm.focusedPlugin;
    if (same || s.focused === null || movesOf(ctx).going > 0) return;
    ctx.runtime?.followSurface(s.wm.focusedPlugin, true);
  } finally {
    taking.delete(ctx.store);
  }
}

/** Each desk's focus moves (by its store): how many were asked, and how many are on their way. */
const moves = new WeakMap<object, { asked: number; going: number }>();

function movesOf(ctx: Ctx): { asked: number; going: number } {
  const known = moves.get(ctx.store);
  if (known) return known;
  const m = { asked: 0, going: 0 };
  moves.set(ctx.store, m);
  return m;
}

/**
 * `edits` that move the focus, then the runtime's surfaces follow it: only when no later move was
 * asked and the runtime's focus is where this one left it. In the app the desk comes back late
 * (ADR 0153), so a desk that answers an earlier move names a focus already given away; following
 * it took the focus back, which asked again, and two moves on their way never settled (issue 160).
 * It follows on the desk the batches asked for after it leave: a press that focuses a window and
 * puts it in the drawer with the same click follows no window that is gone, since focusing a
 * plugin's surface shows its window (issue 159, finding 12).
 */
async function focusing(ctx: Ctx, ...edits: Edit[]): Promise<unknown[]> {
  const m = movesOf(ctx);
  const mine = ++m.asked;
  const keys = ctx.runtime.shortcuts.focused;
  m.going += 1;
  try {
    const answers = await edit(ctx, ...edits);
    await settled(ctx);
    if (m.asked === mine && ctx.runtime.shortcuts.focused === keys) follow(ctx);
    return answers;
  } finally {
    m.going -= 1;
  }
}

/** The plugins a close answered: they unmount for the session (ADR 0040). */
function unmount(ctx: Ctx, answer: unknown): void {
  if (!Array.isArray(answer)) return;
  for (const plugin of answer) {
    if (typeof plugin === "string") ctx.runtime.plugins?.unmount(plugin);
  }
}

/** Reveal a plugin's tab, wherever it is (another desktop, the drawer), else in a new window. */
export function showPlugin(ctx: Ctx, id: string): Promise<unknown[]> {
  return focusing(ctx, { op: "show-plugin", id });
}

/**
 * Focus a surface, showing one of its tabs (the one it shows when none is named). One already in
 * use is not asked for again, unless a move is on its way: the desk that names it in use is not
 * the last.
 */
export function focusTab(ctx: Ctx, surface: string, tab?: string): Promise<unknown[]> {
  const s = ctx.store.get();
  const inUse = s.focused === surface && (tab === undefined || s.tab === tab);
  if (inUse && movesOf(ctx).going === 0) {
    follow(ctx);
    return Promise.resolve([null]);
  }
  return focusing(ctx, { op: "focus", window: surface, ...(tab ? { tab } : {}) });
}

/** Switch a window between normal and floating, keeping where it is on screen. */
export function toggleFloating(ctx: Ctx, id: string): Promise<unknown[]> {
  return edit(ctx, { op: "toggle-floating", id });
}

/** The focused window, for the palette's window commands; nothing happens with none. */
export function focusedWindow(ctx: Ctx): string | undefined {
  const s = ctx.store.get();
  return windowsOf(s).find((p) => p.id === s.focused)?.id;
}

/**
 * A new surface with one launcher tab, cascading from the middle of what is in sight: its id, the
 * first `window-<n>` no window on any desktop or in the drawer has (issue 101).
 */
export async function newWindow(ctx: Ctx): Promise<string> {
  const [id] = await focusing(ctx, { op: "new-window" });
  return typeof id === "string" ? id : "";
}

/** The plugin whose windows window `id` takes as tabs; none for a window of the shell's own view. */
export function tabKindOf(ctx: Pick<Ctx, "store">, id: string): string | undefined {
  const s = ctx.store.get();
  const p = windowsOf(s).find((w) => w.id === id);
  return p && tabKind(tabsOf(p), (view) => resolveView(s, p, view));
}

/**
 * A new tab in a window (the focused one unless named): another window of the plugin it shows
 * (ADR 0212), the only kind of tab a window takes (ADR 0270). The window manager is told of the
 * tab before the plugin's window opens, so that one never has a window of its own. Answers the
 * tab's id; nothing for a window that takes no tab.
 */
export async function newTab(ctx: Ctx, surface?: string): Promise<string | undefined> {
  const window = surface ?? focusedWindow(ctx);
  const plugin = window === undefined ? undefined : tabKindOf(ctx, window);
  const another = ctx.runtime.plugins?.another;
  if (window === undefined || plugin === undefined || !another) return undefined;
  let asked: Promise<unknown[]> | undefined;
  const key = another(plugin, (opening) => {
    asked = focusing(ctx, { op: "add-tab", window, view: `plugin:${opening}` });
  });
  const [tab] = (await asked) ?? [];
  if (typeof tab === "string") return tab;
  // The window did not take it: no window of the plugin stays open for a tab that is not there.
  ctx.runtime.plugins?.unmount(key);
  return undefined;
}

/** The focused window shows the tab `step` places on (1 next, -1 previous), wrapping around. */
export function stepTab(ctx: Ctx, step: number): Promise<unknown[]> {
  return focusing(ctx, { op: "step-tab", step });
}

/** Whether window `id` may close: its plugins' buffers with unsaved changes asked about first. */
function mayClose(ctx: Ctx, id: string): Promise<boolean> {
  const plugins = windowPlugins(ctx.store.get(), id);
  return ctx.runtime.buffers.mayGo("close", { plugins });
}

/**
 * Close a window: the plugins it shows unmount for the session (ADR 0040). Unsaved changes in them
 * are asked about first, as `Mod+W` asks; the window stays when the person keeps one.
 */
export async function closeWindow(ctx: Ctx, id: string): Promise<void> {
  if (!(await mayClose(ctx, id))) return;
  const [plugins] = await edit(ctx, { op: "close-window", id });
  unmount(ctx, plugins);
}

/**
 * Close a tab (the one the focused window shows unless named): the plugin's window it showed
 * unmounts, once the person said what becomes of its unsaved changes. A window's last tab closes
 * the window.
 */
export async function closeTab(ctx: Ctx, surface?: string, tab?: string): Promise<void> {
  const s = ctx.store.get();
  const window = windowsOf(s).find((p) => p.id === (surface ?? s.focused));
  if (window) {
    const tabs = tabsOf(window);
    const closing = tabs.find((t) => t.id === (tab ?? shownTab(window).id));
    if (!closing) return;
    const view = resolveView(s, window, closing.view);
    const plugins = view.startsWith("plugin:") ? [view.slice("plugin:".length)] : [];
    const may =
      tabs.length === 1
        ? mayClose(ctx, window.id)
        : ctx.runtime.buffers.mayGo("close", { plugins });
    if (!(await may)) return;
  }
  const [plugins] = await focusing(ctx, {
    op: "close-tab",
    ...(surface ? { window: surface } : {}),
    ...(tab ? { tab } : {}),
  });
  unmount(ctx, plugins);
}

export function showInTab(
  ctx: Ctx,
  surface: string,
  tab: string,
  view: string,
): Promise<unknown[]> {
  return focusing(ctx, { op: "show-in-tab", window: surface, tab, view });
}

/**
 * Bring a view up: into the focused launcher tab if there is one, else focus a tab that already
 * shows it, else open it as its own surface.
 */
export function openView(ctx: Ctx, view: string): Promise<unknown[]> {
  return focusing(ctx, { op: "open-view", view });
}
