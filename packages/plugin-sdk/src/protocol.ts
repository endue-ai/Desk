import type { BridgeEvent, BridgeRequest, BridgeResponse } from "@endue-ai/bridge";
import {
  DND_HOST_TYPES,
  type DndHostMessage,
  type DndPluginMessage,
  type DragKeys,
  type DropAnswer,
  type PointerLike,
} from "./dnd/types";
import { windowDnd } from "./dnd/window";
import { applyFonts, type ThemeFont } from "./theme-fonts";

/** A key press, as the desk's keymap reads it. */
export interface KeyPress {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/** How a request the desk sent went: its result, or why it failed. */
export interface CommandOutcome {
  call: number;
  ok: boolean;
  result?: unknown;
  error?: { code: string; message: string };
}

/** Messages a plugin frame sends to the runtime. */
export type PluginMessage =
  | { type: "desk:hello" }
  | { type: "desk:calls"; calls: BridgeRequest[] }
  | { type: "desk:state"; state: unknown }
  | { type: "desk:close" }
  | { type: "desk:visible"; visible: boolean }
  | ({ type: "desk:reply" } & CommandOutcome)
  | { type: "desk:key"; key: KeyPress }
  /** The plugin mounted: its first ready (ADR 0061). */
  | { type: "desk:ready" }
  /** The plugin failed to start: mount threw, or the frame did before ready. */
  | { type: "desk:failed"; message: string }
  /** The answer to the desk's ping `n`, which the SDK sends by itself (`ping.ts`, #39). */
  | { type: "desk:pong"; n: number }
  /** Drag and drop between frames (ADR 0119). */
  | DndPluginMessage;

/** Messages the runtime sends to a plugin frame. */
export type HostMessage =
  | {
      type: "desk:init";
      pluginId: string;
      /**
       * Which of the plugin's windows this page is (ADR 0212): `<plugin id>@<n>`, or the plugin id for
       * its first. Absent from a desk that opens one window per plugin.
       */
      instance?: string;
      state: unknown;
      /** What the plugin kept when the desk last unloaded this frame (ui.surface.state, ADR 0070). */
      restored?: unknown;
    }
  | { type: "desk:results"; results: Array<{ id: number; response: BridgeResponse }> }
  | { type: "desk:event"; event: BridgeEvent }
  | { type: "desk:command"; name: string; args?: unknown; call?: number }
  | { type: "desk:theme"; theme: ThemeState }
  /** Whether the frame still takes messages: the SDK answers it by itself (`ping.ts`), never the plugin. */
  | { type: "desk:ping"; n: number }
  | DndHostMessage;

/** The theme in force: its tokens as CSS custom properties, its fonts, and what the person asked for. */
export interface ThemeState {
  scheme: "light" | "dark";
  contrast: "normal" | "high";
  reducedMotion: boolean;
  variables: Record<string, string>;
  /** The fonts the active theme brings; the frame loads them as FontFace. */
  fonts?: ThemeFont[];
}

/** How the SDK talks to its host: postMessage in a frame, memory in tests. */
export interface Transport {
  send(message: PluginMessage): void;
  listen(handler: (message: HostMessage) => void): () => void;
  /** Report chords pressed where the plugin runs (a frame), for the desk's keymap. */
  keys?(handler: (key: KeyPress) => void): () => void;
  /** Apply the desk's theme where the plugin runs (a frame's root element). */
  theme?(theme: ThemeState): void;
  /** Follow the pointer and the keys while a drag from here lasts; returns the function that stops. */
  follow?(from: PointerLike | undefined, handlers: FollowHandlers): () => void;
  /** The element at a point where the plugin runs (`document.elementFromPoint`). */
  elementAt?(x: number, y: number): unknown;
  /** Show the effect a drag from here would have (undefined: the drag is over). */
  cursor?(effect: DropAnswer | undefined): void;
  /** Where the pointer was last seen. */
  pointer?(): { x: number; y: number } | undefined;
}

/** What a drag from the frame hears from the pointer: moves, the release, or Escape. */
export interface FollowHandlers {
  move(x: number, y: number, keys: DragKeys): void;
  end(x: number, y: number, keys: DragKeys): void;
  cancel(): void;
}

/** Whether a key press is for the desk: a chord with Meta, Control or Alt, or Escape. */
export function isDeskKey(key: KeyPress): boolean {
  return key.metaKey || key.ctrlKey || key.altKey || key.key === "Escape";
}

const HOST_TYPES = new Set([
  "desk:init",
  "desk:results",
  "desk:event",
  "desk:command",
  "desk:theme",
  ...DND_HOST_TYPES,
]);

/** The frame transport: messages go to the parent window and only the parent is heard. */
export function windowTransport(win: Window = window): Transport {
  let appliedVariables = new Set<string>();
  return {
    ...windowDnd(win),
    send: (message) => win.parent.postMessage(message, "*"),
    listen: (handler) => {
      const onMessage = (event: MessageEvent) => {
        const data = event.data as { type?: unknown } | null;
        if (event.source !== win.parent || typeof data?.type !== "string") return;
        if (HOST_TYPES.has(data.type)) handler(data as HostMessage);
      };
      win.addEventListener("message", onMessage);
      return () => win.removeEventListener("message", onMessage);
    },
    keys: (handler) => {
      const onKey = (event: KeyboardEvent) => {
        const { key, metaKey, ctrlKey, altKey, shiftKey } = event;
        const press = { key, metaKey, ctrlKey, altKey, shiftKey };
        // A key the plugin handled itself stays with the plugin.
        if (!event.defaultPrevented && isDeskKey(press)) handler(press);
      };
      win.addEventListener("keydown", onKey);
      return () => win.removeEventListener("keydown", onKey);
    },
    theme: (theme) => {
      const root = win.document.documentElement;
      for (const name of appliedVariables)
        if (!(name in theme.variables)) root.style.removeProperty(name);
      appliedVariables = new Set(
        Object.keys(theme.variables).filter((name) => name.startsWith("--desk-")),
      );
      for (const [name, value] of Object.entries(theme.variables))
        root.style.setProperty(name, value);
      root.dataset.scheme = theme.scheme;
      root.dataset.contrast = theme.contrast;
      root.dataset.motion = theme.reducedMotion ? "reduce" : "full";
      const Face = (win as Window & { FontFace?: typeof FontFace }).FontFace;
      applyFonts(win.document.fonts, Face, theme.fonts ?? []);
    },
  };
}
