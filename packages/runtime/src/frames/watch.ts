/**
 * Not responding (#39, #32 §9): the responsiveness model on the runtime's surfaces. Pings go straight
 * to each live frame and pongs come back on the desk's window. A late frame's surface shows "Not
 * responding" with Wait and Stop (`surface/not-responding.ts`); Stop unloads the frame as the unload
 * policy does (ADR 0070) but asks it for nothing, and its placeholder offers Reload, which loads it
 * again: the plugin's next init brings back its last desk:state. The section says its state in
 * `data-responding` once its frame is watched. Agents read and act through `responses`.
 */
import type { DeskContext } from "../policies/context";
import type { Lang } from "../shell/copy";
import { showNotResponding } from "../surface/not-responding";
import { type FramesCopyKey, framesText } from "./copy";
import { stoppedPlaceholder } from "./placeholder";
import type { FrameTimers } from "./policy";
import { CrashRecovery } from "./recovery";
import { type Response, type Responsiveness, ResponsivenessModel } from "./responsiveness";

/** Whether plugin frames answer the desk, and the person's actions on those that do not. */
export interface FrameResponses {
  /** How surface `id`'s frame answers the desk; undefined for a surface the desk does not watch. */
  state(id: string): Responsiveness | undefined;
  /**
   * Whether surface `id`'s frame sleeps: unloaded by the live budget, its state kept, until it is
   * in sight or in use again (ADR 0070, ADR 0134). A stopped frame is unloaded too, but `state`
   * says so. The frames installer answers it (`install.ts`); the watch alone does not know.
   */
  asleep(id: string): boolean;
  /** Wait on a late frame: its window stops asking for 10 s. False when it is not late. */
  wait(id: string): boolean;
  /** Stop a late frame: it is unloaded and its window offers Reload. False when it is not late. */
  stop(id: string): boolean;
  /** Load a stopped frame again, with its last desk:state. False when it is not stopped. */
  reload(id: string): boolean;
  /**
   * Its renderer died (#44; the CEF shell says so): the window loads again by itself with its last
   * desk:state, or after a second death within a minute stays stopped with Reload for this run.
   * False for a surface the desk does not watch, or one already stopped.
   */
  crashed(id: string): boolean;
  /**
   * Hear every change of a surface's response, with its state: late, stopped, responding again, and
   * a frame watched from its first answer (still responding). Returns a function that stops.
   */
  onChange(listener: (id: string, state: Responsiveness) => void): () => void;
}

export interface WatchDeps {
  host(): { greeted(id: string): boolean; unloaded(id: string, state: unknown): void } | undefined;
  timers: FrameTimers;
  lang: Lang;
  title(id: string): string;
  /** Surface `id`'s frame was stopped: the unload policy leaves it be until it loads again. */
  stopped(id: string): void;
  /** A stopped frame is loading again. */
  reloaded(id: string): void;
}

export interface FrameWatch {
  readonly responses: Omit<FrameResponses, "asleep">;
  track(id: string): void;
  untrack(id: string): void;
  dispose(): void;
}

export function watchFrames(
  ctx: Pick<DeskContext, "surfaces" | "win">,
  deps: WatchDeps,
): FrameWatch {
  const { surfaces, win } = ctx;
  const say = (key: FramesCopyKey, vars?: Record<string, string>) =>
    framesText(deps.lang, key, vars);
  const listeners = new Set<(id: string, state: Responsiveness) => void>();
  const model = new ResponsivenessModel({
    timers: deps.timers,
    live: (id) => surfaces.frame(id) !== null && deps.host()?.greeted(id) === true,
    ping: (id, n) => surfaces.frame(id)?.postMessage({ type: "desk:ping", n }, "*"),
  });
  /** Whether the keys are in a surface: its frame, or the question over it. */
  const focusedIn = (section: HTMLElement) => section.contains(section.ownerDocument.activeElement);

  const stop = (id: string) => {
    const section = surfaces.get(id);
    if (!section) return false;
    const focused = focusedIn(section);
    if (!model.stop(id)) return false;
    deps.stopped(id);
    const text = { title: deps.title(id), line: say("stoppedLine"), reload: say("reload") };
    const stand = stoppedPlaceholder(section.ownerDocument, text, () => reload(id));
    surfaces.unload(id, stand);
    deps.host()?.unloaded(id, undefined);
    if (focused) stand.querySelector("button")?.focus();
    return true;
  };
  const reload = (id: string) => {
    if (!model.reload(id)) return false;
    recovery.released(id);
    surfaces.remount(id);
    deps.reloaded(id);
    return true;
  };
  const recovery = new CrashRecovery(() => deps.timers.now());
  const crashed = (id: string) => {
    const section = surfaces.get(id);
    if (!section || !model.crash(id)) return false;
    deps.stopped(id);
    const held = recovery.crashed(id) === "hold";
    const line = held ? say("heldLine") : say("crashedLine", { title: deps.title(id) });
    const text = { title: deps.title(id), line, reload: say("reload") };
    const stand = stoppedPlaceholder(section.ownerDocument, text, () => reload(id));
    surfaces.unload(id, stand);
    deps.host()?.unloaded(id, undefined);
    if (held) return true;
    // Load it again at once, as the person's Reload would; the hold is not released by this.
    model.reload(id);
    surfaces.remount(id);
    deps.reloaded(id);
    return true;
  };
  const wait = (id: string) => {
    const section = surfaces.get(id);
    const focused = section !== undefined && focusedIn(section);
    if (!model.wait(id)) return false;
    // The question is gone: the keys stay with its surface rather than drop to the page.
    if (focused) section?.focus();
    return true;
  };

  const draw = (id: string, response: Response) => {
    const section = surfaces.get(id);
    if (!section) return;
    if (response.watched || response.state !== "responding")
      section.dataset.responding = response.state;
    else delete section.dataset.responding;
    const asking = response.asking && {
      title: say("notResponding"),
      line: say("notRespondingLine", { title: deps.title(id) }),
      wait: { label: say("wait"), run: () => void wait(id) },
      stop: { label: say("stop"), run: () => void stop(id) },
    };
    showNotResponding(section, asking || undefined);
  };
  const offChange = model.onChange((id, response) => {
    draw(id, response);
    for (const listener of [...listeners]) listener(id, response.state);
  });
  // A frame's hello starts its pings (a new page); its pongs are its answers.
  const onMessage = (event: MessageEvent) => {
    const type = (event.data as { type?: unknown } | null)?.type;
    if (type !== "desk:hello" && type !== "desk:pong") return;
    const id = model.ids().find((candidate) => surfaces.frame(candidate) === event.source);
    if (id === undefined) return;
    if (type === "desk:hello") model.hello(id);
    else model.answered(id);
  };
  win.addEventListener("message", onMessage);

  return {
    responses: {
      state: (id) => model.get(id)?.state,
      wait,
      stop,
      reload,
      crashed,
      onChange: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    track: (id) => model.track(id),
    untrack: (id) => model.untrack(id),
    dispose() {
      offChange();
      win.removeEventListener("message", onMessage);
      model.dispose();
      listeners.clear();
    },
  };
}
