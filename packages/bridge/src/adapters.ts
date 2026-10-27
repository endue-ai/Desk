import type { BridgeAdapter, ParamsOf, ResultOf } from "./client";
import type {
  BridgeEvent,
  BridgeMethod,
  BridgeRequest,
  BridgeResponse,
  Permission,
} from "./generated";

/** Tauri's `invoke`, injected so this package does not depend on Tauri. */
export type Invoke = (command: string, args: Record<string, unknown>) => Promise<unknown>;
/** Tauri's `listen`, optional until the core emits events. */
export type Listen = (
  event: string,
  handler: (event: { payload: unknown }) => void,
) => Promise<() => void>;

/** The app adapter: every request goes to the `bridge_call` command; events arrive on `bridge://event`. */
export function tauriAdapter(invoke: Invoke, listen?: Listen): BridgeAdapter {
  return {
    name: "tauri",
    call: async (request) => (await invoke("bridge_call", { request })) as BridgeResponse,
    onEvent: (listener) => {
      if (!listen) return () => {};
      let unlisten: (() => void) | undefined;
      let cancelled = false;
      void listen("bridge://event", (event) => listener(event.payload as BridgeEvent)).then(
        (off) => {
          if (cancelled) off();
          else unlisten = off;
        },
      );
      return () => {
        cancelled = true;
        unlisten?.();
      };
    },
  };
}

export type StubHandlers = {
  [M in BridgeMethod]?: (params: ParamsOf<M>) => ResultOf<M> | Promise<ResultOf<M>>;
};

/** A stub adapter: configured methods answer, everything else is denied as the core would. */
export interface BrowserStub extends BridgeAdapter {
  /** Deliver an event to the listeners, as the core would. */
  emit(event: BridgeEvent): void;
  /** Every request received, in order. */
  readonly calls: readonly BridgeRequest[];
}

export function browserStub(handlers: StubHandlers): BrowserStub {
  const listeners = new Set<(event: BridgeEvent) => void>();
  const calls: BridgeRequest[] = [];
  return {
    name: "browser",
    calls,
    emit: (event) => {
      for (const listener of listeners) listener(event);
    },
    onEvent: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    call: async (request) => {
      calls.push(request);
      const handler = handlers[request.method] as
        | ((params: unknown) => unknown | Promise<unknown>)
        | undefined;
      if (!handler) {
        const scope = (request.params as { scope?: Permission }).scope;
        return {
          id: request.id,
          ok: false,
          error: {
            code: "permission_denied",
            message: `${request.method} is not allowed in the browser stub`,
            ...(scope ? { permission: scope } : {}),
          },
        };
      }
      try {
        return { id: request.id, ok: true, result: await handler(request.params) };
      } catch (error) {
        return {
          id: request.id,
          ok: false,
          error: {
            code: "internal",
            message: error instanceof Error ? error.message : String(error),
          },
        };
      }
    },
  };
}
