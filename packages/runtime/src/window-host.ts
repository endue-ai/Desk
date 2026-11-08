import type { WindowVisibility } from "./frames/install";
import type { SurfaceSpec } from "./surfaces";

/** The shell's window host places detached surfaces and reveals their windows on demand. */
export interface WindowHost extends WindowVisibility {
  adopt(spec: SurfaceSpec, section: HTMLElement): void;
  release(id: string): void;
  show?(id: string): void;
}
