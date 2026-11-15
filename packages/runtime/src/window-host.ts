import type { WindowVisibility } from "./frames/install";
import type { SurfaceSpec } from "./surfaces";

/** The shell's window host places detached surfaces and reveals their windows on demand. */
export interface WindowHost extends WindowVisibility {
  adopt(spec: SurfaceSpec, section: HTMLElement): void;
  release(id: string): void;
  /** Reveal surface `id`'s window and put it in use; settles once the window manager said. */
  show?(id: string): undefined | Promise<unknown>;
}
