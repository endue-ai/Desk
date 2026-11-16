/**
 * desk.windows.find: the palette's Windows group (#304), a palette provider the desk defines
 * itself (`policies/palette.ts`). Every open window, those of the desktop in front first, then
 * those popped out of the canvas, then the other desktops' in order, found by its title, its
 * plugin's name or its desktop's name; each chooses desk.windows.focus, which brings its desktop
 * to the front first when it has to.
 */

import { windowTitle } from "../desktops/map";
import type { SurfacePlacement } from "../modes/types";
import { type Ctx, desktopsOf, windowsOf } from "../shell/actions";
import type { ShellCtx } from "../shell/context";
import { outWindows } from "../surface/placed";
import { FOCUS } from "./commands";
import { arrangeText } from "./copy";

export const FIND = "desk.windows.find";
/** As many results as a provider gives when the palette asks for no number (`providers.js`). */
const LIMIT = 5;

export interface WindowNames {
  /** What the window's title bar names. */
  title(p: SurfacePlacement): string;
  /** A plugin's name, by its id. */
  plugin(id: string): string;
}

interface Open {
  p: SurfacePlacement;
  /** The desktop's name; none for a window out of the canvas. */
  desktop?: string;
}

/** Every open window, the desktop in front's first, each once. */
function openWindows(ctx: Pick<Ctx, "store">): Open[] {
  const s = ctx.store.get();
  const here = s.wm.here;
  const list = desktopsOf(s);
  const ordered = [...list.filter((d) => d.id === here), ...list.filter((d) => d.id !== here)];
  const seen = new Set<string>();
  const all: Open[] = [];
  const add = (p: SurfacePlacement, desktop?: string) => {
    if (seen.has(p.id)) return;
    seen.add(p.id);
    all.push(desktop === undefined ? { p } : { p, desktop });
  };
  const [first, ...rest] = ordered;
  if (first) for (const p of windowsOf(s, first.id)) if (!p.out) add(p, first.name);
  for (const p of outWindows(s)) add(p);
  for (const d of rest) for (const p of windowsOf(s, d.id)) if (!p.out) add(p, d.name);
  return all;
}

function defaultNames(ctx: ShellCtx): WindowNames {
  return {
    title: (p) => windowTitle(ctx, ctx.store.get(), p),
    plugin: (id) => ctx.store.get().adopted.find((a) => a.id === id)?.title ?? id,
  };
}

export function defineFindWindows(ctx: Ctx, names?: WindowNames): () => void {
  const named = names ?? defaultNames(ctx as ShellCtx);
  return ctx.runtime.commands.define(FIND, {
    title: () => arrangeText(ctx.store.get().lang, "find"),
    keywords: ["windows", "find", "switch", "창", "찾기"],
    owner: "desk",
    run: (args) => {
      const { query, limit } = (args ?? {}) as { query?: unknown; limit?: unknown };
      const words = typeof query === "string" ? query.trim().toLowerCase().split(/\s+/) : [];
      const max = typeof limit === "number" && Number.isInteger(limit) && limit > 0 ? limit : LIMIT;
      if (words.join("") === "") return { results: [] };
      const lang = ctx.store.get().lang;
      const results = openWindows(ctx)
        .map(({ p, desktop }) => {
          const title = named.title(p);
          const plugin = named.plugin(p.plugin);
          const detail =
            desktop === undefined
              ? arrangeText(lang, "foundOut", { plugin })
              : arrangeText(lang, "foundOn", { plugin, desktop });
          const text = `${title} ${plugin} ${p.plugin} ${desktop ?? ""}`.toLowerCase();
          return { p, title, detail, text };
        })
        .filter(({ text }) => words.every((word) => text.includes(word)))
        .slice(0, Math.min(max, 50))
        .map(({ p, title, detail }) => ({
          id: p.id,
          title,
          detail,
          kind: "window",
          actions: [{ command: FOCUS, title: arrangeText(lang, "focus"), args: { window: p.id } }],
        }));
      return { results };
    },
    agent: {
      description:
        "The palette's Windows group: the open windows whose title, plugin or desktop holds every word of query, at most limit (5), as palette results whose action is desk.windows.focus.",
      args: {
        type: "object",
        properties: { query: { type: "string" }, limit: { type: "integer", minimum: 1 } },
        required: ["query"],
      },
      readOnly: true,
    },
  });
}
