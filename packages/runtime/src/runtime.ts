import type { BridgeClient } from "@endue-ai/bridge";
import { type Clock, realClock, tween } from "./clock";
import { type Platform, ShortcutRouter } from "./input";
import {
  type Cell,
  type Layout,
  type LayoutStorage,
  loadLayout,
  move,
  place,
  saveLayout,
} from "./layout";
import { SurfaceHost, type SurfaceSpec } from "./surfaces";
import { applyTheme } from "./theme";

export interface RuntimeOptions {
  /** The element the desk takes over. */
  root: HTMLElement;
  bridge: BridgeClient;
  /** Inject a ManualClock in tests; defaults to the browser clock. */
  clock?: Clock;
  /** Where the layout is saved; defaults to an in-memory store. */
  storage?: LayoutStorage;
  platform?: Platform;
}

export interface Runtime {
  /** Resolves once the bridge answered and the status line shows the result. */
  readonly ready: Promise<void>;
  readonly shortcuts: ShortcutRouter;
  openSurface(spec: SurfaceSpec): void;
  closeSurface(id: string): void;
  moveSurface(id: string, cell: Cell): void;
  focusSurface(id: string | null): void;
  layout(): Layout;
  /** The status line text. */
  status(): string;
  dispose(): void;
}

const FADE_MS = 240;

/** Mount the 2D desk: a compositor grid of sandboxed surfaces and a status line. */
export function createRuntime(options: RuntimeOptions): Runtime {
  const { root, bridge } = options;
  const clock = options.clock ?? realClock();
  const storage = options.storage ?? memoryStorage();
  const doc = root.ownerDocument;
  const win = doc.defaultView ?? window;

  root.classList.add("desk");
  root.replaceChildren();
  applyTheme(root);

  const compositor = doc.createElement("main");
  compositor.className = "desk-compositor";
  const statusLine = doc.createElement("footer");
  statusLine.className = "desk-status";
  statusLine.setAttribute("role", "status");
  statusLine.setAttribute("aria-live", "polite");
  statusLine.style.opacity = "0";
  root.append(compositor, statusLine);

  let layout = loadLayout(storage);
  const shortcuts = new ShortcutRouter({ platform: options.platform ?? "other" });
  const surfaces = new SurfaceHost(compositor, (id) => shortcuts.focus(id));

  const applyGrid = () => {
    compositor.style.gridTemplateColumns = `repeat(${layout.columns}, minmax(0, 1fr))`;
    compositor.style.gridTemplateRows = `repeat(${layout.rows}, minmax(0, 1fr))`;
    for (const id of surfaces.ids()) {
      const cell = layout.cells[id];
      if (cell) surfaces.position(id, cell);
    }
  };
  const commit = (next: Layout) => {
    layout = next;
    saveLayout(storage, layout);
    applyGrid();
  };
  applyGrid();

  const onKey = (event: KeyboardEvent) => {
    if (shortcuts.handle(event)) event.preventDefault();
  };
  win.addEventListener("keydown", onKey);

  const showStatus = (text: string) => {
    statusLine.textContent = text;
    void tween(clock, { from: 0, to: 1, durationMs: FADE_MS }, (value) => {
      statusLine.style.opacity = String(Math.round(value * 1000) / 1000);
    });
  };

  const ready = bridge.call("perm.query", {}).then(
    () => showStatus(`desk ready · bridge: ${bridge.adapterName}`),
    () => showStatus(`desk cannot reach the core · bridge: ${bridge.adapterName}`),
  );

  return {
    ready,
    shortcuts,
    openSurface(spec) {
      surfaces.open(spec);
      commit(place(layout, spec.id));
    },
    closeSurface(id) {
      surfaces.close(id);
      if (shortcuts.focused === id) shortcuts.focus(null);
    },
    moveSurface(id, cell) {
      commit(move(layout, id, cell));
    },
    focusSurface(id) {
      shortcuts.focus(id);
      if (id) surfaces.get(id)?.focus();
    },
    layout: () => structuredClone(layout),
    status: () => statusLine.textContent ?? "",
    dispose() {
      win.removeEventListener("keydown", onKey);
      for (const id of surfaces.ids()) surfaces.close(id);
      root.replaceChildren();
    },
  };
}

function memoryStorage(): LayoutStorage {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
  };
}
