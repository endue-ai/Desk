/**
 * Window pages (ADR 0201): each window's own document, which a texture of its own draws. The desk's
 * page opens one per window it lays out, a same-origin popup named `desk-window:<window id>`; the
 * CEF shell renders it off screen and the compositor draws it over the window's frame, so a window
 * moves without a repaint and shares no texture with another window or with the desk's page. The
 * runtime's one script and state build the window's section there, as they did in the page: the
 * popup holds a copy of the page's root (its classes, its theme's tokens), its style sheets and the
 * windows' layer's ancestors, each kept in step with the page's, and the section at its top left.
 * Where no popup opens (the runtime's tests, fixture pages, a browser) the section stays in the page.
 */

/** The popup name a window's page opens under: this, then the window's id (`web_host/window_pages.rs`). */
export const PAGE_NAME = "desk-window:";

/** Opens the page named `name` at `w` × `h` CSS pixels: `window.open` in the app. */
export type Opener = (name: string, w: number, h: number) => Window | null;

export interface WindowPages {
  /**
   * Where window `id`'s section goes, its window `w` × `h`: the windows' layer of its own page, or
   * `null` for the page's own layer (no page opens here).
   */
  host(id: string, w: number, h: number): HTMLElement | null;
  /** Window `id` is gone: its page closes. */
  close(id: string): void;
  /** The ids of the windows whose page is open. */
  open(): string[];
  /**
   * Run `hook` on every page open now and every page that opens from now on (its window's id and
   * the page's `Window`); what it returns runs when that page closes, by `close` or under its
   * window (its document unloaded: the shell replaced it). The stop of the watch.
   */
  watch(hook: (id: string, win: Window) => () => void): () => void;
  /** Every page closes. */
  dispose(): void;
}

/** The page's `open`, as the app opens a window's page. */
export const popupOpener =
  (scope: Window): Opener =>
  (name, w, h) =>
    scope.open(
      "",
      name,
      `popup,width=${Math.max(1, Math.round(w))},height=${Math.max(1, Math.round(h))}`,
    );

interface Page {
  win: Window;
  layer: HTMLElement;
  off: () => void;
  /** What each watch's hook returned for it. */
  watched: Map<object, () => void>;
}

type Hook = (id: string, win: Window) => () => void;

/** Copy `from`'s attributes onto `to`, now and whenever they change; the stop. */
function mirror(from: Element, to: Element): () => void {
  const copy = () => {
    for (const name of to.getAttributeNames()) {
      if (!from.hasAttribute(name)) to.removeAttribute(name);
    }
    for (const name of from.getAttributeNames()) {
      const value = from.getAttribute(name) ?? "";
      if (to.getAttribute(name) !== value) to.setAttribute(name, value);
    }
  };
  copy();
  const Observer = from.ownerDocument.defaultView?.MutationObserver;
  if (!Observer) return () => {};
  const watch = new Observer(copy);
  watch.observe(from, { attributes: true });
  return () => watch.disconnect();
}

/** Whether `node` carries style: a style sheet's link or a style element. */
function styles(node: Node): node is HTMLElement {
  if (node.nodeType !== 1) return false;
  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  return (
    tag === "style" || (tag === "link" && /\bstylesheet\b/i.test(el.getAttribute("rel") ?? ""))
  );
}

/** Keep `to` holding a copy of each style sheet `from` holds, in order; the stop. */
function mirrorStyles(from: HTMLHeadElement, to: HTMLHeadElement): () => void {
  const copies = new Map<Node, HTMLElement>();
  const sync = () => {
    const wanted = [...from.childNodes].filter(styles);
    for (const [source, copy] of copies) {
      if (!wanted.includes(source as HTMLElement)) {
        copy.remove();
        copies.delete(source);
      }
    }
    for (const source of wanted) {
      let copy = copies.get(source);
      if (!copy) {
        copy = to.ownerDocument.createElement(source.tagName.toLowerCase());
        for (const name of source.getAttributeNames())
          copy.setAttribute(name, source.getAttribute(name) ?? "");
        copies.set(source, copy);
      }
      if (copy.tagName.toLowerCase() === "style" && copy.textContent !== source.textContent)
        copy.textContent = source.textContent;
      // Only a new one goes in: a sheet moved in its document would load again.
      if (copy.parentNode !== to) to.append(copy);
    }
  };
  sync();
  const Observer = from.ownerDocument.defaultView?.MutationObserver;
  if (!Observer) return () => {};
  const watch = new Observer(sync);
  watch.observe(from, { childList: true, subtree: true, characterData: true });
  return () => watch.disconnect();
}

/**
 * Window `name`'s page fresh from its opener: the page's root, body and style sheets copied in, and
 * the windows' layer under copies of its ancestors (its base URL and its security policy are its
 * opener's, as a blank popup's are). The layer copy, and the stop of the mirrors. Its title is its
 * name, so DevTools and the app e2e tell the pages apart.
 */
function furnish(win: Window, name: string, page: Document, layer: HTMLElement): Page {
  const doc = win.document;
  const offs = [mirror(page.documentElement, doc.documentElement)];
  if (page.body) offs.push(mirror(page.body, doc.body));
  const title = doc.createElement("title");
  title.textContent = name;
  doc.head.replaceChildren(title);
  offs.push(mirrorStyles(page.head, doc.head));
  const chain: HTMLElement[] = [];
  for (let el: HTMLElement | null = layer; el && el !== page.body; el = el.parentElement) {
    chain.unshift(el);
  }
  let parent: HTMLElement = doc.body;
  parent.replaceChildren();
  for (const el of chain) {
    const copy = doc.createElement(el.tagName.toLowerCase());
    offs.push(mirror(el, copy));
    parent.append(copy);
    parent = copy;
  }
  return {
    win,
    layer: parent,
    off: () => {
      for (const off of offs) off();
    },
    watched: new Map(),
  };
}

/**
 * The pages of the windows laid out in `layer` of `page`, each opened by `open`; `spacing` ms apart
 * when given, else at once.
 */
export function windowPages(
  page: Document,
  layer: HTMLElement,
  open: Opener,
  { spacing = 0 }: { spacing?: number } = {},
): WindowPages {
  const pages = new Map<string, Page>();
  const hooks = new Set<Hook>();
  // A window whose page cannot open (no popup here) stays in the page, and is not asked for again.
  const refused = new Set<string>();
  const hook = (id: string, at: Page, run: Hook) => {
    if (!at.watched.has(run)) at.watched.set(run, run(id, at.win));
  };
  const close = (id: string) => {
    const at = pages.get(id);
    if (!at) return;
    pages.delete(id);
    for (const off of at.watched.values()) off();
    at.off();
    if (!at.win.closed) at.win.close();
  };
  // One focus on the desk, as when one page held every window: the page the focus enters takes it
  // from the others, so no two fields show a caret and the keys' place is never in doubt.
  const takes = (from: Document) => () => {
    for (const doc of [page, ...[...pages.values()].map((p) => p.win.document)]) {
      if (doc === from) continue;
      const active = doc.activeElement as HTMLElement | null;
      if (active && active !== doc.body && active !== doc.documentElement) active.blur?.();
    }
  };
  const fromPage = takes(page);
  page.defaultView?.addEventListener("focusin", fromPage, true);
  /** Open window `id`'s page now; its layer, or null where none opens. */
  const openNow = (id: string, w: number, h: number): HTMLElement | null => {
    let win: Window | null = null;
    try {
      win = open(PAGE_NAME + id, w, h);
    } catch {
      win = null;
    }
    if (!win?.document) {
      refused.add(id);
      return null;
    }
    const made = furnish(win, PAGE_NAME + id, page, layer);
    const fromHere = takes(win.document);
    win.addEventListener("focusin", fromHere, true);
    // A page that goes under its window (the shell closed it for one that paints, a load) is
    // closed here too: the watches give the window back to the page, whose next draw opens anew.
    const gone = () => {
      if (pages.get(id) === made) close(id);
    };
    win.addEventListener("pagehide", gone);
    const furnished = made.off;
    made.off = () => {
      win.removeEventListener("focusin", fromHere, true);
      win.removeEventListener("pagehide", gone);
      furnished();
    };
    pages.set(id, made);
    for (const run of hooks) hook(id, made, run);
    return made.layer;
  };
  // Spaced, the pages open one at a time: a desk that starts with many windows opens no burst of
  // browsers over its plugins' first frames (a burst stopped the window in use's page, #157). A
  // window waits in the page meanwhile; the watches hear its page open.
  const waiting = new Map<string, [number, number]>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const drain = () => {
    timer = undefined;
    const next = waiting.entries().next();
    if (next.done) return;
    const [id, [w, h]] = next.value;
    waiting.delete(id);
    openNow(id, w, h);
    if (waiting.size) timer = setTimeout(drain, spacing);
  };
  return {
    host(id, w, h) {
      const at = pages.get(id);
      if (at && !at.win.closed) return at.layer;
      if (at) close(id);
      if (refused.has(id)) return null;
      if (!spacing) return openNow(id, w, h);
      waiting.set(id, [w, h]);
      if (timer === undefined) timer = setTimeout(drain, 0);
      return null;
    },
    close(id) {
      waiting.delete(id);
      close(id);
    },
    open: () => [...pages.keys()],
    watch(run) {
      hooks.add(run);
      for (const [id, at] of pages) hook(id, at, run);
      return () => {
        hooks.delete(run);
        for (const at of pages.values()) {
          at.watched.get(run)?.();
          at.watched.delete(run);
        }
      };
    },
    dispose() {
      if (timer !== undefined) clearTimeout(timer);
      waiting.clear();
      page.defaultView?.removeEventListener("focusin", fromPage, true);
      for (const id of [...pages.keys()]) close(id);
    },
  };
}
