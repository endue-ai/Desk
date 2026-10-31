/**
 * desk.buffers (buffer.el, ibuffer): the buffer list and its commands. Switching shows a buffer's
 * surface; closing one with unsaved changes asks first; after a close the previous buffer shows.
 * Plugins open, rename and mark their own buffers with desk.buffers.open and desk.buffers.update.
 */
import { type Buffer, Buffers } from "../buffers";
import { CommandError } from "../commands";
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

/** What the person picks when closing a buffer with unsaved changes. */
const CLOSE_CHOICES = [
  { id: "save", label: "Save, then close" },
  { id: "discard", label: "Close without saving" },
  { id: "cancel", label: "Keep it open" },
];

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

  const show = async (id: string) => {
    const buffer = buffers.get(id);
    if (!buffer) throw new CommandError("failed", `no buffer ${id}`);
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

  /** Close a buffer, asking first when it has unsaved changes and the person closes it. */
  const close = async (buffer: Buffer, ask: boolean): Promise<boolean> => {
    if (ask && buffer.modified && settings.get("desk.buffers.confirm-unsaved", true)) {
      const choice = await pick(`${buffer.name} has unsaved changes`, CLOSE_CHOICES);
      if (choice === undefined || choice === "cancel") return false;
      if (choice === "save") await commands.run("desk.files.save", { buffer: buffer.id });
    }
    buffers.remove(buffer.id);
    if (buffer.surface) ctx.unmount(buffer.plugin);
    else {
      await ctx
        .request(buffer.plugin, "desk.buffers.closed", { buffer: buffer.id })
        .catch(() => {});
    }
    closed(buffer);
    const next = buffers.current();
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
  ) =>
    offs.add(
      commands.define(id, {
        title,
        keywords: ["buffers", ...keywords],
        owner: "desk.buffers",
        run: (args, from) => run(args, from.caller),
      }),
    );
  const idOf = (args: unknown) => (args as { id?: string; buffer?: string } | undefined)?.id;

  define("desk.buffers.list", "List open buffers", () => buffers.list(), ["ibuffer"]);
  define(
    "desk.buffers.switch",
    "Switch to a buffer",
    async (args) => {
      const id =
        idOf(args) ??
        (await pick(
          "Switch to a buffer",
          buffers.list().map((b) => ({ id: b.id, label: label(b), detail: b.path ?? b.plugin })),
        ));
      if (id) await show(id);
      return id ?? null;
    },
    ["switch-to-buffer"],
  );
  for (const [id, title, step] of [
    ["desk.buffers.next", "Next buffer", 1],
    ["desk.buffers.previous", "Previous buffer", -1],
  ] as const) {
    define(id, title, async () => {
      const next = buffers.step(buffers.current()?.id, step);
      if (next) await show(next.id);
      return next?.id ?? null;
    });
  }
  define(
    "desk.buffers.close",
    "Close the buffer",
    async (args, caller) => {
      const buffer = buffers.get(idOf(args) ?? buffers.current()?.id ?? "");
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
      const mine = buffers.ofPlugin(plugin)[0];
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
