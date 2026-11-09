import { type Invoke, type Listen, tauriAdapter } from "./adapters";
import type { BridgeAdapter } from "./client";

/**
 * What the CEF shell puts in every page (#43, ADR 0143): `send` hands a call to the shell, and the
 * shell answers through `onMessage`, which the page sets. The texts are JSON, shaped like Tauri's
 * `invoke` and `listen`: a call `{ id, cmd, args }`, a reply `{ id, ok }` or `{ id, error }`, an
 * event `{ event, payload }`.
 */
export interface DeskNative {
  send(text: string): void;
  onMessage?: (text: string) => void;
}

/** Tauri's `invoke` and `listen`, over the CEF shell's native channel. */
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

/** The bridge adapter of the CEF shell: the Tauri adapter's calls, named `cef`. */
export function cefAdapter(host: CefHost): BridgeAdapter {
  return { ...tauriAdapter(host.invoke, host.listen), name: "cef" };
}
