// Where each window's DOM lies (ADR 0201): its section is in a page of its own where one opens,
// else in the desk's page. What reads a window's DOM or hears its events (the window menu, a drop
// on the desktop switcher, the keys given to a window, Eris's sparks) looks in both, and a point in
// a window's own page is the window's: its section lies at the page's top left, so the point is at
// the window's place on the desk plus the point.
import type { Rect } from "../wm/types";
import type { WindowPages } from "./window-pages";

type Run = (id: string, win: Window) => (() => void) | undefined;

export interface WindowDocs {
  /**
   * Run `run` on each window's own page (its window's id, its window) open now and on each that
   * opens later; what it returns runs as that page closes, and every one when the watch stops.
   */
  watch(run: Run): () => void;
  /** Window `id`'s section where it lies: in its own page, else in `fallback` (the desk's page). */
  section(id: string, fallback: ParentNode): HTMLElement | null;
  /** The window whose own page `doc` is, if it is one. */
  windowOf(doc: Document | null | undefined): string | undefined;
  /** The windows' own pages open now: each window's id and its page's document. */
  each(): Array<[string, Document]>;
  /** A point in window `id`'s own page, in the desk's page's CSS pixels. */
  toDesk(id: string, at: { x: number; y: number }): { x: number; y: number };
  /** The windows' own pages, once the windows' layer has them (`mountSurfaces`). */
  attach(pages: WindowPages): () => void;
}

/** Window `id`'s section among `root`'s. */
function sectionIn(root: ParentNode, id: string): HTMLElement | null {
  const all = root.querySelectorAll<HTMLElement>(".surface[data-surface]");
  return [...all].find((el) => el.dataset.surface === id) ?? null;
}

/** The windows' documents, each window's place on the desk read from `rectOf`. */
export function windowDocs(rectOf: (id: string) => Rect | undefined): WindowDocs {
  let pages: WindowPages | undefined;
  const open = new Map<string, Window>();
  const runs = new Map<Run, (() => void) | undefined>();
  const start = (run: Run) =>
    pages?.watch((id, win) => {
      const stop = run(id, win);
      return () => stop?.();
    });
  return {
    watch(run) {
      runs.set(run, start(run));
      return () => {
        runs.get(run)?.();
        runs.delete(run);
      };
    },
    section(id, fallback) {
      const own = open.get(id)?.document;
      return (own && sectionIn(own, id)) ?? sectionIn(fallback, id);
    },
    windowOf(doc) {
      if (!doc) return undefined;
      for (const [id, win] of open) if (win.document === doc) return id;
      return undefined;
    },
    each: () => [...open].map(([id, win]) => [id, win.document]),
    toDesk(id, at) {
      const rect = rectOf(id);
      return rect ? { x: rect.x + at.x, y: rect.y + at.y } : at;
    },
    attach(attached) {
      pages = attached;
      const offOpen = attached.watch((id, win) => {
        open.set(id, win);
        return () => {
          if (open.get(id) === win) open.delete(id);
        };
      });
      for (const run of runs.keys()) runs.set(run, start(run));
      return () => {
        for (const [run, stop] of runs) {
          stop?.();
          runs.set(run, undefined);
        }
        offOpen();
        open.clear();
        pages = undefined;
      };
    },
  };
}
