// The test host's side of drag and drop (ADR 0119): it plays the runtime's broker for one plugin. It
// records the drags the plugin starts, follows them as the pointer would, and offers drops to the
// plugin's targets exactly as the runtime does: only types the plugin accepts, with the text/plain
// fallback, the items only on the drop.
import { NO_KEYS, taken, typeOf, withFallback } from "../dnd/data";
import type {
  DeskData,
  DragImage,
  DragKeys,
  DragResult,
  DropAnswer,
  DropEffect,
} from "../dnd/types";
import type { FollowHandlers, HostMessage, PluginMessage, Transport } from "../protocol";

/** A drag the plugin started, and how it ended once it did. */
export interface TestDrag {
  items: DeskData[];
  effectAllowed: DropEffect[];
  image?: DragImage;
  /** Where it started, in the frame's coordinates. */
  x: number;
  y: number;
  /** The pointer's moves since, as the frame reported them. */
  moves: Array<{ x: number; y: number; keys: DragKeys }>;
  /** Set once the drag ended. */
  result?: DragResult;
}

export interface TestDropInput {
  items: DeskData[];
  /** The element under the pointer (`document.elementFromPoint`); the only target when absent. */
  over?: unknown;
  keys?: Partial<DragKeys>;
  /** Every effect when absent. */
  effectAllowed?: DropEffect[];
  /** Who dragged it: a plugin id, `os` or `desk`; `desk` when absent. */
  from?: string;
  x?: number;
  y?: number;
}

export interface TestDnd {
  /** Every drag the plugin started, oldest first. */
  readonly drags: readonly TestDrag[];
  /** The types the plugin's drop targets accept. */
  readonly accepts: readonly string[];
  /** Hover data over the plugin and leave again: the effect it would perform. */
  hover(input: TestDropInput): Promise<DropAnswer>;
  /** Hover and drop data on the plugin: the effect it performed ("none": refused, or no target). */
  drop(input: TestDropInput): Promise<DropAnswer>;
  /** Move the pointer of the plugin's drag under way, as the person would. */
  move(x: number, y: number, keys?: Partial<DragKeys>): void;
  /** Release the plugin's drag over the plugin itself: the round trip. Resolves with its outcome. */
  release(input?: Omit<TestDropInput, "items" | "effectAllowed" | "from">): Promise<DragResult>;
  /** End the plugin's drag as if it landed elsewhere (or nowhere, with "none"). */
  end(effect?: DropAnswer, to?: string): Promise<DragResult>;
  /** Press Escape during the plugin's drag. */
  cancel(): Promise<DragResult>;
}

export function testDnd(pluginId: string, toPlugin: (message: HostMessage) => void) {
  const drags: Array<TestDrag & { id: number }> = [];
  let accepts: string[] = [];
  let following: FollowHandlers | undefined;
  let under: unknown;
  let nextDrag = 1;
  const statuses = new Map<string, (effect: DropAnswer) => void>();
  const drops = new Map<number, (effect: DropAnswer) => void>();

  const waitFor = <T>(map: Map<T, (effect: DropAnswer) => void>, key: T) =>
    new Promise<DropAnswer>((resolve) => map.set(key, resolve));
  const keysOf = (keys?: Partial<DragKeys>): DragKeys => ({ ...NO_KEYS, ...keys });

  /** Enter, and drop when `drop` says so; the runtime's broker does the same with every frame. */
  const offer = async (input: TestDropInput, drop: boolean): Promise<DropAnswer> => {
    const items = withFallback(input.items);
    const types = taken(accepts, items.map(typeOf));
    if (types.length === 0) return "none";
    const drag = nextDrag++;
    const { x = 0, y = 0 } = input;
    const keys = keysOf(input.keys);
    const effectAllowed = input.effectAllowed ?? ["copy", "move", "link"];
    under = input.over;
    const status = waitFor(statuses, `${drag}:1`);
    const from = input.from ?? "desk";
    toPlugin({ type: "desk:dragenter", drag, seq: 1, types, effectAllowed, from, x, y, keys });
    const effect = await status;
    if (!drop || effect === "none") {
      toPlugin({ type: "desk:dragleave", drag });
      return effect;
    }
    const done = waitFor(drops, drag);
    const offered = items.filter((item) => types.includes(typeOf(item)));
    toPlugin({ type: "desk:drop", drag, x, y, keys, effect, items: offered });
    return done;
  };

  const current = () => {
    const drag = [...drags].reverse().find((d) => d.result === undefined);
    if (!drag) throw new Error(`${pluginId} has no drag under way`);
    return drag;
  };
  const finish = async (effect: DropAnswer = "none", to?: string) => {
    const drag = current();
    following = undefined;
    drag.result = { effect, ...(to ? { to } : {}) };
    toPlugin({ type: "desk:drag-ended", drag: drag.id, ...drag.result });
    return drag.result;
  };

  const api: TestDnd = {
    drags,
    get accepts() {
      return accepts;
    },
    hover: (input) => offer(input, false),
    drop: (input) => offer(input, true),
    move: (x, y, keys) => following?.move(x, y, keysOf(keys)),
    release: async (input = {}) => {
      const drag = current();
      const { items, effectAllowed } = drag;
      const effect = await offer({ items, effectAllowed, from: pluginId, ...input }, true);
      return finish(effect, effect === "none" ? undefined : pluginId);
    },
    end: (effect, to) => finish(effect, to),
    cancel: () => {
      following?.cancel();
      return finish("none");
    },
  };

  /** A message from the plugin for the broker; false when it is not one. */
  const send = (message: PluginMessage): boolean => {
    switch (message.type) {
      case "desk:drag-start": {
        const { drag: id, items, effectAllowed, image, x, y } = message;
        drags.push({ id, items, effectAllowed, ...(image ? { image } : {}), x, y, moves: [] });
        return true;
      }
      case "desk:drag-move":
        drags.find((d) => d.id === message.drag)?.moves.push(message);
        return true;
      case "desk:drag-end":
      case "desk:drag-cancel":
        return true;
      case "desk:drop-types":
        accepts = [...message.types];
        return true;
      case "desk:drag-status":
        statuses.get(`${message.drag}:${message.seq}`)?.(message.effect);
        return true;
      case "desk:drop-done":
        drops.get(message.drag)?.(message.effect);
        return true;
      default:
        return false;
    }
  };

  /** What the transport does where the plugin runs, the way a frame's window does it. */
  const transport: Pick<Transport, "follow" | "elementAt" | "cursor"> = {
    follow: (_from, handlers) => {
      following = handlers;
      return () => {
        if (following === handlers) following = undefined;
      };
    },
    elementAt: () => under,
    cursor: () => {},
  };
  return { api, send, transport };
}
