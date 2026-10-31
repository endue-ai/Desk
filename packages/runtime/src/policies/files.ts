/**
 * desk.files (files.el, auto-mode-alist): which plugin opens a file, the recent files, saving, and
 * what happens when a file changes on disk. The desk never reads or writes files itself: the plugin
 * that opens a file does, under its own permissions, and the desk asks it to (desk.files.visit,
 * desk.files.save, desk.files.revert).
 */
import { baseName } from "../buffers";
import { CommandError } from "../commands";
import type { NoticeInput } from "../notify";
import { globMatch, type PolicySet } from "../policy";
import type { BuffersPolicy } from "./buffers";
import { type DeskContext, disposer, type Installed } from "./context";

export interface RecentFile {
  path: string;
  plugin: string;
}

export interface FilesPolicy extends Installed {
  /** The plugin that opens `path` as the rules say, or undefined. */
  openerFor(path: string): string | undefined;
  recent(): RecentFile[];
  /** Read the recent files the desk kept (store.get); call once at start. */
  load(): Promise<void>;
}

const RECENT_KEY = "files.recent";
/** How long after desk.files.save a change on disk at that path counts as the save itself. */
const OWN_SAVE_MS = 3000;

/** The message of a failed request, without the error's class name in front. */
const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** The opener for `path`: the first rule whose pattern matches the file name (or the whole path). */
export function opener(rules: PolicySet["files"], path: string): string | undefined {
  const name = baseName(path);
  return rules.find((rule) => globMatch(rule.pattern, rule.pattern.includes("/") ? path : name))
    ?.plugin;
}

export function installFiles(
  ctx: DeskContext,
  buffers: BuffersPolicy,
  notify: (input: NoticeInput) => void,
): FilesPolicy {
  const { hub, bridge } = ctx;
  const { commands, settings } = hub;
  const list = buffers.buffers;
  const offs = disposer();
  let recent: RecentFile[] = [];
  /** When the desk last had each path saved, so the plugin's own write is not reported as a change. */
  const savedAt = new Map<string, number>();

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
      await bridge.call("plugin.setEnabled", {
        plugin,
        enabled: true,
        scope: { permission: "plugin:manage" },
      });
    }
    await ctx.whenReady(plugin);
  };

  const open = async (path: string, by?: string) => {
    const existing = list.byPath(path);
    if (existing) {
      await buffers.show(existing.id);
      return existing.id;
    }
    const plugin = by ?? opener(hub.policy.files, path);
    if (!plugin) {
      notify({ caller: "desk", title: `No plugin opens ${baseName(path)}`, level: "warning" });
      throw new CommandError("failed", `no plugin opens ${path}`);
    }
    await ready(plugin);
    const id = `file:${path}`;
    list.add({ id, name: baseName(path), plugin, path, modified: false, surface: false });
    try {
      await ctx.request(plugin, "desk.files.visit", { buffer: id, path });
    } catch (error) {
      list.remove(id);
      notify({
        caller: "desk",
        title: `${baseName(path)} did not open`,
        body: reason(error),
        level: "error",
      });
      throw error;
    }
    remember({ path, plugin });
    await buffers.show(id);
    return id;
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
    await ctx.request(buffer.plugin, "desk.files.revert", { buffer: buffer.id, path: buffer.path });
    list.update(buffer.id, { modified: false });
    return buffer.id;
  };

  const define = (id: string, title: string, run: (args: unknown) => unknown, keywords: string[]) =>
    offs.add(
      commands.define(id, { title, keywords: ["files", ...keywords], owner: "desk.files", run }),
    );

  define(
    "desk.files.open",
    "Open a file",
    async (args) => {
      const { path, plugin } = (args ?? {}) as { path?: string; plugin?: string };
      const chosen =
        path ??
        (await pick(
          "Open a file",
          recent.map((r) => ({ id: r.path, label: baseName(r.path), detail: r.path })),
          true,
        ));
      return chosen ? open(chosen, plugin) : null;
    },
    ["find-file"],
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
      await ctx.request(buffer.plugin, "desk.files.save", { buffer: buffer.id, path: buffer.path });
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
      const path = (args as { path?: string } | undefined)?.path ?? "";
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
      const stored = await bridge.call("store.get", { key: RECENT_KEY }).catch(() => ({}));
      const value = (stored as { value?: unknown }).value;
      if (Array.isArray(value)) recent = value as RecentFile[];
    },
    dispose: offs.dispose,
  };
}
