/**
 * The spread (ADR 0116): every window on the desktop fanned out in depth over the desk, to pick one.
 * It moves nothing on the desk: the windows themselves are drawn at a pose (a transform), so plugin
 * frames keep running and the desk's layout, the cover test and the unloading (ADR 0070) see the
 * windows where they are. A covered or unloaded window shows a placeholder instead of being woken.
 * Every motion runs on the shell's frame loop and its injected clock (ADR 0013).
 */
import { easeOutExpo } from "../ease";
import { desktopId, windowsOf } from "../shell/actions";
import type { DeskState } from "../shell/state";
import { ORIGIN, screenRect } from "../surface/coordinates";
import { leaves, panesOf } from "../surface/tree";
import { resolveView } from "../surface/views";
import { IDENTITY, mix, type Pose, SpreadModel, type SpreadWindow } from "./spread-model";

/** What the spread needs of the shell. */
export interface SpreadHost {
  store: { get(): DeskState; set(patch: Partial<DeskState>): void };
  ticker: { add(tick: (now: number) => void): () => void; now(): number };
  reduced(): boolean;
  size(): { vw: number; vh: number };
  /** The windows of the current desktop as the spread shows them. */
  windows(): SpreadWindow[];
  /** Bring a window wholly into sight (the canvas pans when it has to). */
  reveal(id: string): void;
  /** Give a window the focus, once the spread is gone. */
  focus(id: string): void;
  /** How long each motion takes, from the theme's motion tokens. */
  durations(): Durations;
}

export interface Durations {
  open: number;
  move: number;
  close: number;
}

/** What draws the spread: the overlay's chrome and the windows at their poses. */
export interface SpreadView {
  open(model: SpreadModel): void;
  /** The filter, the count, the selection, the list for assistive technology. */
  chrome(model: SpreadModel): void;
  /** One frame: every window at its pose. */
  draw(model: SpreadModel, poses: Map<string, Pose>): void;
  close(): void;
}

/** A plugin a window's panes show, by id. */
function pluginsOf(s: DeskState, id: string): string[] {
  const p = windowsOf(s).find((w) => w.id === id);
  if (!p) return [];
  return leaves(panesOf(p))
    .map((leaf) => resolveView(s, p, leaf.view))
    .filter((view) => view.startsWith("plugin:"))
    .map((view) => view.slice("plugin:".length));
}

/**
 * The windows of the current desktop for the spread, each where it is drawn now. One whose frames
 * are all covered (ADR 0070) or already unloaded is asleep: the spread shows a placeholder for it,
 * so opening the spread never loads every plugin at once.
 */
export function spreadWindows(
  s: DeskState,
  how: {
    size: { vw: number; vh: number };
    covered(plugin: string): boolean;
    unloaded(window: string): boolean;
    title(window: string): string;
  },
): SpreadWindow[] {
  const pan = s.pan[desktopId(s)] ?? ORIGIN;
  return windowsOf(s).map((p) => {
    const plugins = pluginsOf(s, p.id);
    const asleep =
      how.unloaded(p.id) || (plugins.length > 0 && plugins.every((id) => how.covered(id)));
    return {
      id: p.id,
      title: how.title(p.id),
      rect: screenRect(p, pan, how.size.vw, how.size.vh),
      asleep,
    };
  });
}

export class Spread {
  readonly #host: SpreadHost;
  readonly #view: SpreadView;
  #model: SpreadModel | undefined;
  #poses = new Map<string, Pose>();
  #stop: (() => void) | undefined;
  #closing = false;

  constructor(host: SpreadHost, view: SpreadView) {
    this.#host = host;
    this.#view = view;
  }

  get isOpen(): boolean {
    return this.#model !== undefined;
  }

  get model(): SpreadModel | undefined {
    return this.#model;
  }

  toggle(): void {
    if (this.#model) void this.cancel();
    else this.open();
  }

  /** Fan the windows out; false when the desktop has none. */
  open(): boolean {
    if (this.#model) return true;
    const windows = this.#host.windows();
    if (windows.length === 0) return false;
    const model = new SpreadModel(windows, this.#host.size(), {
      flat: this.#host.reduced(),
      selected: this.#host.store.get().focused,
    });
    model.keepInView();
    this.#model = model;
    this.#closing = false;
    this.#poses = new Map(windows.map((w) => [w.id, IDENTITY]));
    this.#view.open(model);
    this.#view.chrome(model);
    void this.#to(model.poses(), this.#host.durations().open);
    return true;
  }

  /** A key pressed in the spread; true when the spread used it. */
  key(e: { key: string; shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean }): boolean {
    const model = this.#model;
    if (!model || this.#closing) return false;
    const action = model.key(e);
    if (action.kind === "cancel") void this.cancel();
    else if (action.kind === "choose") void this.choose(action.id);
    else if (action.kind === "moved") this.#changed(this.#host.durations().move);
    return action.kind !== "none";
  }

  filter(text: string): void {
    if (!this.#model || this.#closing) return;
    this.#model.setFilter(text);
    this.#model.keepInView();
    this.#changed(this.#host.durations().move);
  }

  /** The pointer over a card selects it. */
  hover(id: string): void {
    if (!this.#model || this.#closing || !this.#model.select(id)) return;
    this.#changed(this.#host.durations().move);
  }

  pan(dx: number, dy: number): void {
    if (!this.#model || this.#closing) return;
    this.#model.pan(dx, dy);
    this.#changed(0);
  }

  zoom(factor: number, x: number, y: number): void {
    if (!this.#model || this.#closing) return;
    this.#model.zoomAt(factor, x, y);
    this.#changed(0);
  }

  /** The desk changed under the spread (a window closed, opened or moved): follow it. */
  sync(): void {
    const model = this.#model;
    if (!model || this.#closing) return;
    const windows = this.#host.windows();
    if (windows.length === 0) {
      void this.cancel();
      return;
    }
    const known = new Set(model.windows().map((w) => w.id));
    model.update(windows);
    for (const w of windows) if (!known.has(w.id)) this.#poses.set(w.id, IDENTITY);
    this.#view.open(model);
    this.#changed(this.#host.durations().move);
  }

  /** Close on `id`: it comes into sight, the windows go back, and it takes the focus. */
  async choose(id: string): Promise<void> {
    const model = this.#model;
    if (!model || this.#closing) return;
    this.#closing = true;
    model.select(id);
    this.#host.reveal(id);
    // Revealing may have panned the canvas: the poses follow the windows' new places.
    model.update(this.#host.windows());
    model.select(id);
    this.#poses = model.poses();
    this.#view.chrome(model);
    await this.#back();
    this.#host.focus(id);
  }

  /** Close with nothing chosen: the focus stays where it was. */
  async cancel(): Promise<void> {
    if (!this.#model || this.#closing) return;
    this.#closing = true;
    await this.#back();
  }

  dispose(): void {
    this.#stop?.();
    if (this.#model) this.#view.close();
    this.#model = undefined;
  }

  async #back(): Promise<void> {
    const model = this.#model;
    if (!model) return;
    const home = new Map(model.windows().map((w) => [w.id, IDENTITY]));
    await this.#to(home, this.#host.durations().close);
    this.#view.close();
    this.#model = undefined;
    this.#closing = false;
  }

  #changed(ms: number): void {
    const model = this.#model;
    if (!model) return;
    this.#view.chrome(model);
    void this.#to(model.poses(), ms);
  }

  /** Move every window from where it is drawn now to `target` over `ms` (at once when reduced). */
  #to(target: Map<string, Pose>, ms: number): Promise<void> {
    const model = this.#model;
    this.#stop?.();
    this.#stop = undefined;
    if (!model) return Promise.resolve();
    const from = new Map(this.#poses);
    const frame = (t: number) => {
      const k = easeOutExpo(t);
      this.#poses = new Map(
        [...target].map(([id, pose]) => [id, mix(from.get(id) ?? IDENTITY, pose, k)]),
      );
      this.#view.draw(model, this.#poses);
    };
    if (ms <= 0 || this.#host.reduced()) {
      frame(1);
      return Promise.resolve();
    }
    const start = this.#host.ticker.now();
    return new Promise((resolve) => {
      let off = () => {};
      const done = () => {
        off();
        if (this.#stop === done) this.#stop = undefined;
        resolve();
      };
      this.#stop = done;
      off = this.#host.ticker.add((now) => {
        const t = Math.min(1, (now - start) / ms);
        frame(t);
        if (t >= 1) done();
      });
    });
  }
}
