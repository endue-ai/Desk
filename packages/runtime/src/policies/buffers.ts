/**
 * desk.buffers (buffer.el, ibuffer): the buffer list and its commands. Switching shows a buffer's
 * surface; closing one with unsaved changes asks first, and so do closing the window that shows it
 * and quitting the desk (the list's guard); after a close the previous buffer shows. Plugins open,
 * rename and mark their own buffers with desk.buffers.open and desk.buffers.update. The ring that
 * switching, next, previous and Mod+W walk holds what shows something: a plugin's own surface is
 * one of its stops only while the plugin holds no buffer of its own (#162).
 */
import { type Buffer, Buffers, type Going, type Leaving } from "../buffers";
import { type AgentSpec, CommandError } from "../commands";
import { type DeskContext, disposer, type Installed } from "./context";

export interface BuffersPolicy extends Installed {
  buffers: Buffers;
  /** A plugin's surface opened on the grid: it becomes a buffer. */
  surfaceOpened(plugin: string, title: string): void;
  surfaceClosed(plugin: string): void;
  /** The focus moved to a plugin's surface: its current buffer is in use. */
  focused(plugin: string | null): void;
  /** Show a buffer: its surface, and the buffer inside it when the plugin holds several. */
  show(id: string): Promise<void>;
}

/** What desk.buffers tells the policies that follow its buffers (desk.files). */
export interface BufferEvents {
  /**
   * Hear every buffer that closes: after its plugin heard desk.buffers.closed, before the next
   * buffer shows, and each one that goes with its plugin's surface.
   */
  onClosed(listener: (buffer: Buffer) => void): () => void;
}

export interface BuffersActions {
  focus(plugin: string): void;
}

/** What the person picks about a buffer with unsaved changes as it closes, or as the desk quits. */
const CHOICES: Record<Leaving, Array<{ id: string; label: string }>> = {
  close: [
    { id: "save", label: "Save, then close" },
    { id: "discard", label: "Close without saving" },
    { id: "cancel", label: "Keep it open" },
  ],
  quit: [
    { id: "save", label: "Save, then quit" },
    { id: "discard", label: "Quit without saving" },
    { id: "cancel", label: "Don't quit" },
  ],
};

export function installBuffers(
  ctx: DeskContext,
  actions: BuffersActions,
): BuffersPolicy & BufferEvents {
  const { hub, surfaces } = ctx;
  const { commands, settings } = hub;
  const buffers = new Buffers();
  const offs = disposer();
  let opened = 0;
  const closedListeners = new Set<(buffer: Buffer) => void>();
  const closed = (buffer: Buffer) => {
    for (const listener of [...closedListeners]) listener(buffer);
  };

  const surfaceId = (plugin: string) => `surface:${plugin}`;

  /** A plugin's own buffers, most recently used first: what it opened, not its surface. */
  const own = (plugin: string) => buffers.ofPlugin(plugin).filter((b) => !b.surface);
  /** What a buffer shows: a plugin's surface, while the plugin holds buffers, shows one of them. */
  const shown = (buffer: Buffer | undefined) =>
    buffer?.surface ? (own(buffer.plugin)[0] ?? buffer) : buffer;
  /** Whether the ring stops at a buffer: every one but a surface beside its plugin's own. */
  const inRing = (buffer: Buffer) => shown(buffer)?.id === buffer.id;
  /** The buffer in use: the most recent, as it shows. */
  const inUse = () => shown(buffers.current());
  /** The stop `by` places from the buffer in use, in the list's stable order, wrapping round. */
  const step = (by: number) => {
    let at = inUse()?.id;
    for (let tries = buffers.list().length; tries > 0; tries -= 1) {
      const next = buffers.step(at, by);
      if (!next || inRing(next)) return next;
      at = next.id;
    }
    return undefined;
  };

  const show = async (named: string) => {
    const buffer = shown(buffers.get(named));
    if (!buffer) throw new CommandError("failed", `no buffer ${named}`);
    const { id } = buffer;
    surfaces.show(buffer.plugin, true);
    actions.focus(buffer.plugin);
    buffers.touch(id);
    if (!buffer.surface) {
      await ctx.request(buffer.plugin, "desk.buffers.show", { buffer: id, path: buffer.path });
    }
  };

  const pick = async (
    title: string,
    items: Array<{ id: string; label: string; detail?: string }>,
  ) => {
    if (!commands.has("desk.palette.pick")) return undefined;
    return (await commands.run("desk.palette.pick", { title, items }).catch(() => undefined)) as
      | string
      | undefined;
  };

  /**
   * Ask about each buffer going that has unsaved changes, one at a time and each shown first: save
   * it, let it go, or keep them all (false). A desk that cannot ask (no palette) keeps them when
   * they close and lets them go when it quits, so that it can always quit.
   */
  const ask = async ({ buffers: going, leaving, asking }: Going): Promise<boolean> => {
    if (!settings.get("desk.buffers.confirm-unsaved", true)) return true;
    for (const { id } of going) {
      const buffer = buffers.get(id);
      if (!buffer?.modified) continue;
      if (!commands.has("desk.palette.pick")) return leaving === "quit";
      asking();
      if (inUse()?.id !== id) await show(id).catch(() => {});
      const choice = await pick(`${buffer.name} has unsaved changes`, CHOICES[leaving]);
      if (choice === undefined || choice === "cancel") return false;
      if (choice === "save") await commands.run("desk.files.save", { buffer: id });
    }
    return true;
  };
  offs.add(buffers.guard(ask));

  /** Close a buffer, asking first when it has unsaved changes and the person closes it. */
  const close = async (buffer: Buffer, asks: boolean): Promise<boolean> => {
    // A plugin's own surface takes the plugin's other buffers with it.
    const going = buffer.surface ? buffers.ofPlugin(buffer.plugin) : [buffer];
    if (asks && !(await ask({ buffers: going, leaving: "close", asking: () => {} }))) return false;
    buffers.remove(buffer.id);
    if (buffer.surface) ctx.unmount(buffer.plugin);
    else {
      await ctx
        .request(buffer.plugin, "desk.buffers.closed", { buffer: buffer.id })
        .catch(() => {});
    }
    closed(buffer);
    const next = inUse();
    if (next && settings.get("desk.buffers.after-close", "previous") === "previous") {
      await show(next.id).catch(() => {});
    }
    return true;
  };

  const label = (buffer: Buffer) => `${buffer.modified ? "● " : ""}${buffer.name}`;
  const define = (
    id: string,
    title: string,
    run: (args: unknown, caller: string | undefined) => unknown,
    keywords: string[] = [],
    agent?: AgentSpec,
  ) =>
    offs.add(
      commands.define(id, {
        title,
        keywords: ["buffers", ...keywords],
        owner: "desk.buffers",
        run: (args, from) => run(args, from.caller),
        ...(agent ? { agent } : {}),
      }),
    );
  const idOf = (args: unknown) => (args as { id?: string; buffer?: string } | undefined)?.id;

  define("desk.buffers.list", "List open buffers", () => buffers.list(), ["ibuffer"], {
    description:
      "What is open on the desk, most recently used first: each buffer's id, name, plugin, file path, and whether it has unsaved changes.",
    readOnly: true,
  });
  define(
    "desk.buffers.switch",
    "Switch to a buffer",
    async (args) => {
      const id =
        idOf(args) ??
        (await pick(
          "Switch to a buffer",
          buffers
            .list()
            .filter(inRing)
            .map((b) => ({ id: b.id, label: label(b), detail: b.path ?? b.plugin })),
        ));
      if (!id) return null;
      await show(id);
      return shown(buffers.get(id))?.id ?? id;
    },
    ["switch-to-buffer"],
  );
  for (const [id, title, by] of [
    ["desk.buffers.next", "Next buffer", 1],
    ["desk.buffers.previous", "Previous buffer", -1],
  ] as const) {
    define(id, title, async () => {
      const next = step(by);
      if (next) await show(next.id);
      return next?.id ?? null;
    });
  }
  define(
    "desk.buffers.close",
    "Close the buffer",
    async (args, caller) => {
      const named = idOf(args);
      // Mod+W closes what shows; a plugin's surface named by its id goes with the plugin's buffers.
      const buffer = named === undefined ? inUse() : buffers.get(named);
      if (!buffer) return false;
      if (caller !== undefined && caller !== buffer.plugin && caller !== "desk.palette")
        throw new CommandError("failed", `${caller} may not close ${buffer.plugin}'s buffers`);
      // A plugin closing its own buffer has already decided; the person is asked.
      return close(buffer, caller !== buffer.plugin);
    },
    ["kill-buffer"],
  );
  define("desk.buffers.open", "Open a buffer in a plugin", (args, caller) => {
    const { name, path } = (args ?? {}) as { name?: string; path?: string };
    if (!caller) throw new CommandError("failed", "plugins open their own buffers");
    if (typeof name !== "string" || name === "") throw new CommandError("failed", "say its name");
    const buffer = buffers.add({
      id: `${caller}:${++opened}`,
      name,
      plugin: caller,
      modified: false,
      surface: false,
      ...(path ? { path } : {}),
    });
    buffers.touch(buffer.id);
    return buffer.id;
  });
  define("desk.buffers.update", "Rename a buffer or mark it changed", (args, caller) => {
    const { id, name, modified } = (args ?? {}) as {
      id?: string;
      name?: string;
      modified?: boolean;
    };
    const buffer = buffers.get(id ?? "");
    if (!buffer || (caller !== undefined && caller !== buffer.plugin))
      throw new CommandError("failed", `no buffer ${id} of ${caller}`);
    return buffers.update(buffer.id, {
      ...(name !== undefined ? { name } : {}),
      ...(modified !== undefined ? { modified } : {}),
    });
  });

  return {
    buffers,
    surfaceOpened: (plugin, title) => {
      if (!buffers.get(surfaceId(plugin)))
        buffers.add({ id: surfaceId(plugin), name: title, plugin, modified: false, surface: true });
    },
    surfaceClosed: (plugin) => {
      const gone = buffers.ofPlugin(plugin);
      for (const buffer of gone) buffers.remove(buffer.id);
      for (const buffer of gone) closed(buffer);
    },
    focused: (plugin) => {
      if (plugin === null) return;
      const mine = shown(buffers.ofPlugin(plugin)[0]);
      if (mine) buffers.touch(mine.id);
    },
    show,
    onClosed: (listener) => {
      closedListeners.add(listener);
      return () => closedListeners.delete(listener);
    },
    dispose: offs.dispose,
  };
}
