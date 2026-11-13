// The island (ADR 0204), index.html?view=island: a pill over every app with what is going on (the
// agents at work and how many asks wait), and, pressed, the list of both. A small host like the
// palette's: the shell pins this window's caller to the desk and lets it ask only for what it shows
// (`desk_web::sender`); the shell alone decides whether it is open and says so with `island://open`.
// It follows the theme the main window keeps (palette-theme.ts). Answering, talking and notices
// come with the next slices of #238.
import { BridgeClient, type BridgeEvent, cefAdapter } from "@endue-ai/bridge";
import "@endue-ai/runtime/shell.css";
import type { NativeWindow } from "./eris-window";
import "./island.css";
import {
  type Ask,
  asksAfter,
  asksOf,
  type IslandState,
  runningOf,
  runsAfter,
  summary,
  touchesAgents,
  type Worker,
  workingOf,
} from "./island-model";
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
}

/** A press that moves this far is a drag, not a click. */
const DRAG_PX = 4;
const MANAGE = { permission: "perm:manage" } as const;
const AGENTS = { permission: "agents:manage" } as const;

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
  let open = false;
  const state = (): IslandState => ({ working: [...registry, ...runs.values()], asks });

  const view = mount(doc, root);
  const draw = () => view.draw(state(), open);
  // Quiet until the core has answered.
  draw();

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
    if (touchesAgents(event)) readAgentsSoon();
  };
  const offCore = core.onEvent(hear);
  const offs = await Promise.all([
    native.listen<{ open: boolean }>("island://open", ({ payload }) => {
      open = payload?.open === true;
      draw();
    }),
  ]);
  const [pending, local] = await Promise.all([
    core.call("perm.pending", { scope: MANAGE }).catch(() => undefined),
    core.call("agents.runs", { scope: AGENTS }).catch(() => undefined),
    readAgents(),
  ]);
  if (pending) asks = asksOf(pending);
  if (local) runs = runningOf(local.runs);
  loaded = true;
  for (const event of early.splice(0)) hear(event);
  draw();

  // A press opens or folds it; a press that moves drags it; Escape folds it.
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
  on(view.pill, "pointerdown", (event) => {
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
  on(view.pill, "click", () => {
    if (dragged) dragged = false;
    else run("island_open", { open: !open });
  });
  on(win, "keydown", (event) => {
    if (event.key === "Escape" && open && !event.isComposing) run("island_open", { open: false });
  });
  on(view.desk, "click", () => run("island_reveal_main"));

  const dispose = () => {
    offCore();
    for (const off of offs) off();
    for (const off of listeners.splice(0)) off();
    if (resting !== undefined) clearTimeout(resting);
    theme.dispose();
  };
  win.addEventListener("pagehide", dispose, { once: true });
  return { state, isOpen: () => open, dispose };
}

/** The island's DOM: the pill, and under it the panel that lists what is going on. */
function mount(doc: Document, root: HTMLElement) {
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = "") => {
    const node = doc.createElement(tag);
    node.className = className;
    if (text) node.textContent = text;
    return node;
  };
  const island = el("div", "island");
  const pill = el("button", "island-pill");
  pill.type = "button";
  pill.setAttribute("aria-controls", "island-panel");
  const dots = el("span", "island-dots");
  dots.setAttribute("aria-hidden", "true");
  const line = el("span", "island-line");
  const badge = el("span", "island-badge");
  badge.setAttribute("aria-hidden", "true");
  pill.append(dots, line, badge);
  const status = el("p", "island-status");
  status.setAttribute("role", "status");
  const panel = el("section", "island-panel");
  panel.id = "island-panel";
  panel.setAttribute("aria-label", "What is going on");
  const workingList = el("ul", "island-list");
  const askList = el("ul", "island-list");
  const desk = el("button", "island-desk", "Answer in the desk");
  desk.type = "button";
  panel.append(
    el("h2", "island-heading", "At work"),
    workingList,
    el("h2", "island-heading", "Waiting for you"),
    askList,
    desk,
  );
  island.append(pill, status, panel);
  root.replaceChildren(island);

  const items = (list: HTMLUListElement, rows: Array<[string, string]>, none: string) => {
    if (rows.length === 0) {
      list.replaceChildren(el("li", "island-none", none));
      return;
    }
    list.replaceChildren(
      ...rows.map(([who, what]) => {
        const row = el("li", "island-row");
        row.append(el("span", "island-who", who), el("span", "island-what", what));
        return row;
      }),
    );
  };

  const draw = ({ working, asks }: IslandState, open: boolean) => {
    const said = summary({ working, asks });
    line.textContent = said;
    if (status.textContent !== said) status.textContent = said;
    pill.setAttribute("aria-expanded", String(open));
    pill.setAttribute("aria-label", `${said}. ${open ? "Close" : "Open"} the island`);
    island.dataset.open = String(open);
    island.dataset.asks = String(asks.length);
    island.dataset.working = String(working.length);
    badge.textContent = asks.length > 0 ? String(asks.length) : "";
    badge.hidden = asks.length === 0;
    dots.replaceChildren(
      ...working.slice(0, 3).map((worker) => {
        const dot = el("span", "island-dot");
        if (worker.colour) dot.style.setProperty("--island-dot", worker.colour);
        return dot;
      }),
    );
    panel.hidden = !open;
    items(
      workingList,
      working.map((w) => [w.name, "working"]),
      "No agent is working.",
    );
    items(
      askList,
      asks.map((a) => [a.who, a.what]),
      "Nothing waits for you.",
    );
    desk.hidden = asks.length === 0;
  };
  return { pill, desk, draw };
}
