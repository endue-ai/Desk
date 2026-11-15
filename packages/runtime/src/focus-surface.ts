/**
 * Giving a plugin surface the focus, two ways (ADR 0230). `focus` is the desk asking: a command,
 * a key or a plugin wants surface `id` in use, so its window is asked for (the window manager
 * decides, and answers once the desk it made is in) and its place takes the page's focus. `follow`
 * is the desk following what the window manager has in use, after a move the runtime asked for
 * or one the window manager decided unasked (a press it heard, a close, an agent's call): the
 * page's focus goes along without asking for anything, so a desk that arrives late can never ask
 * the window manager back to where it was.
 */
import type { ShortcutRouter } from "./input";
import type { SurfaceHost } from "./surfaces";

export interface SurfaceFocusDeps {
  root: HTMLElement;
  shortcuts: ShortcutRouter;
  surfaces: SurfaceHost;
  /** Ask the window host for surface `id`'s window; settles once the window manager said. */
  show(id: string): undefined | Promise<unknown>;
  /** The focus order moved (which frames stay live, ADR 0134). */
  moved(id: string | null): void;
}

export interface SurfaceFocus {
  focus(id: string | null): undefined | Promise<unknown>;
  /**
   * `told`: the window manager decided it unasked (a press it heard, a close, an agent's call),
   * so an overlay with the page's focus keeps it, and a field of the page's own lets it go.
   */
  follow(id: string | null, told?: boolean): void;
}

export function surfaceFocus(deps: SurfaceFocusDeps): SurfaceFocus {
  const { root, shortcuts, surfaces } = deps;
  return {
    focus(id) {
      shortcuts.focus(id);
      deps.moved(id);
      if (!id) return undefined;
      const shown = deps.show(id);
      surfaces.focus(id);
      return shown;
    },
    follow(id, told = false) {
      const doc = root.ownerDocument;
      const active = doc.activeElement;
      // An overlay with the page's focus keeps it (a question stays asked): the window in use
      // changed under it, and the keys go there once it hides.
      if (told && active?.closest(".desk-surface--overlay:not([hidden])")) return;
      shortcuts.focus(id);
      deps.moved(id);
      if (id) surfaces.focus(id);
      // A pane the page draws is in use: a field of the page's own outside every window (the
      // talk line) lets the focus go, as it would to a plugin's place.
      else if (told && active instanceof HTMLElement && active !== doc.body) {
        if (!active.closest(".surface")) active.blur();
      }
    },
  };
}
