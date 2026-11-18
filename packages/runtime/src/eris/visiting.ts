/**
 * The windows Eris looks at or uses while she answers (ADR 0271). A window is lit from the moment
 * she turns to it until she leaves it: softly while she only looks (`LOOK`), fully while a command
 * of its plugin runs (`USE`); with several reasons at once it takes the brightest. The store keeps
 * them (`erisWindows`) with how brightly each glows now, which rises and falls on the ticker in
 * tenths, so a fade is a few reports to the compositor, not one a frame. The compositor draws the
 * glow around the window's frame where it draws the window (apps/desk `compositor-desk.ts`); the
 * window's section is marked too (`errand.css`), which lights it on a desk whose page draws its
 * windows. With reduced motion nothing fades. A desk has one account of them (`visitingOf`): the
 * talk line's errands and a spoken turn's light the same windows.
 */
import { cubicBezier } from "../ease";
import type { ShellCtx } from "../shell/context";

/** How brightly a window she looks at glows, and one she uses. */
export const LOOK = 0.6;
export const USE = 1;
/** A window's glow comes up over this long, and goes over this long. */
export const GLOW_IN_MS = 240;
export const GLOW_OUT_MS = 480;
/** What marks an element Eris is at; a window's section also says how brightly (`--eris-glow`). */
export const VISITING = "is-eris-visiting";
const ease = cubicBezier(0.3, 0, 0.2, 1);

interface Lit {
  /** How brightly each reason to light it would. */
  reasons: Set<{ glow: number }>;
  /** How brightly it glows now. */
  glow: number;
  /** The fade under way; a later one takes its place. */
  fade: number;
}

export interface Visiting {
  /** She turns to `window`, lit `glow` bright; what it returns is her leaving it. */
  enter(window: string, glow?: number): () => void;
}

type Ctx = Pick<ShellCtx, "store" | "ticker" | "reduced" | "pages">;

const tenths = (glow: number) => Math.round(glow * 10) / 10;

/** Window `id`'s section where its DOM lies: its own page (ADR 0201), else the desk's. */
function sectionOf(ctx: Ctx, id: string): HTMLElement | null {
  if (typeof document === "undefined") return null;
  if (ctx.pages) return ctx.pages.section(id, document);
  const all = document.querySelectorAll<HTMLElement>(".surface[data-surface]");
  return [...all].find((el) => el.dataset.surface === id) ?? null;
}

export function mountVisiting(ctx: Ctx): Visiting {
  const lit = new Map<string, Lit>();
  let marked: HTMLElement[] = [];
  let fades = 0;
  const publish = () => {
    const erisWindows = [...lit]
      .map(([id, w]) => ({ id, glow: tenths(w.glow) }))
      .filter((w) => w.glow > 0);
    if (JSON.stringify(erisWindows) === JSON.stringify(ctx.store.get().erisWindows)) return;
    ctx.store.set({ erisWindows });
    const sections: HTMLElement[] = [];
    for (const { id, glow } of erisWindows) {
      const el = sectionOf(ctx, id);
      if (!el) continue;
      el.classList.add(VISITING);
      el.style.setProperty("--eris-glow", String(glow));
      sections.push(el);
    }
    for (const el of marked) {
      if (sections.includes(el)) continue;
      el.classList.remove(VISITING);
      el.style.removeProperty("--eris-glow");
    }
    marked = sections;
  };
  /** Fade `id` to the brightest of its reasons, or out and away when it has none left. */
  const fade = (id: string) => {
    const w = lit.get(id);
    if (!w) return;
    const fading = ++fades;
    w.fade = fading;
    const from = w.glow;
    const to = Math.max(0, ...[...w.reasons].map((r) => r.glow));
    const ms = ctx.reduced() ? 0 : to > from ? GLOW_IN_MS : GLOW_OUT_MS;
    void ctx.ticker
      .animate(ms, ease, (t) => {
        if (lit.get(id) !== w || w.fade !== fading) return;
        w.glow = from + (to - from) * t;
        publish();
      })
      .then(() => {
        if (lit.get(id) !== w || w.fade !== fading || w.reasons.size > 0) return;
        lit.delete(id);
        publish();
      });
  };
  return {
    enter(window, glow = USE) {
      const reason = { glow };
      const w = lit.get(window) ?? { reasons: new Set(), glow: 0, fade: 0 };
      lit.set(window, w);
      w.reasons.add(reason);
      fade(window);
      return () => {
        if (w.reasons.delete(reason)) fade(window);
      };
    },
  };
}

const desks = new WeakMap<object, Visiting>();

/** The one account of them on `ctx`'s desk. */
export function visitingOf(ctx: Ctx): Visiting {
  let visiting = desks.get(ctx.store);
  if (!visiting) {
    visiting = mountVisiting(ctx);
    desks.set(ctx.store, visiting);
  }
  return visiting;
}
