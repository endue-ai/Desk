/**
 * desk.windows.*: tile, cascade and restore as the desk's own commands (ADR 0017, 0116), so keys,
 * the palette, the right-edge strip and Eris run the same thing. The window manager arranges and
 * keeps what each arrangement replaced (crates/desk-wm `Arranger`, #83); tile and cascade name
 * restore-arrangement as their undo: each is one step on the desk's undo stack (ADR 0077). The
 * spread waits for the compositor to draw it (#54).
 */
import { CommandError } from "../commands";
import { type Ctx, edit } from "../shell/actions";
import type { Arranged } from "../wm/types";
import { type ArrangeCopyKey, arrangeText } from "./copy";

export const TILE = "desk.windows.tile";
export const CASCADE = "desk.windows.cascade";
export const RESTORE = "desk.windows.restore-arrangement";

type Kind = Arranged["kind"];

const NO_ARGS = { type: "object", properties: {}, additionalProperties: false };
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

export function defineArrangeCommands(ctx: Ctx): () => void {
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
          "Put the windows of the current desktop back where they were before the last tile or cascade.",
        args: NO_ARGS,
      },
    }),
  );
  return () => {
    for (const off of offs) off();
  };
}
