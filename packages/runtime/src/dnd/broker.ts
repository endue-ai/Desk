// The broker of drags between plugin frames (ADR 0119), without the DOM: geometry and drawing come in
// as deps. One drag at a time, from a frame or from the OS. The frame under the pointer hears
// dragenter, dragover and dragleave with the offered types it accepts, never the items, and only if it
// accepts one of them; it answers the effect it would perform. On release the items go to that frame
// alone, once it has answered an effect, and the source hears how it ended.
import {
  imageOf,
  NO_KEYS,
  readAnswer,
  readEffects,
  readImage,
  readItems,
  readKeys,
  readTypes,
  taken,
  typeOf,
} from "./data";
import type {
  DeskData,
  DndHostMessage,
  DragImage,
  DragKeys,
  DragOutcome,
  DropAnswer,
  DropEffect,
  Point,
} from "./types";

export interface BrokerDeps {
  /** The plugin whose frame is topmost at a point of the desk's page. */
  pluginAt(x: number, y: number): string | undefined;
  /** A page point in a plugin frame's own coordinates; undefined when it is not on the page. */
  toFrame(id: string, at: Point): Point | undefined;
  /** A point of a plugin frame on the desk's page. */
  toPage(id: string, at: Point): Point | undefined;
  post(id: string, message: DndHostMessage): void;
  /** The drag image above every frame, and the shield that keeps the pointer for the desk. */
  layer: {
    show(image: DragImage & { count: number }, at: Point, shield: boolean): void;
    move(at: Point, effect: DropAnswer): void;
    hide(): void;
  };
  /** Resolves after `ms`: how long a release waits for the target's last answer. */
  wait?(ms: number): Promise<void>;
  /**
   * Whether the person is acting now: the page's transient user activation, which a press inside a
   * frame gives its ancestors too. False refuses a frame's drag; undefined (no such API) allows it.
   */
  gesture?(): boolean | undefined;
}

interface Drag {
  id: number;
  /** The plugin it started in, or `os`. */
  from: string;
  /** The source frame's id for it. */
  local?: number;
  items: DeskData[];
  types: string[];
  effectAllowed: DropEffect[];
  at: Point;
  keys: DragKeys;
  over?: string;
  seq: number;
  answered: number;
  effect: DropAnswer;
  answers: Array<() => void>;
  done(outcome: DragOutcome): void;
}

const ANSWER_MS = 400;

export class DragBroker {
  readonly #deps: BrokerDeps;
  readonly #accepts = new Map<string, string[]>();
  /** Drops delivered and waiting for the target's answer, by the runtime's drag id. */
  readonly #drops = new Map<number, { target: string; resolve(effect: DropAnswer): void }>();
  #drag: Drag | undefined;
  /** A drag released and waiting for its target's last answer. */
  #settling: Drag | undefined;
  #next = 1;

  constructor(deps: BrokerDeps) {
    this.#deps = deps;
  }

  get active(): boolean {
    return this.#drag !== undefined;
  }

  /** Where the drag under way started: a plugin id, or `os`. */
  get from(): string | undefined {
    return this.#drag?.from;
  }

  /** A message from plugin `id`'s frame; false when it is not about drag and drop. */
  message(id: string, message: unknown): boolean {
    const m = (message ?? {}) as Record<string, unknown> & { type?: unknown };
    const drag = this.#drag;
    const mine = drag?.from === id && drag.local === m.drag;
    switch (m.type) {
      case "desk:hello":
        this.#accepts.delete(id);
        return false;
      case "desk:drag-start":
        this.#start(id, m);
        return true;
      case "desk:drag-move":
        if (mine) this.#hover(this.#page(id, m), readKeys(m.keys));
        return true;
      case "desk:drag-end":
        if (mine) void this.release(this.#page(id, m), readKeys(m.keys));
        return true;
      case "desk:drag-cancel":
        if (mine) this.cancel();
        return true;
      case "desk:drop-types":
        this.#accepts.set(id, readTypes(m.types));
        return true;
      case "desk:drag-status": {
        const hovered = drag ?? this.#settling;
        if (hovered?.over === id && m.drag === hovered.id && typeof m.seq === "number")
          this.#answered(hovered, m.seq, readAnswer(m.effect, hovered.effectAllowed));
        return true;
      }
      case "desk:drop-done": {
        const pending = this.#drops.get(m.drag as number);
        if (pending?.target === id) pending.resolve(m.effect as DropAnswer);
        return true;
      }
      default:
        return false;
    }
  }

  /** The OS drags paths over the desk (native-files.ts): from here on it is a drag like any other. */
  enterNative(paths: string[], at: Point): void {
    const items = readItems([{ type: "desk/paths", paths: paths.map((path) => ({ path })) }]);
    // A drag from a frame goes on; the OS's own drag of nothing usable is not one.
    if (!items || (this.#drag && this.#drag.from !== "os")) return;
    this.cancel();
    // The OS keeps its files: a drop from it copies or links, never moves them out of their folder.
    this.#begin("os", undefined, items, ["copy", "link"], at, undefined);
  }

  /** The pointer moved: from the shield, or the OS's drag. */
  pointer(at: Point, keys: DragKeys = NO_KEYS): void {
    if (this.#drag) this.#hover(at, keys);
  }

  /** The pointer was released at `at`: the items go to the frame there if it answered an effect. */
  async release(at: Point, keys: DragKeys = NO_KEYS): Promise<DragOutcome> {
    const drag = this.#drag;
    if (!drag) return { effect: "none" };
    // Released elsewhere, or with other keys, than the last hover: the target answers that first.
    const same = (Object.keys(keys) as Array<keyof DragKeys>).every(
      (k) => keys[k] === drag.keys[k],
    );
    if (at.x !== drag.at.x || at.y !== drag.at.y || !same) this.#hover(at, keys);
    this.#drag = undefined;
    this.#deps.layer.hide();
    const target = drag.over;
    if (target && drag.answered < drag.seq) {
      this.#settling = drag;
      const answered = new Promise<void>((resolve) => drag.answers.push(resolve));
      await Promise.race([answered, (this.#deps.wait ?? delay)(ANSWER_MS)]);
      if (this.#settling === drag) this.#settling = undefined;
    }
    const local = target ? this.#deps.toFrame(target, drag.at) : undefined;
    const stayed = target !== undefined && drag.over === target;
    if (!target || !stayed || !local || drag.effect === "none" || drag.answered < drag.seq) {
      if (target) this.#deps.post(target, { type: "desk:dragleave", drag: drag.id });
      return this.#finish(drag, { effect: "none" });
    }
    const accept = this.#accepts.get(target) ?? [];
    const offered = new Set(taken(accept, drag.types));
    const items = drag.items.filter((item) => offered.has(typeOf(item)));
    const { effect } = drag;
    const done = new Promise<DropAnswer>((resolve) =>
      this.#drops.set(drag.id, { target, resolve }),
    );
    this.#deps.post(target, { type: "desk:drop", drag: drag.id, ...local, keys, effect, items });
    const performed = readAnswer(await done, drag.effectAllowed);
    this.#drops.delete(drag.id);
    return this.#finish(
      drag,
      performed === "none" ? { effect: "none" } : { effect: performed, to: target },
    );
  }

  /** Escape, or the OS drag left the desk: nothing is dropped. */
  cancel(): void {
    const drag = this.#drag;
    if (!drag) return;
    this.#drag = undefined;
    this.#deps.layer.hide();
    if (drag.over) this.#deps.post(drag.over, { type: "desk:dragleave", drag: drag.id });
    this.#finish(drag, { effect: "none" });
  }

  /** A plugin's frame went away (unloaded or unmounted): it takes no part any more. */
  gone(id: string): void {
    this.#accepts.delete(id);
    for (const [, pending] of this.#drops) if (pending.target === id) pending.resolve("none");
    const drag = this.#drag;
    if (drag?.from === id) {
      drag.local = undefined;
      this.cancel();
    }
    for (const hovered of [this.#drag, this.#settling])
      if (hovered?.over === id) {
        hovered.over = undefined;
        hovered.effect = "none";
        for (const resolve of hovered.answers.splice(0)) resolve();
      }
  }

  #start(id: string, m: Record<string, unknown>): void {
    const local = m.drag;
    const items = readItems(m.items);
    const effects = readEffects(m.effectAllowed);
    // No press behind it, no drag: a frame cannot drop paths on another plugin by itself.
    const pressed = this.#deps.gesture?.() !== false;
    if (typeof local !== "number" || this.#drag || !items || !effects || !pressed) {
      if (typeof local === "number")
        this.#deps.post(id, { type: "desk:drag-ended", drag: local, effect: "none" });
      return;
    }
    this.#begin(id, local, items, effects, this.#page(id, m), readImage(m.image));
  }

  #begin(
    from: string,
    local: number | undefined,
    items: DeskData[],
    effectAllowed: DropEffect[],
    at: Point,
    image: DragImage | undefined,
  ): void {
    const drag: Drag = {
      id: this.#next++,
      from,
      ...(local === undefined ? {} : { local }),
      items,
      types: items.map(typeOf),
      effectAllowed,
      at,
      keys: NO_KEYS,
      seq: 0,
      answered: 0,
      effect: "none",
      answers: [],
      done: (outcome) => {
        if (drag.local !== undefined)
          this.#deps.post(from, { type: "desk:drag-ended", drag: drag.local, ...outcome });
      },
    };
    this.#drag = drag;
    // The OS draws its own image; a frame's drag gets the desk's, and the shield over every frame.
    if (from !== "os") this.#deps.layer.show(imageOf(items, image), at, true);
    this.#hover(at, NO_KEYS);
  }

  #finish(drag: Drag, outcome: DragOutcome): DragOutcome {
    drag.done(outcome);
    return outcome;
  }

  /** The frame's point on the page; where the drag was when the frame is not on the page. */
  #page(id: string, m: Record<string, unknown>): Point {
    const x = Number(m.x);
    const y = Number(m.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return this.#drag?.at ?? { x: 0, y: 0 };
    return this.#deps.toPage(id, { x, y }) ?? { x, y };
  }

  /** The frame under `at` takes the drag if it accepts one of its types; the one before leaves. */
  #hover(at: Point, keys: DragKeys): void {
    const drag = this.#drag;
    if (!drag) return;
    drag.at = at;
    drag.keys = keys;
    const under = this.#deps.pluginAt(at.x, at.y);
    const types = under ? taken(this.#accepts.get(under) ?? [], drag.types) : [];
    const local = under && types.length > 0 ? this.#deps.toFrame(under, at) : undefined;
    const target = local ? under : undefined;
    if (target !== drag.over) {
      if (drag.over) this.#deps.post(drag.over, { type: "desk:dragleave", drag: drag.id });
      drag.over = target;
      drag.effect = "none";
      drag.answered = drag.seq;
      this.#feedback(drag);
      if (target && local) {
        const { id, effectAllowed, from } = drag;
        const seq = ++drag.seq;
        const enter = { drag: id, seq, types, effectAllowed, from, ...local, keys };
        this.#deps.post(target, { type: "desk:dragenter", ...enter });
      }
    } else if (target && local) {
      const seq = ++drag.seq;
      this.#deps.post(target, { type: "desk:dragover", drag: drag.id, seq, ...local, keys });
    }
    this.#deps.layer.move(at, drag.effect);
  }

  #answered(drag: Drag, seq: number, effect: DropAnswer): void {
    if (seq > drag.seq || seq < drag.answered) return;
    drag.answered = seq;
    if (seq === drag.seq) {
      drag.effect = effect;
      this.#deps.layer.move(drag.at, effect);
      this.#feedback(drag);
      for (const resolve of drag.answers.splice(0)) resolve();
    }
  }

  /** The source shows the effect as its cursor while the pointer is its. */
  #feedback(drag: Drag): void {
    if (drag.local !== undefined)
      this.#deps.post(drag.from, {
        type: "desk:drag-feedback",
        drag: drag.local,
        effect: drag.effect,
      });
  }
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
