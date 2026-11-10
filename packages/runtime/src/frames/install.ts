/**
 * Hidden surfaces are unloaded and their state kept (ADR 0070), over the runtime's surfaces and
 * plugin host: which surfaces count (centre and floating ones, the windows), when one is visible (on
 * the page, shown, and not hidden by a window host's windows), the order they were focused in (the
 * live budget's, ADR 0134), the two settings, asking the plugin for its state and the placeholder
 * that stands in for the frame. Every surface's frame is also watched for answers (#39,
 * `watch.ts`); one the person stopped stays unloaded, in sight or not, until they reload it. A
 * plugin's reload waits for what its frame already sent, its last desk:state with it (`reload.ts`).
 */
import { LIVE_SURFACES } from "../core/defaults";
import type { DeskContext } from "../policies/context";
import type { Lang } from "../shell/copy";
import type { SurfaceSpec } from "../surfaces";
import { defineFrameCommands } from "./commands";
import { placeholder } from "./placeholder";
import { type FrameCounts, FramePolicy, type FrameTimers, realTimers } from "./policy";
import { frameReloads } from "./reload";
import { askState, SURFACE_STATE } from "./state";
import { type FrameResponses, watchFrames } from "./watch";

export { LIVE_SURFACES };
export const UNLOAD_AFTER = "desk.display.unload-after";
/** The defaults, in case desk.display's manifest is not installed: five minutes, 8 frames. */
const DEFAULTS = { [UNLOAD_AFTER]: 300, [LIVE_SURFACES]: 8 };
/**
 * How long a frame loading again for a plugin that still sleeps (no hello yet) is not put back to
 * sleep: what waits for its hello, and the state it is to be handed, would go with it.
 */
export const LOADING_MS = 10_000;

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
  /** Whether the plugin has no live frame until its next hello: unloaded, or loading again. */
  asleep?(id: string): boolean;
}

export interface FramesDeps {
  windows?: WindowVisibility;
  host(): FrameHost | undefined;
  timers?: FrameTimers;
  /** The language of the Not responding window and its commands (#39); Korean by default. */
  lang?: Lang;
}

export interface Frames {
  /** Content surfaces and hosted side windows may be unloaded when out of sight. */
  opened(spec: SurfaceSpec, windowed?: boolean): void;
  closed(id: string): void;
  /** Something that may show or hide surfaces happened: look again once it has settled. */
  changed(): void;
  /** The keys went to surface `id` (null: to none): it is the most recent now, and may wake. */
  focused(id: string | null): void;
  /** Load an unloaded frame again (the plugin host's `wake`); true when its frame is live after. */
  wake(id: string): boolean;
  /** Load `src` in a plugin's frame (a hot reload) once what the frame already sent has arrived. */
  reload(id: string, src: string): void;
  /** The windows' frames loaded in sight and out of it and asleep, and the budget in force. */
  counts(): FrameCounts & { budget: number };
  /** Whether each frame answers the desk, with Wait, Stop and Reload (#39). */
  readonly responses: FrameResponses;
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
  /** When each frame loaded again, for LOADING_MS. */
  const loaded = new Map<string, number>();
  /** The surfaces the unload policy counts: the windows. */
  const windowed = new Set<string>();
  /** A setting's value when it is a number of 0 or more, else desk.display's default. */
  const setting = (key: keyof typeof DEFAULTS) => {
    const value = settings.get<unknown>(key, DEFAULTS[key]);
    return typeof value === "number" && Number.isFinite(value) && value >= 0
      ? value
      : DEFAULTS[key];
  };
  const unload = async (id: string, still: () => boolean) => {
    const host = deps.host();
    // Loading again for what waits on it (a request, a command): it sleeps again once it answered.
    const since = loaded.get(id);
    if (since !== undefined && timers.now() - since < LOADING_MS && host?.asleep?.(id))
      return false;
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
    budget: () => Math.floor(setting(LIVE_SURFACES)),
    unload,
    remount: (id) => {
      loaded.set(id, timers.now());
      surfaces.remount(id);
    },
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
  const watch = watchFrames(ctx, {
    host: deps.host,
    timers,
    lang: deps.lang ?? "ko",
    title: (id) => specs.get(id)?.title ?? id,
    // A stopped frame is the person's to load again: the policy neither counts nor loads it.
    stopped: (id) => policy.untrack(id),
    reloaded: (id) => {
      if (windowed.has(id)) policy.track(id);
      changed();
    },
  });
  const responses: FrameResponses = {
    ...watch.responses,
    // Unloaded and not stopped: the live budget put it to sleep (desk.windows.list says so, #82).
    asleep: (id) => surfaces.unloaded(id) && watch.responses.state(id) !== "stopped",
  };
  offs.push(defineFrameCommands(ctx.hub.commands, responses, deps.lang ?? "ko"));
  const reloads = frameReloads({
    win,
    timers,
    // A frame that said hello and is on the page may still have a desk:state on its way.
    live: (id) => {
      const host = deps.host();
      return host?.greeted(id) && !host.asleep?.(id) ? surfaces.frame(id) : null;
    },
    load: (id, src) => surfaces.reload(id, src),
  });
  const frames: Frames = {
    opened(spec, inWindow) {
      specs.set(spec.id, spec);
      watch.track(spec.id);
      if (!inWindow && spec.placement !== "center" && spec.placement !== "floating") return;
      windowed.add(spec.id);
      policy.track(spec.id);
      changed();
    },
    closed(id) {
      specs.delete(id);
      loaded.delete(id);
      windowed.delete(id);
      reloads.forget(id);
      watch.untrack(id);
      policy.untrack(id);
      changed();
    },
    changed,
    focused(id) {
      if (id !== null) policy.focused(id);
      changed();
    },
    // A stopped frame loads only from its Reload: what waits on it waits for that.
    wake: (id) => watch.responses.state(id) !== "stopped" && policy.wake(id),
    reload: (id, src) => reloads.reload(id, src),
    counts: () => ({ ...policy.counts(), budget: Math.floor(setting(LIVE_SURFACES)) }),
    responses,
    dispose() {
      for (const off of offs) off?.();
      win.removeEventListener("resize", changed);
      reloads.dispose();
      watch.dispose();
      policy.dispose();
    },
  };
  return frames;
}
