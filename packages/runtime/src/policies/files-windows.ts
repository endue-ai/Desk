/**
 * Which window of its opener a file opens in (ADR 0212). An opener whose first surface says
 * `instances: "per-file"` opens each file in a window of its own while `desk.files.window` is
 * `per-file` (the default): a window of it that holds no file takes the file, else a new window
 * opens for it. A file the opener opens itself (Images walking a folder, Notes following a link)
 * stays in the window it was opened from. With `shared`, or for any other opener, the plugin's one
 * window shows every file, as before. A file's window closes with the file while another window of
 * its plugin stays; the plugin's last window stays as one window always did.
 */
import { type Buffer, type Buffers, windowOf } from "../buffers";
import { perFile, pluginOf } from "../instances";
import type { DeskContext } from "./context";

export const WINDOW_SETTING = "desk.files.window";

export interface FileWindows {
  /**
   * The window of `plugin` that opens a file, connected, and whether it opened for it. `ready`
   * turns the plugin on when it is off. `caller` is who asked to open the file.
   */
  place(
    plugin: string,
    caller: string | undefined,
    ready: () => Promise<void>,
  ): Promise<{ key: string; opened: boolean }>;
  /**
   * The file's buffer went into the list, or out of it again when its visit failed: its window
   * counts what it holds from the list now, and one opened for a file that did not open goes.
   */
  placed(key: string, opened: boolean): void;
  /** A buffer closed: its window goes too when it held one file and its plugin has another. */
  closed(buffer: Buffer): void;
}

export function fileWindows(ctx: DeskContext, list: Buffers): FileWindows {
  const { hub } = ctx;
  /** Windows chosen for a file whose buffer is not in the list yet. */
  const taken = new Set<string>();
  const holds = (key: string) => taken.has(key) || list.ofWindow(key).some((b) => !b.surface);
  const windows = (plugin: string) => ctx.instances?.(plugin) ?? [plugin];
  const perFileNow = (plugin: string) =>
    ctx.another !== undefined &&
    hub.settings.get(WINDOW_SETTING, "per-file") === "per-file" &&
    perFile(hub.plugins.find((p) => p.id === plugin)?.manifest);

  return {
    async place(plugin, caller, ready) {
      // One window shows every file, as before.
      if (!perFileNow(plugin)) {
        await ready();
        return { key: plugin, opened: false };
      }
      // A file the opener opens itself stays in the window it was opened from.
      if (caller === plugin && ctx.mounted(plugin))
        return { key: ctx.inUse?.(plugin) ?? plugin, opened: false };
      // Off: it comes on with its first window, which takes the file.
      if (!ctx.mounted(plugin)) await ready();
      const free = windows(plugin).find((key) => !holds(key));
      const key = free ?? ctx.another?.(plugin) ?? plugin;
      taken.add(key);
      try {
        await ctx.whenReady(key);
      } catch (error) {
        taken.delete(key);
        throw error;
      }
      return { key, opened: free === undefined };
    },
    placed(key, opened) {
      taken.delete(key);
      // A window opened for a file that did not open shows nothing: it goes.
      if (opened && !holds(key) && windows(pluginOf(key)).includes(key)) ctx.unmount(key);
    },
    closed(buffer) {
      const key = windowOf(buffer);
      if (buffer.surface || buffer.path === undefined || !perFileNow(buffer.plugin)) return;
      const open = windows(buffer.plugin);
      if (open.length > 1 && open.includes(key) && !holds(key)) ctx.unmount(key);
    },
  };
}
