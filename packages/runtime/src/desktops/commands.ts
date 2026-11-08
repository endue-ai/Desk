/**
 * The desktops' commands under desk.shell (ADR 0117). `desktop-1` to `desktop-9` and
 * `move-to-desktop-1` to `-9` follow the list: one for each of its first nine desktops, so a key
 * whose desktop is not there passes on. The others take arguments, and ask when they lack them.
 */
import type { DesktopRef } from "../modes/types";
import { desktopId, desktopsOf } from "../shell/actions";
import type { ShellCtx } from "../shell/context";
import { focusedWindow } from "../shell/windows";
import {
  moveWindowTo,
  newDesktop,
  remove,
  rename,
  reorder,
  say,
  step,
  switchTo,
  tx,
  undo,
} from "./actions";
import { idAt } from "./model";
import { uiOf } from "./ui";

/** Define one desk.shell command; returns what removes it. */
export type Define = (
  id: string,
  title: string,
  keywords: string[],
  run: (args: unknown) => unknown,
) => () => void;

type Args = {
  desktop?: unknown;
  window?: unknown;
  name?: unknown;
  windows?: unknown;
  at?: unknown;
};
const argsOf = (args: unknown): Args => (args && typeof args === "object" ? (args as Args) : {});
const refOf = (value: unknown): DesktopRef | undefined =>
  typeof value === "string" || typeof value === "number" ? value : undefined;
const WORDS = ["desktop", "view", "데스크톱", "화면"];

/** A move asked with no window in use says so. */
function nothingInUse(ctx: ShellCtx): false {
  say(ctx, tx(ctx, "focusedNone"));
  return false;
}

/** Ask which desktop through the palette: an id, or undefined when the person cancelled. */
async function pick(ctx: ShellCtx, title: string): Promise<string | undefined> {
  const s = ctx.store.get();
  if (!ctx.runtime.commands.has("desk.palette.pick")) return undefined;
  const here = desktopId(s);
  const items = desktopsOf(s).map((d, i) => ({
    id: d.id,
    label: d.name,
    detail: `${i + 1}${d.id === here ? " · ✓" : ""}`,
  }));
  const answer = await ctx.runtime.commands
    .run("desk.palette.pick", { title, items, free: false, placeholder: "" })
    .catch(() => undefined);
  return typeof answer === "string" ? answer : undefined;
}

/** The commands that never change; the dialogs and the overview they open are the switcher's. */
export function defineDesktopCommands(ctx: ShellCtx, define: Define): () => void {
  const ui = () => uiOf(ctx.store);
  const target = (args: unknown) => refOf(argsOf(args).desktop) ?? ctx.store.get().desktop;
  const offs = [
    define("desktop-new", tx(ctx, "cmdNew"), [...WORDS, "new", "add", "새"], (args) => {
      const { name } = argsOf(args);
      return newDesktop(ctx, typeof name === "string" ? name : undefined);
    }),
    define("desktop-next", tx(ctx, "cmdNext"), [...WORDS, "next", "다음"], () => step(ctx, 1)),
    define("desktop-previous", tx(ctx, "cmdPrevious"), [...WORDS, "previous", "이전"], () =>
      step(ctx, -1),
    ),
    define("desktop-go", tx(ctx, "cmdGo"), [...WORDS, "go", "switch", "이동"], async (args) => {
      const ref = refOf(argsOf(args).desktop) ?? (await pick(ctx, tx(ctx, "pickDesktop")));
      if (ref !== undefined) switchTo(ctx, ref);
    }),
    define("desktop-rename", tx(ctx, "cmdRename"), [...WORDS, "rename", "name", "이름"], (args) => {
      const { name } = argsOf(args);
      const id = desktopId(ctx.store.get(), target(args));
      if (typeof name === "string") rename(ctx, id, name);
      else ui().rename(id);
    }),
    define(
      "desktop-remove",
      tx(ctx, "cmdRemove"),
      [...WORDS, "remove", "delete", "지우기"],
      (args) => {
        const { windows } = argsOf(args);
        const id = desktopId(ctx.store.get(), target(args));
        if (windows === "move" || windows === "close") return remove(ctx, id, windows);
        ui().remove(id);
      },
    ),
    define(
      "desktop-move-left",
      tx(ctx, "cmdMoveLeft"),
      [...WORDS, "reorder", "left", "왼쪽"],
      (args) => reorder(ctx, target(args), { by: -1 }),
    ),
    define(
      "desktop-move-right",
      tx(ctx, "cmdMoveRight"),
      [...WORDS, "reorder", "right", "오른쪽"],
      (args) => reorder(ctx, target(args), { by: 1 }),
    ),
    define("desktops-overview", tx(ctx, "cmdOverview"), [...WORDS, "overview", "all", "모두"], () =>
      ui().overview(),
    ),
    define("desktop-undo", tx(ctx, "cmdUndo"), [...WORDS, "undo", "되돌리기"], () => undo(ctx)),
    define(
      "move-to-desktop",
      tx(ctx, "cmdMoveWindow"),
      [...WORDS, "move", "window", "옮기기", "창"],
      async (args) => {
        const a = argsOf(args);
        const window = typeof a.window === "string" ? a.window : focusedWindow(ctx);
        if (!window) return nothingInUse(ctx);
        const ref = refOf(a.desktop) ?? (await pick(ctx, tx(ctx, "pickMove")));
        return ref !== undefined && moveWindowTo(ctx, window, ref);
      },
    ),
  ];
  return () => {
    for (const off of offs) off();
  };
}

/** `desktop-N` and `move-to-desktop-N` for the list's first nine desktops, defined again as it changes. */
export function defineNumbered(ctx: ShellCtx, define: Define): Array<() => void> {
  const s = ctx.store.get();
  return desktopsOf(s)
    .slice(0, 9)
    .flatMap((d, i) => {
      const n = i + 1;
      return [
        define(
          `desktop-${n}`,
          ctx.tr("cmdDesktop", { n: d.name }),
          [...WORDS, String(n), d.name],
          () => switchTo(ctx, n),
        ),
        define(
          `move-to-desktop-${n}`,
          tx(ctx, "cmdMoveWindowTo", { n: d.name }),
          [...WORDS, "move", "window", "옮기기", String(n), d.name],
          () => {
            const window = focusedWindow(ctx);
            const to = idAt(desktopsOf(ctx.store.get()), n);
            if (window === undefined) return nothingInUse(ctx);
            return to !== undefined && moveWindowTo(ctx, window, to);
          },
        ),
      ];
    });
}
