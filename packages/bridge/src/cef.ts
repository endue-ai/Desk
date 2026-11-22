import type { BridgeAdapter } from "./client";
import type { BridgeEvent, BridgeResponse } from "./generated";

/** Call one of the shell's commands with its arguments; resolves to the shell's answer. */
export type Invoke = (command: string, args: Record<string, unknown>) => Promise<unknown>;
/** Hear one of the shell's events until the returned function is called. */
export type Listen = (
  event: string,
  handler: (event: { payload: unknown }) => void,
) => Promise<() => void>;

/**
 * What the CEF shell puts in every page (#43, ADR 0143): `send` hands a call to the shell, and the
 * shell answers through `onMessage`, which the page sets. The texts are JSON: a call
 * `{ id, cmd, args }`, a reply `{ id, ok }` or `{ id, error }`, an event `{ event, payload }`.
 */
export interface DeskNative {
  send(text: string): void;
  onMessage?: (text: string) => void;
}

/** The shell's commands and events, over the page's native channel. */
export interface CefHost {
  invoke: Invoke;
  listen: Listen;
}

/** The page's native channel when the CEF shell hosts it. */
export function deskNative(scope: object = globalThis): DeskNative | undefined {
  const native = (scope as { __deskNative?: DeskNative }).__deskNative;
  return native && typeof native.send === "function" ? native : undefined;
}

/** `invoke` and `listen` over `native`; replies resolve or reject their call, events reach listeners. */
export function cefHost(native: DeskNative): CefHost {
  let next = 1;
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  const listeners = new Map<string, Set<(event: { payload: unknown }) => void>>();
  native.onMessage = (text) => {
    let message: { id?: number; ok?: unknown; error?: string; event?: string; payload?: unknown };
    try {
      message = JSON.parse(text);
    } catch {
      return;
    }
    if (typeof message.event === "string") {
      for (const handler of listeners.get(message.event) ?? [])
        handler({ payload: message.payload });
      return;
    }
    const call = message.id === undefined ? undefined : pending.get(message.id);
    if (!call || message.id === undefined) return;
    pending.delete(message.id);
    if (typeof message.error === "string") call.reject(new Error(message.error));
    else call.resolve(message.ok ?? null);
  };
  const invoke: Invoke = (cmd, args = {}) =>
    new Promise((resolve, reject) => {
      const id = next++;
      pending.set(id, { resolve, reject });
      native.send(JSON.stringify({ id, cmd, args }));
    });
  const listen: Listen = (event, handler) => {
    const set = listeners.get(event) ?? new Set();
    listeners.set(event, set);
    set.add(handler);
    return Promise.resolve(() => set.delete(handler));
  };
  return { invoke, listen };
}

/**
 * The bridge adapter of the CEF shell: every request goes to the shell's `bridge_call` command (with
 * the caller it is made for, when it names one); the core's events arrive as `bridge://event`. A
 * request the shell refuses (one it cannot read as a BridgeRequest, a page that may not call) is
 * answered as that request's failure, as the core answers a native plugin's line (#566): a rejection
 * here went unhandled where a plugin's calls are relayed, and its calls were never answered.
 */
export function cefAdapter(host: CefHost): BridgeAdapter {
  return {
    name: "cef",
    call: async (request, caller) => {
      try {
        return (await host.invoke(
          "bridge_call",
          caller === undefined ? { request } : { request, caller },
        )) as BridgeResponse;
      } catch (error) {
        return refused(request.id, error);
      }
    },
    onEvent: (listener) => {
      let unlisten: (() => void) | undefined;
      let cancelled = false;
      void host
        .listen("bridge://event", (event) => listener(event.payload as BridgeEvent))
        .then((off) => {
          if (cancelled) off();
          else unlisten = off;
        });
      return () => {
        cancelled = true;
        unlisten?.();
      };
    },
  };
}

/** The failure a refused request answers: `invalid_params` for one that is not a bridge request. */
function refused(id: number, error: unknown): BridgeResponse {
  const message = error instanceof Error ? error.message : String(error);
  const code = message.startsWith("not a bridge request") ? "invalid_params" : "internal";
  return { id, ok: false, error: { code, message } };
}
