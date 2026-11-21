// What the CEF shell says about the plugin frames it saw go, for the runtime's frames: a renderer
// that died (#44, `crashes.rs`), after which the window recovers by itself, and a page the shell
// loaded again by itself because it stopped painting (#157, `web_host/revive.rs`), after which what
// the page before it started ends (#378). Each names its plugin.
import { listen } from "./host";

/** The shell's events, by the names its Rust sends them as. */
export const CRASHED = "desk://frame-crashed";
export const RELOADED = "desk://frame-reloaded";

interface FrameSignalsTarget {
  crashed(id: string): unknown;
  loadedAgain(id: string): void;
}

type Payload = { plugin?: unknown } | null | undefined;

/** Hand the shell's frame events to `frames`; returns a function that stops hearing them. */
export function installFrameSignals(frames: FrameSignalsTarget): () => void {
  const hear = (event: string, act: (plugin: string) => void) =>
    listen<Payload>(event, ({ payload }) => {
      if (typeof payload?.plugin === "string") act(payload.plugin);
    });
  const offs = [
    hear(CRASHED, (plugin) => frames.crashed(plugin)),
    hear(RELOADED, (plugin) => frames.loadedAgain(plugin)),
  ];
  return () => {
    for (const off of offs) void off.then((stop) => stop());
  };
}
