// The runtime's side of drag and drop between plugins (ADR 0119). The same messages as the SDK's
// packages/plugin-sdk/src/dnd/types.ts, which the runtime does not import: a frame's messages are
// untrusted until data.ts has read them.

export type DropEffect = "copy" | "move" | "link";
export type DropAnswer = DropEffect | "none";
export interface DeskPath {
  path: string;
  kind?: "file" | "folder";
}
export type DeskData =
  | { type: "desk/paths"; paths: DeskPath[] }
  | { type: "desk/text"; text: string }
  | { type: "desk/uri"; uri: string; title?: string }
  | { type: "desk/json"; kind: string; value: unknown }
  | { type: "text/plain"; text: string };
export interface DragKeys {
  alt: boolean;
  shift: boolean;
  ctrl: boolean;
  meta: boolean;
}
export interface DragImage {
  label?: string;
  detail?: string;
  src?: string;
}
export interface Point {
  x: number;
  y: number;
}

/** What a frame sends about drags (its own ids) and drops (the runtime's ids). */
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
  | { type: "desk:drop-types"; types: string[] }
  | { type: "desk:drag-status"; drag: number; seq: number; effect: DropAnswer }
  | { type: "desk:drop-done"; drag: number; effect: DropAnswer };

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
  | { type: "desk:drag-feedback"; drag: number; effect: DropAnswer }
  | { type: "desk:drag-ended"; drag: number; effect: DropAnswer; to?: string };

/** How a drag ended: the effect performed and the plugin that performed it. */
export interface DragOutcome {
  effect: DropAnswer;
  to?: string;
}
