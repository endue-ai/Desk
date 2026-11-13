/**
 * desk.windows.*: tile, cascade, spread and restore as the desk's own commands (ADR 0017, 0116), so
 * keys, the palette, the right-edge strip and Eris run the same thing. The window manager arranges
 * and keeps what each arrangement replaced (crates/desk-wm `Arranger`, #83); tile and cascade name
 * restore-arrangement as their undo: each is one step on the desk's undo stack (ADR 0077). The
 * spread is the compositor's to draw (#54, ADR 0161): its command asks the window manager's host,
 * and the window picked in it takes the focus through desk.windows.focus. desk.windows.close closes
 * a window of the desktop in front by id, asking about unsaved changes first: the shell runs it when
 * the person closes the OS window a plugin shows in (#234).
 */
import { CommandError } from "../commands";
import { type Ctx, edit, windowsOf } from "../shell/actions";
import { closeWindow, focusPane } from "../shell/windows";
import type { Arranged } from "../wm/types";
import { type ArrangeCopyKey, arrangeText } from "./copy";

export const TILE = "desk.windows.tile";
export const CASCADE = "desk.windows.cascade";
export const SPREAD = "desk.windows.spread";
export const FOCUS = "desk.windows.focus";
export const CLOSE = "desk.windows.close";
export const RESTORE = "desk.windows.restore-arrangement";

type Kind = Arranged["kind"];

const NO_ARGS = { type: "object", properties: {}, additionalProperties: false };
const WINDOW_ARGS = {
  type: "object",
  properties: { window: { type: "string", description: "The window, by id." } },
  required: ["window"],
  additionalProperties: false,
};
const KEPT = {
  type: "object",
  properties: {
    id: { type: "string" },
    x: { type: "number" },
    y: { type: "number" },
    w: { type: "number" },
    h: { type: "number" },
  },
  required: ["id", "x", "y", "w", "h"],
};
const ARRANGED = {
  type: "object",
  description: "What the arrangement replaced: undo hands it to desk.windows.restore-arrangement.",
  properties: {
    desktop: { type: "string", description: "The desktop arranged, by id." },
    entry: { type: "string" },
    kind: { type: "string", enum: ["tile", "cascade"] },
    windows: { type: "array", items: KEPT },
  },
  required: ["desktop", "entry", "kind", "windows"],
};
/**
 * Restore's args: none from the strip, keys, the palette or an agent; from cmd.undo, the
 * arrangement's own `{ args, result }` (ADR 0077). The core checks an undo's args against these
 * as it checks any invocation's, so they name both, or no tile or cascade could be undone (#163).
 */
const RESTORE_ARGS = {
  type: "object",
  properties: {
    args: { ...NO_ARGS, description: "The args the tile or cascade ran with: none." },
    result: {
      ...ARRANGED,
      description: "The arrangement to put back, as tile or cascade answered it.",
    },
  },
  additionalProperties: false,
};

/** Who may run what: the arranging commands with their schemas for agents (ADR 0088). */
const ARRANGE: Record<Kind, { id: string; title: ArrangeCopyKey; words: string[]; does: string }> =
  {
    tile: {
      id: TILE,
      title: "tile",
      words: ["tile", "grid", "arrange", "windows", "바둑판", "정렬", "창"],
      does: "Lay every normal window on the current desktop out in a grid that fills the screen.",
    },
    cascade: {
      id: CASCADE,
      title: "cascade",
      words: ["cascade", "stack", "overlap", "arrange", "windows", "계단식", "겹치기", "창"],
      does: "Stack every normal window on the current desktop diagonally from the top left, all the same size, the focused one on top.",
    },
  };

const isArranged = (value: unknown): value is Arranged =>
  typeof value === "object" && value !== null && typeof (value as Arranged).entry === "string";

/**
 * The desk's arranging commands. `keys(id)` gives the keyboard to window `id` once it is focused,
 * when it shows the shell's own view (a plugin's surface takes the keys itself).
 */
export function defineArrangeCommands(ctx: Ctx, keys?: (window: string) => void): () => void {
  const { commands } = ctx.runtime;
  const say = (key: ArrangeCopyKey) => arrangeText(ctx.store.get().lang, key);
  const offs = (Object.keys(ARRANGE) as Kind[]).map((kind) => {
    const spec = ARRANGE[kind];
    return commands.define(spec.id, {
      title: say(spec.title),
      keywords: spec.words,
      owner: "desk",
      undo: RESTORE,
      run: async (): Promise<Arranged> => {
        const [done] = await edit(ctx, { op: "arrange", kind, now: Math.round(ctx.wall()) });
        if (!isArranged(done)) throw new CommandError("failed", say("nothingToArrange"));
        return done;
      },
      agent: {
        description: `${spec.does} Floating and pinned windows stay where they are. One undoable step: desk.windows.restore-arrangement puts the windows back.`,
        args: NO_ARGS,
        result: ARRANGED,
      },
    });
  });
  offs.push(
    commands.define(RESTORE, {
      title: say("restore"),
      keywords: ["restore", "undo", "previous", "layout", "windows", "되돌리기", "이전", "배치"],
      owner: "desk",
      run: async (args) => {
        // cmd.undo hands the inverse { args, result } of the arrangement it undoes.
        const result = (args as { result?: unknown } | undefined)?.result;
        const named = isArranged(result);
        const [done] = await edit(ctx, {
          op: "restore-arrangement",
          ...(named ? { from: result } : {}),
        });
        if (done) return done;
        if (named) return { windows: 0 };
        throw new CommandError("failed", say("nothingToRestore"));
      },
      agent: {
        description:
          "Put the windows of the current desktop back where they were before the last tile or cascade. Takes no args; the desk's undo passes the arrangement it undoes.",
        args: RESTORE_ARGS,
      },
    }),
    commands.define(SPREAD, {
      title: say("spread"),
      keywords: ["spread", "expose", "overview", "mission control", "windows", "펼치기", "창"],
      owner: "desk",
      run: () => ctx.wm.run({ op: "spread" }),
      agent: {
        description:
          "Spread every window on the current desktop out so the person can pick one; running it again closes the spread.",
        args: NO_ARGS,
      },
    }),
    commands.define(FOCUS, {
      title: say("focus"),
      keywords: ["focus", "switch", "window", "go to", "창", "전환"],
      owner: "desk",
      run: async (args) => {
        const window = (args as { window?: unknown } | undefined)?.window;
        if (typeof window !== "string") throw new CommandError("failed", "say which: { window }");
        if (!windowsOf(ctx.store.get()).some((p) => p.id === window))
          throw new CommandError("failed", say("notHere"));
        // Wholly in sight first (the canvas pans when it has to), then the keys.
        await edit(ctx, { op: "reveal", id: window });
        await focusPane(ctx, window);
        if (!ctx.runtime.shortcuts.focused) keys?.(window);
        return { window };
      },
      agent: {
        description:
          "Bring a window of the current desktop wholly into sight, panning the canvas when it has to, and give it the keys: what picking a window in the spread does.",
        args: WINDOW_ARGS,
      },
    }),
    commands.define(CLOSE, {
      title: say("close"),
      keywords: ["close", "window", "닫기", "창"],
      owner: "desk",
      run: async (args) => {
        const window = (args as { window?: unknown } | undefined)?.window;
        if (typeof window !== "string") throw new CommandError("failed", "say which: { window }");
        const here = () => windowsOf(ctx.store.get()).some((p) => p.id === window);
        if (!here()) throw new CommandError("failed", say("notHere"));
        await closeWindow(ctx, window);
        // The person may keep a window whose unsaved changes they were asked about.
        return { window, closed: !here() };
      },
      agent: {
        description:
          "Close a window of the current desktop by id: the plugins it shows unmount for the session. Unsaved changes in them are asked about first, and the window stays when the person keeps them (closed: false).",
        args: WINDOW_ARGS,
      },
    }),
  );
  return () => {
    for (const off of offs) off();
  };
}
