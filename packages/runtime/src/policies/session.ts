/**
 * desk.session (desktop.el, savehist): keep the desk as it was across restarts. The layout, the
 * files open in buffers, the surface in use and the notification history are kept with store.set
 * whenever they change, and put back after the plugins have mounted.
 */
import { type Layout, loadLayout } from "../layout";
import type { Notice } from "../notify";
import type { BuffersPolicy } from "./buffers";
import { type DeskContext, disposer, type Installed } from "./context";

export const SESSION_KEY = "session";
/** Changes coalesce for this long before they are saved. */
const SAVE_DELAY_MS = 250;

export interface SavedSession {
  version: 1;
  layout: Layout;
  /** File buffers, least recently used first, so reopening them in order ends on the last one. */
  files: Array<{ path: string; plugin: string }>;
  focused: string | null;
  notices: Notice[];
}

export interface SessionActions {
  layout(): Layout;
  setLayout(layout: Layout): void;
  focus(id: string): void;
  focused(): string | null;
  notices(): Notice[];
  restoreNotices(notices: Notice[]): void;
}

export interface SessionPolicy extends Installed {
  /** Something worth keeping changed: save soon. */
  changed(): void;
  /** Put the saved session back (once, after the plugins mounted), if desk.session says so. */
  restore(): Promise<void>;
  save(): Promise<void>;
}

export function installSession(
  ctx: DeskContext,
  buffers: BuffersPolicy,
  actions: SessionActions,
): SessionPolicy {
  const { hub, bridge, win, surfaces } = ctx;
  const { commands, settings } = hub;
  const offs = disposer();
  let timer: number | undefined;
  // Saving waits until the saved session was read, so a fresh start never overwrites it.
  let restored = false;

  const on = () => hub.enabled("desk.session");
  const snapshot = (): SavedSession => ({
    version: 1,
    layout: actions.layout(),
    files: buffers.buffers
      .list()
      .filter((buffer) => buffer.path !== undefined)
      .map((buffer) => ({ path: buffer.path as string, plugin: buffer.plugin }))
      .reverse(),
    focused: actions.focused(),
    notices: settings.get("desk.session.save-history", true) ? actions.notices().reverse() : [],
  });

  const save = async () => {
    if (timer !== undefined) win.clearTimeout(timer);
    timer = undefined;
    if (!on() || !restored || !settings.get("desk.session.save", true)) return;
    await bridge.call("store.set", { key: SESSION_KEY, value: snapshot() }).catch(() => {});
  };
  const changed = () => {
    if (timer !== undefined || !restored) return;
    timer = win.setTimeout(() => void save(), SAVE_DELAY_MS);
  };

  const read = async (): Promise<SavedSession | undefined> => {
    const stored = await bridge.call("store.get", { key: SESSION_KEY }).catch(() => ({}));
    const value = (stored as { value?: unknown }).value as Partial<SavedSession> | undefined;
    return value?.version === 1 ? (value as SavedSession) : undefined;
  };

  const restore = async () => {
    const saved = on() && settings.get("desk.session.restore", true) ? await read() : undefined;
    if (saved) {
      // loadLayout validates what it is given, so a damaged session keeps the current layout.
      const layout = loadLayout({ getItem: () => JSON.stringify(saved.layout), setItem: () => {} });
      if (JSON.stringify(layout) === JSON.stringify(saved.layout)) actions.setLayout(layout);
      if (Array.isArray(saved.notices)) actions.restoreNotices(saved.notices);
      for (const file of saved.files ?? []) {
        await commands.run("desk.files.open", file).catch(() => {});
      }
      if (saved.focused && surfaces.get(saved.focused)) actions.focus(saved.focused);
    }
    restored = true;
  };

  offs.add(buffers.buffers.onChange(changed));
  const onHide = () => void save();
  win.addEventListener("pagehide", onHide);
  offs.add(() => win.removeEventListener("pagehide", onHide));
  offs.add(() => {
    if (timer !== undefined) win.clearTimeout(timer);
  });

  const define = (id: string, title: string, run: () => unknown) =>
    offs.add(
      commands.define(id, { title, keywords: ["session", "desktop"], owner: "desk.session", run }),
    );
  define("desk.session.save", "Save the session now", async () => {
    await save();
    return snapshot();
  });
  define("desk.session.restore", "Put the saved session back", () => restore());
  define("desk.session.forget", "Forget the saved session", async () => {
    await bridge.call("store.set", { key: SESSION_KEY, value: null });
  });

  return { changed, restore, save, dispose: offs.dispose };
}
