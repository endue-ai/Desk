/**
 * desk.files (files.el, auto-mode-alist): which plugin opens a file, the recent files, saving, and
 * what happens when a file changes on disk. The desk never reads or writes files itself: the plugin
 * that opens a file does, under its own permissions, and the desk asks it to (desk.files.visit,
 * desk.files.save, desk.files.revert). Opening a file the person chose never asks: the desk gives its
 * opener read access to the file's folder first (perm.grant, ADR 0131). An autoload opener that is
 * off comes on for a file and, when the desk turned it on, goes off again with its last buffer (ADR
 * 0046). A file no rule names opens in the fallbacks (`files-open.ts`), and a file is named in one
 * spelling, so it is one buffer. An opener that asks for it opens each file in a window of its own
 * (`files-windows.ts`, ADR 0212).
 */
import { baseName, windowOf } from "../buffers";
import { type AgentSpec, CommandError, type CommandHandler } from "../commands";
import type { NoticeInput } from "../notify";
import { autoloads } from "../policy";
import type { BufferEvents, BuffersPolicy } from "./buffers";
import { type DeskContext, disposer, type Installed } from "./context";
import { folderRead, OPEN_FOR_AGENTS, onePath, opener, openers, personChose } from "./files-open";
import { fileWindows } from "./files-windows";

export { folderRead, opener, personChose } from "./files-open";

export interface RecentFile {
  path: string;
  plugin: string;
}

export interface FilesPolicy extends Installed {
  /** The plugin that opens `path` as the rules say (case folded when none matches as written). */
  openerFor(path: string): string | undefined;
  recent(): RecentFile[];
  /** Read the recent files the desk kept (store.get); call once at start. */
  load(): Promise<void>;
  /** Once the session is back: turn off the autoload plugins the desk turned on that hold no file. */
  settle(): void;
}

const RECENT_KEY = "files.recent";
/** The autoload plugins the desk turned on for a file, kept so that a restart still knows them. */
const AUTOLOADED_KEY = "files.autoloaded";
const MANAGE = { permission: "plugin:manage" } as const;
/** How long after desk.files.save a change on disk at that path counts as the save itself. */
const OWN_SAVE_MS = 3000;

/** The message of a failed request, without the error's class name in front. */
const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function installFiles(
  ctx: DeskContext,
  buffers: BuffersPolicy & BufferEvents,
  notify: (input: NoticeInput) => void,
  pickFile?: () => Promise<string | null>,
  /** The recent list in the store could not be read; it was kept as `<key>.broken` (ADR 0061). */
  broken?: (key: string) => void,
  /**
   * The host's name for a path: the folders above the file followed through their links, the home
   * folder as `~`; it answers the path as given when it cannot say. Without it, one spelling only.
   */
  realPath?: (path: string) => Promise<string>,
): FilesPolicy {
  const { hub, bridge } = ctx;
  const { commands, settings } = hub;
  const list = buffers.buffers;
  const offs = disposer();
  let recent: RecentFile[] = [];
  /** When the desk last had each path saved, so the plugin's own write is not reported as a change. */
  const savedAt = new Map<string, number>();
  /** Autoload plugins that were off until the desk turned them on for a file; not the person's. */
  const autoloaded = new Set<string>();
  const keepAutoloaded = () =>
    void bridge.call("store.set", { key: AUTOLOADED_KEY, value: [...autoloaded] }).catch(() => {});
  /** Plugins the desk just turned off, until the plugin list says so too. */
  const goingOff = new Set<string>();
  offs.add(
    hub.onPolicy(() => {
      for (const plugin of goingOff) if (!hub.enabled(plugin)) goingOff.delete(plugin);
    }),
  );

  const remember = (file: RecentFile) => {
    const max = settings.get("desk.files.recent-max", 20);
    recent = [file, ...recent.filter((r) => r.path !== file.path)].slice(0, Math.max(0, max));
    void bridge.call("store.set", { key: RECENT_KEY, value: recent }).catch(() => {});
  };

  const pick = async (title: string, items: unknown[], free = false) => {
    if (!commands.has("desk.palette.pick")) return undefined;
    const answer = await commands
      .run("desk.palette.pick", { title, items, free, placeholder: free ? "~/path/to/file" : "" })
      .catch(() => undefined);
    return typeof answer === "string" ? answer : undefined;
  };

  /** Turn the opener on when it is off, and wait until it can answer. */
  const ready = async (plugin: string) => {
    if (!ctx.mounted(plugin)) {
      const info = hub.plugins.find((p) => p.id === plugin);
      const off = goingOff.delete(plugin) || info?.enabled === false;
      await ctx.launch(plugin);
      // Off and autoload: the desk turned it on, so the desk turns it off after its last file.
      if (autoloads(info) && off && !autoloaded.has(plugin)) {
        autoloaded.add(plugin);
        keepAutoloaded();
      }
    } else await ctx.launch(plugin);
    await ctx.whenReady(plugin);
  };

  /** Turn off an autoload plugin the desk turned on, once it holds no buffer: its windows go now. */
  const release = (plugin: string) => {
    if (!autoloaded.has(plugin) || list.ofPlugin(plugin).some((b) => !b.surface)) return;
    autoloaded.delete(plugin);
    keepAutoloaded();
    if (ctx.mounted(plugin))
      for (const key of (ctx.instances?.(plugin) ?? [plugin]).reverse()) ctx.unmount(key);
    goingOff.add(plugin);
    void bridge
      .call("plugin.setEnabled", { plugin, enabled: false, scope: MANAGE })
      .catch(() => {});
  };
  /** Files whose buffer has not shown yet (opened with `show: false`), by path. */
  const unshown = new Set<string>();
  const windows = fileWindows(ctx, list);
  offs.add(
    buffers.onClosed((buffer) => {
      if (buffer.path) unshown.delete(buffer.path);
      windows.closed(buffer);
      release(buffer.plugin);
    }),
  );

  /** Opens still waiting for their plugin's visit (a permission prompt, a long read), by path. */
  const visiting = new Map<string, { opening: Promise<string>; show: boolean }>();

  /** Show an open file's buffer; the first time, the file joins the recent files. */
  const reveal = async (id: string) => {
    const buffer = list.get(id);
    if (buffer?.path && unshown.delete(buffer.path))
      remember({ path: buffer.path, plugin: buffer.plugin });
    await buffers.show(id);
    return id;
  };

  /**
   * `path` as its buffer is named: one spelling, and the host's name for it (links followed, the
   * home folder as `~`) unless a buffer or a visit already has that spelling.
   */
  const named = async (path: string) => {
    const one = onePath(path);
    if (!realPath || list.byPath(one) || visiting.has(one)) return one;
    return onePath(await realPath(one).catch(() => one));
  };

  /**
   * Open `path`, or show its buffer; with `show` false (find-file-noselect), open it without showing
   * it. A second open while the first visit is still on its way joins that one: the plugin cannot
   * show a buffer it does not hold yet ("No note file:…").
   */
  const open = async (
    given: string,
    by?: string,
    show = true,
    chosen = true,
    caller?: string,
  ): Promise<string> => {
    const path = await named(given);
    const going = visiting.get(path);
    if (going) return show && !going.show ? going.opening.then(reveal) : going.opening;
    const existing = list.byPath(path);
    if (existing) return show ? reveal(existing.id) : Promise.resolve(existing.id);
    const opening = visit(path, by, show, chosen, caller).finally(() => {
      if (visiting.get(path)?.opening === opening) visiting.delete(path);
    });
    visiting.set(path, { opening, show });
    return opening;
  };

  /** The person chose the file: its opener may read the folder without asking (ADR 0131). */
  const allowRead = (plugin: string, path: string) =>
    bridge
      .call("perm.grant", {
        caller: plugin,
        permission: folderRead(path),
        reason: `The person opened ${path}`,
        scope: { permission: "perm:manage" },
      })
      // Without it the opener asks as before.
      .catch(() => undefined);

  /** The plugins that may open `path`, in turn: the one named, its rule's, or the fallbacks. */
  const openersOf = (path: string, by: string | undefined) => {
    if (by) return [by];
    const fallback = settings.get("desk.files.fallback", "endue.data");
    const installed = (plugin: string) => hub.plugins.some((p) => p.id === plugin);
    return openers(hub.policy.files, path, typeof fallback === "string" ? fallback : "", installed);
  };

  const visit = async (
    path: string,
    by: string | undefined,
    show: boolean,
    chosen: boolean,
    caller: string | undefined,
  ) => {
    const plugins = openersOf(path, by);
    if (plugins.length === 0) {
      notify({ caller: "desk", title: `No plugin opens ${baseName(path)}`, level: "warning" });
      throw new CommandError("failed", `no plugin opens ${path}`);
    }
    const id = `file:${path}`;
    for (const [at, plugin] of plugins.entries()) {
      const { key, opened } = await windows.place(plugin, caller, () => ready(plugin));
      if (chosen) await allowRead(plugin, path);
      const file = { id, name: baseName(path), plugin, path, modified: false, surface: false };
      list.add(key === plugin ? file : { ...file, instance: key });
      windows.placed(key, opened);
      try {
        await ctx.request(key, "desk.files.visit", { buffer: id, path });
      } catch (error) {
        list.remove(id);
        windows.placed(key, opened);
        release(plugin);
        // The text opener could not read a name without an extension: the fallback shows it.
        if (at < plugins.length - 1) continue;
        notify({
          caller: "desk",
          title: `${baseName(path)} did not open`,
          body: reason(error),
          level: "error",
        });
        throw error;
      }
      break;
    }
    unshown.add(path);
    return show ? reveal(id) : id;
  };

  /** The file buffer a command is about: the one named, or the one in use. */
  const fileBuffer = (args: unknown) => {
    const named = (args as { buffer?: string } | undefined)?.buffer;
    const buffer = named ? list.get(named) : list.current();
    if (!buffer?.path) throw new CommandError("failed", "the buffer in use holds no file");
    return buffer as typeof buffer & { path: string };
  };

  const revert = async (args: unknown) => {
    const buffer = fileBuffer(args);
    await ctx.request(windowOf(buffer), "desk.files.revert", {
      buffer: buffer.id,
      path: buffer.path,
    });
    list.update(buffer.id, { modified: false });
    return buffer.id;
  };

  const define = (
    id: string,
    title: string,
    run: CommandHandler,
    keywords: string[],
    agent?: AgentSpec,
  ) =>
    offs.add(
      commands.define(id, {
        title,
        keywords: ["files", ...keywords],
        owner: "desk.files",
        run,
        ...(agent ? { agent } : {}),
      }),
    );

  define(
    "desk.files.open",
    "Open a file",
    async (args, from) => {
      const { path, plugin, show } = (args ?? {}) as {
        path?: string;
        plugin?: string;
        show?: boolean;
      };
      const chosen =
        path ??
        (pickFile
          ? await pickFile()
          : await pick(
              "Open a file",
              recent.map((r) => ({ id: r.path, label: baseName(r.path), detail: r.path })),
              true,
            ));
      if (!chosen) return null;
      return open(chosen, plugin, show !== false, personChose(from, plugin), from.caller);
    },
    ["find-file"],
    OPEN_FOR_AGENTS,
  );
  define(
    "desk.files.recent",
    "Open a recent file",
    async () => {
      const path = await pick(
        "Recent files",
        recent.map((r) => ({ id: r.path, label: baseName(r.path), detail: r.path })),
      );
      return path ? open(path) : null;
    },
    ["recentf", "history"],
  );
  define(
    "desk.files.save",
    "Save the file",
    async (args) => {
      const buffer = fileBuffer(args);
      await ctx.request(windowOf(buffer), "desk.files.save", {
        buffer: buffer.id,
        path: buffer.path,
      });
      list.update(buffer.id, { modified: false });
      savedAt.set(buffer.path, Date.now());
      notify({ caller: "desk", title: `Saved ${buffer.name}`, level: "success" });
      return buffer.id;
    },
    ["save-buffer", "write"],
  );
  define("desk.files.revert", "Reload the file from disk", revert, ["revert-buffer"]);
  define(
    "desk.files.changed",
    "Handle a file that changed on disk",
    async (args) => {
      const path = onePath((args as { path?: string } | undefined)?.path ?? "");
      const buffer = list.byPath(path);
      if (!buffer) return "not open";
      // The watch fires for the plugin's own write too: just saved and unchanged since means it.
      const saved = savedAt.get(path);
      if (saved !== undefined && Date.now() - saved < OWN_SAVE_MS && !buffer.modified) {
        savedAt.delete(path);
        return "own-save";
      }
      const rule = settings.get<"reload" | "ask" | "ignore">("desk.files.on-change", "reload");
      if (rule === "ignore") return "ignored";
      if (rule === "reload" && !buffer.modified) {
        await revert({ buffer: buffer.id });
        notify({ caller: "desk", title: `Reloaded ${buffer.name}`, body: "It changed on disk." });
        return "reloaded";
      }
      notify({ caller: "desk", title: `${buffer.name} changed on disk`, level: "warning" });
      const choice = await pick(`${buffer.name} changed on disk`, [
        {
          id: "reload",
          label: "Reload it from disk",
          detail: buffer.modified ? "loses your changes" : "",
        },
        { id: "keep", label: "Keep the version open here" },
      ]);
      if (choice !== "reload") return "kept";
      await revert({ buffer: buffer.id });
      return "reloaded";
    },
    ["auto-revert"],
  );

  return {
    openerFor: (path) => opener(hub.policy.files, path),
    recent: () => [...recent],
    load: async () => {
      const [stored, kept] = await Promise.all(
        [RECENT_KEY, AUTOLOADED_KEY].map((key) =>
          bridge.call("store.get", { key }).catch(() => ({})),
        ),
      );
      const value = (stored as { value?: unknown }).value;
      if (Array.isArray(value)) recent = value as RecentFile[];
      else if (value !== undefined && value !== null) {
        await bridge.call("store.set", { key: `${RECENT_KEY}.broken`, value }).catch(() => {});
        await bridge.call("store.set", { key: RECENT_KEY, value: [] }).catch(() => {});
        broken?.(RECENT_KEY);
      }
      const plugins = (kept as { value?: unknown }).value;
      if (Array.isArray(plugins)) {
        for (const plugin of plugins) if (typeof plugin === "string") autoloaded.add(plugin);
      }
    },
    settle: () => {
      for (const plugin of [...autoloaded]) {
        // Turned off since (by hand, or while Desk was not running): no longer the desk's.
        if (hub.plugins.find((p) => p.id === plugin)?.enabled === true) release(plugin);
        else if (autoloaded.delete(plugin)) keepAutoloaded();
      }
    },
    dispose: offs.dispose,
  };
}
