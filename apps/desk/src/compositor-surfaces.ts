// The plugin host's messages to and from each plugin surface's own browser (ADR 0160): the page holds
// no frame for a plugin, so `__deskNative.post(text, host)` hands a message to the CEF shell for the
// surface on `host`, and the shell calls `__deskNative.onSurface(host, text)` with what that
// surface's page posted to its parent (`web_host/relay.rs`). Without the shell nothing goes and
// nothing comes.
import type { SurfaceTransport } from "@endue-ai/runtime";

/** The page's native channel as far as surfaces go. */
export interface SurfaceNative {
  post(text: string, host?: string): void;
  onSurface?: (host: string, text: string) => void;
}

/** The native channel of `scope`, when the CEF shell put one there. */
function nativeOf(scope: object): SurfaceNative | undefined {
  const native = (scope as { __deskNative?: SurfaceNative }).__deskNative;
  return native && typeof native.post === "function" ? native : undefined;
}

/** The shell's side of `remotePages`. */
export function shellSurfaces(scope: object = globalThis): SurfaceTransport {
  const native = nativeOf(scope);
  return {
    post: (host, text) => native?.post(text, host),
    listen(receive) {
      if (!native) return () => {};
      native.onSurface = (host, text) => {
        if (typeof host === "string" && typeof text === "string") receive(host, text);
      };
      return () => {
        native.onSurface = undefined;
      };
    },
  };
}
