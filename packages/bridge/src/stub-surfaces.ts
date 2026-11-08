/**
 * The stub's surfaces (ui.surface.*), as the core keeps them: handles per caller under `ui:surface`,
 * closed only by the caller that opened them.
 */
import { StubError, type StubHandlers } from "./adapters";
import type { CallerId, Permission, SurfacePlacement } from "./generated";

export interface StubSurface {
  handle: string;
  caller: CallerId;
  surface: string;
  placement?: SurfacePlacement;
  title?: string;
}

export type SurfaceServed = `ui.surface.${"open" | "close"}`;

const SURFACE: Permission = { permission: "ui:surface" };

interface Host {
  check(caller: string | undefined, scope: Permission): void;
  fresh(prefix: string): string;
  me(caller: string | undefined): string;
}

export function stubSurfaces(host: Host) {
  const surfaces = new Map<string, StubSurface>();
  const handlers: Required<Pick<StubHandlers, SurfaceServed>> = {
    "ui.surface.open": ({ surface, placement, title, scope }, caller) => {
      host.check(caller, scope ?? SURFACE);
      const handle = host.fresh("s");
      const shown = { ...(placement && { placement }), ...(title && { title }) };
      surfaces.set(handle, { handle, caller: host.me(caller), surface, ...shown });
      return { handle };
    },
    "ui.surface.close": ({ handle, scope }, caller) => {
      host.check(caller, scope ?? SURFACE);
      if (surfaces.get(handle)?.caller !== host.me(caller))
        throw new StubError("not_found", `${host.me(caller)}'s surface ${handle} does not exist`);
      surfaces.delete(handle);
      return {};
    },
  };
  return { surfaces, handlers };
}
