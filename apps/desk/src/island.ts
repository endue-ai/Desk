// The island (ADR 0204), index.html?view=island: a pill over every app with what is going on (the
// agents at work and how many asks wait) and, open, the card in front: a permission prompt or an
// agent's approval, answered here. A small host like the palette's: the shell pins this window's
// caller to the desk and lets it ask only for what it shows and answers (`desk_web::sender`); the
// shell alone decides whether it is open and says so with `island://open`. A new ask never opens it:
// the pill counts it, and the person's press opens it and takes the keys. A card's choices take no
// press in the first moment after it shows, so a press meant for what was there never allows
// anything. Open, it also talks and types to Eris (island-talk.ts): Option+Enter from any app opens
// it with the keys in her field (`island://talk`), and Escape folds it and gives the keys back. It
// follows the theme the main window keeps (palette-theme.ts).
import {
  BridgeCallError,
  BridgeClient,
  type BridgeEvent,
  cefAdapter,
  type PluginInfo,
} from "@endue-ai/bridge";
import { storageChannel } from "@endue-ai/runtime";
import "@endue-ai/runtime/shell.css";
import type { NativeWindow } from "./eris-window";
import "./island.css";
import { answerCall } from "./island-card";
import {
  type Ask,
  asksAfter,
  asksOf,
  type IslandState,
  runningOf,
  runsAfter,
  touchesAgents,
  type Worker,
  workingOf,
} from "./island-model";
import { mountTalk } from "./island-talk";
import { mountIsland } from "./island-view";
import { followDeskTheme } from "./palette-theme";

export type { NativeWindow };

/** What the island is showing, for tests and the window's own checks. */
export interface IslandView {
  state(): IslandState;
  isOpen(): boolean;
  dispose(): void;
}

export interface IslandOptions {
  win?: Window;
  /** How long agent.list rests after an event that may change an agent before it is read again. */
  rest?: number;
  /** How long a card's choices take no press after it shows, in ms. */
  guard?: number;
  /** The time in ms, for the guard. */
  now?: () => number;
}

/** A press that moves this far is a drag, not a click. */
const DRAG_PX = 4;
const MANAGE = { permission: "perm:manage" } as const;
const AGENTS = { permission: "agents:manage" } as const;
const PLUGINS = { permission: "plugin:manage" } as const;
/** A card's choices take no press for this long after it shows (as a browser's permission prompt). */
const GUARD_MS = 500;

const codeOf = (error: unknown) => (error instanceof BridgeCallError ? error.code : "failed");

export async function startIsland(
  native: NativeWindow,
  options: IslandOptions = {},
): Promise<IslandView> {
  const win = options.win ?? window;
  const doc = win.document;
  const root = doc.getElementById("desk");
  if (!root) throw new Error("index.html has no #desk element");
  const theme = followDeskTheme({ root: doc.documentElement, post: () => {} }, win);
  const core = new BridgeClient(
    cefAdapter({ invoke: (command, args) => native.invoke(command, args), listen: native.listen }),
  );
  const run = (command: string, args?: Record<string, unknown>) => {
    native.invoke(command, args).catch((error: unknown) => console.error(`${command}:`, error));
  };

  let registry: Worker[] = [];
  let runs = new Map<string, Worker>();
  let asks: Ask[] = [];
  let plugins: PluginInfo[] = [];
  let open = false;
  /** It was opened while asks waited: answering the last one folds it. */
  let toAnswer = false;
  let answering = false;
  let said = "";
  const state = (): IslandState => ({ working: [...registry, ...runs.values()], asks });
  const now = options.now ?? (() => win.performance.now());
  /** When the card on screen showed: its choices take no press before `guard` has passed. */
  let shownAt = Number.NEGATIVE_INFINITY;

  /** The shortcut that brings the talk from any app, as the shell holds it (`island_state`). */
  let shortcut: { label: string } | undefined;
  /** The open window as tall as what it shows; set once the view exists. */
  let fit = () => {};
  const talk = mountTalk(doc, {
    core,
    channel: storageChannel(win),
    lang: win.navigator.language.startsWith("ko") ? "ko" : "en",
    shortcut: () => shortcut,
    changed: () => fit(),
  });
  const dom = mountIsland(doc, root, (choice) => void answer(choice), talk.el);
  let fitted = 0;
  fit = () => {
    if (!open) return;
    const height = dom.wanted();
    if (height === fitted) return;
    fitted = height;
    run("island_fit", { height });
  };
  const draw = () => {
    if (dom.draw({ state: state(), plugins, open, said })) shownAt = now();
    fit();
  };
  // Quiet until the core has answered.
  draw();

  const setOpen = (next: boolean) => {
    toAnswer = next && asks.length > 0;
    run("island_open", { open: next });
  };
  /** The asks changed: when the last one the person opened it for is done, it folds. */
  const asksChanged = () => {
    if (asks.length === 0 && open && toAnswer) setOpen(false);
  };

  const answer = async (choice: string) => {
    const [front] = asks;
    const call = front && !answering ? answerCall(front, choice) : undefined;
    if (!front || !call || now() - shownAt < (options.guard ?? GUARD_MS)) return;
    answering = true;
    said = "";
    try {
      await core.call(call.method, call.params as never);
      asks = asks.filter((a) => !(a.kind === front.kind && a.id === front.id));
    } catch (error) {
      const code = codeOf(error);
      // Decided elsewhere or withdrawn: it waits no more.
      if (code === "not_found") asks = asks.filter((a) => a !== front);
      else said = `Could not answer: ${code}.`;
    }
    answering = false;
    draw();
    asksChanged();
  };

  let reading = 0;
  const readAgents = async () => {
    const mine = ++reading;
    try {
      const { agents } = await core.call("agent.list", { scope: MANAGE });
      if (mine !== reading) return;
      registry = workingOf(agents);
      draw();
    } catch (error) {
      console.error("agent.list:", error);
    }
  };
  let resting: ReturnType<typeof setTimeout> | undefined;
  const readAgentsSoon = () => {
    if (resting !== undefined) clearTimeout(resting);
    resting = setTimeout(() => {
      resting = undefined;
      void readAgents();
    }, options.rest ?? 200);
  };
  const readPlugins = async () => {
    try {
      ({ plugins } = await core.call("plugin.list", { scope: PLUGINS }));
      draw();
    } catch {
      // Without plugin:manage the ids stand in for names, as in the permissions plugin.
    }
  };

  // Events that come while the first reads are out apply after them, on what they read.
  let loaded = false;
  const early: BridgeEvent[] = [];
  const hear = (event: BridgeEvent) => {
    if (!loaded) {
      early.push(event);
      return;
    }
    const nextAsks = asksAfter(asks, event);
    const nextRuns = runsAfter(runs, event);
    if (nextAsks) asks = nextAsks;
    if (nextRuns) runs = nextRuns;
    if (nextAsks || nextRuns) draw();
    if (nextAsks) asksChanged();
    if (touchesAgents(event)) readAgentsSoon();
    if (event.event === "plugin.changed") void readPlugins();
  };
  const offCore = core.onEvent(hear);
  const offs = await Promise.all([
    native.listen<{ open: boolean }>("island://open", ({ payload }) => {
      open = payload?.open === true;
      if (!open) toAnswer = false;
      fitted = 0;
      draw();
    }),
    // Option+Enter: the shell opened it and gave it the keys; they go to her field.
    native.listen("island://talk", () => talk.focus()),
  ]);
  const [pending, local] = await Promise.all([
    core.call("perm.pending", { scope: MANAGE }).catch(() => undefined),
    core.call("agents.runs", { scope: AGENTS }).catch(() => undefined),
    readAgents(),
    readPlugins(),
    native.invoke("island_state").then(
      (held) => {
        const label = (held as { shortcut?: unknown } | undefined)?.shortcut;
        shortcut = typeof label === "string" ? { label } : undefined;
        talk.refresh();
      },
      () => {},
    ),
  ]);
  if (pending) asks = asksOf(pending);
  if (local) runs = runningOf(local.runs);
  loaded = true;
  for (const event of early.splice(0)) hear(event);
  draw();

  // A press opens or folds it; a press that moves drags it; Escape folds it, the asks still waiting.
  let press: { x: number; y: number } | undefined;
  let dragged = false;
  const listeners: Array<() => void> = [];
  const on = <K extends keyof WindowEventMap>(
    target: Window | HTMLElement,
    name: K,
    listener: (event: WindowEventMap[K]) => void,
  ) => {
    target.addEventListener(name, listener as EventListener);
    listeners.push(() => target.removeEventListener(name, listener as EventListener));
  };
  on(dom.pill, "pointerdown", (event) => {
    if (event.button !== 0) return;
    press = { x: event.screenX, y: event.screenY };
    dragged = false;
  });
  on(win, "pointermove", (event) => {
    if (!press || Math.hypot(event.screenX - press.x, event.screenY - press.y) < DRAG_PX) return;
    press = undefined;
    dragged = true;
    run("island_drag");
  });
  on(win, "pointerup", () => {
    press = undefined;
  });
  on(dom.pill, "click", () => {
    if (dragged) dragged = false;
    else setOpen(!open);
  });
  on(win, "keydown", (event) => {
    // Escape folds it and gives the keys back, unless it ends a composition in her field.
    const composing = event.isComposing || event.keyCode === 229 || talk.composing();
    if (event.key === "Escape" && open && !composing) setOpen(false);
  });
  on(dom.desk, "click", () => run("island_reveal_main"));

  const dispose = () => {
    talk.dispose();
    offCore();
    for (const off of offs) off();
    for (const off of listeners.splice(0)) off();
    if (resting !== undefined) clearTimeout(resting);
    theme.dispose();
  };
  win.addEventListener("pagehide", dispose, { once: true });
  return { state, isOpen: () => open, dispose };
}
