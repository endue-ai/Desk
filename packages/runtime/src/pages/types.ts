/**
 * How the desk reaches the page of each plugin surface it shows (ADR 0160). In the app every
 * surface's page is a browser of its own that the compositor draws, and the shell carries its
 * messages (`remote.ts`); the section the runtime keeps for it holds only the surface's place. A desk
 * without the compositor (the runtime's tests, its fixture pages, the dev page) shows each page in a
 * sandboxed frame of its own page instead (`frames.ts`), as desk-wm runs as WebAssembly there.
 */
import type { SurfaceSpec } from "../surfaces";

export interface SurfacePages {
  /**
   * The element a new surface's section shows its page in, loading `spec.src`; `returning`: a saved
   * session puts the surface back, so its page may not take the desk's focus while it loads.
   */
  make(spec: SurfaceSpec, doc: Document, returning: boolean): HTMLElement;
  /** Load `src` in surface `id`'s `view` again (a new revision); `view` may be away (unloaded). */
  load(id: string, view: HTMLElement, src: string): void;
  /**
   * The window the desk posts surface `id`'s messages to and hears them from (the plugin host tells
   * plugins apart by it, ADR 0012); null while it has none (unloaded, or a frame out of the page).
   */
  port(id: string, view: HTMLElement): Window | null;
  /** `view` is back in its section after an unload and loads again; `focused`: its surface has the focus. */
  back(id: string, view: HTMLElement, focused: boolean): void;
  /** `view` was taken out of its section (ADR 0070): its page goes until it is back. */
  away(id: string, view: HTMLElement): void;
  /** A focusin in surface `id`'s section: true when the focus was put back where it was. */
  focusin(id: string, event: FocusEvent, section: HTMLElement): boolean;
  /** The desk gave surface `id`'s section the focus. */
  focused(id: string, section: HTMLElement): void;
  /** Surface `id` is gone. */
  close(id: string): void;
}
