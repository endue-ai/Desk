// Desk data, and the frame protocol of drag and drop between plugins (ADR 0119). A drag starts in one
// frame; the runtime brokers it, draws its image above every frame and offers it to the frame under
// the pointer, which answers with the effect it would perform. Only the frame it lands on receives the
// items. A drop hands over paths and data, never access: reading a dropped path still needs fs:read.

/** What a drop does with the data: the source keeps it, gives it up, or the target refers to it. */
export type DropEffect = "copy" | "move" | "link";
/** An effect, or the target's refusal. */
export type DropAnswer = DropEffect | "none";

/** A bridge path (`/…`, `~/…`, `C:/…`), and what it names when the source knows. */
export interface DeskPath {
  path: string;
  /** Left out when the source does not know it: an OS drop, say (fs.stat tells). */
  kind?: "file" | "folder";
}

/** One representation of what is dragged. A drag offers each type at most once. */
export type DeskData =
  | { type: "desk/paths"; paths: DeskPath[] }
  | { type: "desk/text"; text: string }
  | { type: "desk/uri"; uri: string; title?: string }
  /** Typed JSON: `kind` names its shape, such as `db/rows` or `docker/container`. */
  | { type: "desk/json"; kind: string; value: unknown }
  /** The fallback every drag offers: the runtime adds it from the other items when it is missing. */
  | { type: "text/plain"; text: string };

/** The modifier keys held while dragging: Alt copies, Mod (Meta or Control) moves, both link. */
export interface DragKeys {
  alt: boolean;
  shift: boolean;
  ctrl: boolean;
  meta: boolean;
}

/**
 * What the desk draws under the pointer. Without it the desk names the items itself (a file's name,
 * "3 items", the text). `src` is a `data:image/(png|jpeg|gif|webp);base64,` URL of 512 KiB at most.
 */
export interface DragImage {
  label?: string;
  detail?: string;
  src?: string;
}

/** Where the pointer is, as a PointerEvent says it. */
export interface PointerLike {
  clientX: number;
  clientY: number;
  pointerId?: number;
  target?: EventTarget | null;
}

export interface DragStart {
  items: DeskData[];
  /** The effects the source allows; every effect when absent. */
  effectAllowed?: DropEffect[];
  image?: DragImage;
  /** The pointer event that started the drag; the last pointer seen in the frame when absent. */
  event?: PointerLike;
}

/** How a drag ended: the effect the target performed ("none": refused or cancelled) and where. */
export interface DragResult {
  effect: DropAnswer;
  /** The plugin the items went to. */
  to?: string;
}

/** What a drop target knows while a drag hovers it: the types, never the items. */
export interface DragOver {
  /** The offered types this target accepts: `desk/paths`, `desk/json:db/rows`, `text/plain`, … */
  types: string[];
  effectAllowed: DropEffect[];
  keys: DragKeys;
  /** The plugin the drag started in, `os` for a drag from the operating system, `desk` for the desk. */
  from: string;
  /** The element the drop would land on (`options.at`), or the target itself. */
  element: unknown;
  /** The pointer, in this frame's coordinates. */
  x: number;
  y: number;
}

/** A drop: the hover's facts, the effect agreed and the items this target accepts. */
export interface Drop extends DragOver {
  effect: DropEffect;
  items: DeskData[];
  /** The `desk/paths` item's paths, if offered. */
  paths?: DeskPath[];
  /** `desk/text`, else the `text/plain` fallback. */
  text?: string;
  /** The `desk/uri` item's URI, if offered. */
  uri?: string;
  /** The values of the `desk/json` items, of one kind or of all. */
  json(kind?: string): unknown[];
}

/** Answers the drop with the effect performed; nothing means the effect agreed, throwing "none". */
export type DropHandler = (
  drop: Drop,
) => DropAnswer | undefined | Promise<DropAnswer | undefined> | void | Promise<void>;

/** Anything a drop target can be: an element, the document, or a stand-in in tests. */
export type DropTarget = object;

export interface DropOptions {
  /** The types it accepts (`desk/json` takes every kind, `desk/json:db/rows` one); all when absent. */
  accept?: readonly string[];
  /** The element the drop lands on, from the element under the pointer; null refuses there. */
  at?(element: unknown): unknown;
  /** The effect it would perform; undefined leaves it to the keys and `effects`. */
  effect?(over: DragOver): DropAnswer | undefined;
  /** The effects it prefers, first first, when no key says; copy, move, link by default. */
  effects?: readonly DropEffect[];
}

/** A list whose rows drag: what a press on a row would drag, or undefined when it does not. */
export interface DraggableOptions {
  item(target: EventTarget | null): Omit<DragStart, "event"> | undefined;
  /** How far the pointer moves, in CSS pixels, before a press becomes a drag (DRAG_THRESHOLD). */
  threshold?: number;
  /** Hears how each drag from the list ended. */
  ended?(result: DragResult, start: Omit<DragStart, "event">): void;
}

/** ctx.dnd: drag desk data out of this frame and take drops into it (ADR 0119). */
export interface PluginDnd {
  /** Start a drag now; resolves once it ended. Needs a pointer that is down. */
  startDrag(drag: DragStart): Promise<DragResult>;
  /** Take drops on `target` (an element or the document); returns the function that stops. */
  onDrop(target: DropTarget, handler: DropHandler, options?: DropOptions): () => void;
  /** Change the types `target` accepts, before or after `onDrop`. */
  acceptTypes(target: DropTarget, types: readonly string[]): void;
  /** Rows of `list` drag past a movement threshold, so a press that does not move stays a click. */
  draggable(list: EventTarget, options: DraggableOptions): () => void;
  /** Whether a drag from this frame is under way. */
  readonly dragging: boolean;
}

/** The frame's side of the protocol. Ids are the frame's own for its drags (`drag-*`). */
export type DndPluginMessage =
  | {
      type: "desk:drag-start";
      drag: number;
      items: DeskData[];
      effectAllowed: DropEffect[];
      image?: DragImage;
      x: number;
      y: number;
    }
  | { type: "desk:drag-move"; drag: number; x: number; y: number; keys: DragKeys }
  | { type: "desk:drag-end"; drag: number; x: number; y: number; keys: DragKeys }
  | { type: "desk:drag-cancel"; drag: number }
  /** Every type this frame's drop targets accept; the runtime offers it nothing else. */
  | { type: "desk:drop-types"; types: string[] }
  /** The answer to a dragenter or dragover (the runtime's drag id, and that hover's `seq`). */
  | { type: "desk:drag-status"; drag: number; seq: number; effect: DropAnswer }
  /** The answer to a drop: the effect performed. */
  | { type: "desk:drop-done"; drag: number; effect: DropAnswer };

/** The runtime's side: to the frame under the pointer (`drag*`, `drop`), and to the source. */
export type DndHostMessage =
  | {
      type: "desk:dragenter";
      drag: number;
      seq: number;
      types: string[];
      effectAllowed: DropEffect[];
      from: string;
      x: number;
      y: number;
      keys: DragKeys;
    }
  | { type: "desk:dragover"; drag: number; seq: number; x: number; y: number; keys: DragKeys }
  | { type: "desk:dragleave"; drag: number }
  | {
      type: "desk:drop";
      drag: number;
      x: number;
      y: number;
      keys: DragKeys;
      effect: DropEffect;
      items: DeskData[];
    }
  /** To the source: the effect the frame under the pointer answers now, for its cursor. */
  | { type: "desk:drag-feedback"; drag: number; effect: DropAnswer }
  /** To the source: its drag ended. */
  | { type: "desk:drag-ended"; drag: number; effect: DropAnswer; to?: string };

export const DND_HOST_TYPES = [
  "desk:dragenter",
  "desk:dragover",
  "desk:dragleave",
  "desk:drop",
  "desk:drag-feedback",
  "desk:drag-ended",
] as const;
