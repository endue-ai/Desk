import type { BridgeAdapter, ParamsOf, ResultOf } from "./client";
import type {
  BridgeEvent,
  BridgeMethod,
  BridgeRequest,
  BridgeResponse,
  ErrorCode,
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
    call: async (request, caller) =>
      (await invoke(
        "bridge_call",
        caller === undefined ? { request } : { request, caller },
      )) as BridgeResponse,
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

/** Stub answers by method. `caller` is the plugin a call is made for (undefined: the runtime). */
export type StubHandlers = {
  [M in BridgeMethod]?: (
    params: ParamsOf<M>,
    caller: string | undefined,
  ) => ResultOf<M> | Promise<ResultOf<M>>;
};

/** Throw this from a stub handler to answer with a specific error code (and missing permission). */
export class StubError extends Error {
  readonly code: ErrorCode;
  readonly permission: Permission | undefined;

  constructor(code: ErrorCode, message: string, permission?: Permission) {
    super(message);
    this.name = "StubError";
    this.code = code;
    this.permission = permission;
  }
}

/** A stub adapter: configured methods answer; a method nobody serves is `unsupported`. */
export interface BrowserStub extends BridgeAdapter {
  /** Deliver an event to the listeners, as the core would. */
  emit(event: BridgeEvent): void;
  /** Every request received, in order. */
  readonly calls: readonly BridgeRequest[];
  /** Every request with the caller it was made for (undefined: the runtime itself). */
  readonly log: ReadonlyArray<{ caller: string | undefined; request: BridgeRequest }>;
}

export function browserStub(handlers: StubHandlers): BrowserStub {
  const listeners = new Set<(event: BridgeEvent) => void>();
  const calls: BridgeRequest[] = [];
  const log: Array<{ caller: string | undefined; request: BridgeRequest }> = [];
  return {
    name: "browser",
    calls,
    log,
    emit: (event) => {
      for (const listener of listeners) listener(event);
    },
    onEvent: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    call: async (request, caller) => {
      calls.push(request);
      log.push({ caller, request });
      const handler = handlers[request.method] as
        | ((params: unknown, caller: string | undefined) => unknown | Promise<unknown>)
        | undefined;
      if (!handler) {
        const message = `${request.method} is not served by the browser stub`;
        return { id: request.id, ok: false, error: { code: "unsupported", message } };
      }
      try {
        return { id: request.id, ok: true, result: await handler(request.params, caller) };
      } catch (error) {
        const permission = error instanceof StubError ? error.permission : undefined;
        return {
          id: request.id,
          ok: false,
          error: {
            code: error instanceof StubError ? error.code : "internal",
            message: error instanceof Error ? error.message : String(error),
            ...(permission ? { permission } : {}),
          },
        };
      }
    },
  };
}
