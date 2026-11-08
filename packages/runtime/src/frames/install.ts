/**
 * Hidden surfaces are unloaded and their state kept (desk.display, ADR 0070), over the runtime's
 * surfaces and plugin host: which surfaces count (centre and floating ones, the windows), when one
 * is visible (on the page, shown, and not hidden by a window host's windows), the two settings,
 * asking the plugin for its state and the placeholder that stands in for the frame.
 */
import type { DeskContext } from "../policies/context";
import type { SurfaceSpec } from "../surfaces";
import { placeholder } from "./placeholder";
import { FramePolicy, type FrameTimers, realTimers } from "./policy";
import { askState, SURFACE_STATE } from "./state";

export const UNLOAD_AFTER = "desk.display.unload-after";
export const LIVE_SURFACES = "desk.display.live-surfaces";
/** desk.display's defaults, in case its manifest is not installed: five minutes, 24 frames. */
const DEFAULTS = { [UNLOAD_AFTER]: 300, [LIVE_SURFACES]: 24 };

/** What a window host tells the runtime about the surfaces it holds (the shell's windows). */
export interface WindowVisibility {
  /** Whether its windows hide surface `id`: wholly covered by windows above, or off screen. */
  covered?(id: string): boolean;
  /** Hear changes that may show or hide surfaces; returns a function that stops. */
  onChange?(listener: () => void): () => void;
}

/** What unloading needs from the plugin host. */
export interface FrameHost {
  greeted(id: string): boolean;
  busy(id: string, except?: string): boolean;
  request(id: string, name: string, args?: unknown): Promise<unknown>;
  unloaded(id: string, state: unknown): void;
}

export interface FramesDeps {
  windows?: WindowVisibility;
  host(): FrameHost | undefined;
  timers?: FrameTimers;
}

export interface Frames {
  /** Content surfaces and hosted side windows may be unloaded when out of sight. */
  opened(spec: SurfaceSpec, windowed?: boolean): void;
  closed(id: string): void;
  /** Something that may show or hide surfaces happened: look again once it has settled. */
  changed(): void;
  /** Load an unloaded frame again (the plugin host's `wake`); true when it was unloaded. */
  wake(id: string): boolean;
  dispose(): void;
}

export function installFrames(
  ctx: Pick<DeskContext, "surfaces" | "hub" | "win" | "shortcuts">,
  deps: FramesDeps,
): Frames {
  const { surfaces, win, shortcuts } = ctx;
  const { settings } = ctx.hub;
  const { windows } = deps;
  const timers = deps.timers ?? realTimers;
  const specs = new Map<string, SurfaceSpec>();
  /** A setting's value when it is a number of 0 or more, else desk.display's default. */
  const setting = (key: keyof typeof DEFAULTS) => {
    const value = settings.get<unknown>(key, DEFAULTS[key]);
    return typeof value === "number" && Number.isFinite(value) && value >= 0
      ? value
      : DEFAULTS[key];
  };
  const unload = async (id: string, still: () => boolean) => {
    const host = deps.host();
    const spec = specs.get(id);
    const params = { surface: spec?.surface ?? "main" };
    const ask = (p: typeof params) => host?.request(id, SURFACE_STATE, p) ?? Promise.resolve();
    const kept = host?.greeted(id) ? await askState(ask, params, timers) : undefined;
    // Shown again meanwhile, or the desk waits on another answer from it: keep it for now.
    if (!still() || host?.busy(id, SURFACE_STATE)) return false;
    const doc = surfaces.get(id)?.ownerDocument;
    // Pressed, it loads with the focus: the surface takes it first, so the frame gets it.
    const use = () => {
      surfaces.get(id)?.focus();
      frames.wake(id);
    };
    const stand = doc && placeholder(doc, spec?.title ?? id, use);
    if (!stand || !surfaces.unload(id, stand)) return false;
    host?.unloaded(id, kept);
    return true;
  };
  const policy = new FramePolicy({
    visible: (id) => surfaces.visible(id) && !windows?.covered?.(id),
    // The surface the keys go to is never unloaded.
    focused: () => shortcuts.focused,
    afterMs: () => setting(UNLOAD_AFTER) * 1000,
    limit: () => Math.floor(setting(LIVE_SURFACES)),
    unload,
    remount: (id) => void surfaces.remount(id),
    timers,
  });
  // Changes come in bursts (a window drawn, then focused): one look once they have settled.
  let queued = false;
  const changed = () => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      policy.check();
    });
  };
  const offs = [
    surfaces.onChange(changed),
    settings.onChange((keys) => {
      if (keys.includes(UNLOAD_AFTER) || keys.includes(LIVE_SURFACES)) changed();
    }),
    windows?.onChange?.(changed),
  ];
  win.addEventListener("resize", changed);
  const frames: Frames = {
    opened(spec, windowed) {
      if (!windowed && spec.placement !== "center" && spec.placement !== "floating") return;
      specs.set(spec.id, spec);
      policy.track(spec.id);
      changed();
    },
    closed(id) {
      specs.delete(id);
      policy.untrack(id);
      changed();
    },
    changed,
    wake: (id) => policy.wake(id),
    dispose() {
      for (const off of offs) off?.();
      win.removeEventListener("resize", changed);
      policy.dispose();
    },
  };
  return frames;
}
