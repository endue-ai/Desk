import type {
  BridgeError,
  BridgeEvent,
  BridgeMethod,
  BridgeMethodMap,
  BridgeRequest,
  BridgeResponse,
  ErrorCode,
  Permission,
} from "./generated";

/** How a client reaches the core: Tauri's invoke in the app, a stub in tests and the browser. */
export interface BridgeAdapter {
  readonly name: string;
  /**
   * Send one request. `caller` names a plugin when the runtime calls on its behalf; without it
   * the runtime itself is the caller. Only the runtime can set it: plugins never reach an adapter.
   */
  call(request: BridgeRequest, caller?: string): Promise<BridgeResponse>;
  onEvent(listener: (event: BridgeEvent) => void): () => void;
}

export interface CallOptions {
  /** The plugin this call is made for. */
  caller?: string;
}

export type ParamsOf<M extends BridgeMethod> = BridgeMethodMap[M]["params"];
export type ResultOf<M extends BridgeMethod> = BridgeMethodMap[M]["result"];

/** A bridge call that came back with ok: false. */
export class BridgeCallError extends Error {
  readonly method: BridgeMethod;
  readonly code: ErrorCode;
  readonly permission: Permission | undefined;

  constructor(method: BridgeMethod, error: BridgeError) {
    super(`${method}: ${error.code}: ${error.message}`);
    this.name = "BridgeCallError";
    this.method = method;
    this.code = error.code;
    this.permission = error.permission;
  }
}

/** Typed bridge calls: `client.call("fs.read", params)` resolves to an `FsReadResult`. */
export class BridgeClient {
  readonly #adapter: BridgeAdapter;
  #nextId = 1;

  constructor(adapter: BridgeAdapter) {
    this.#adapter = adapter;
  }

  get adapterName(): string {
    return this.#adapter.name;
  }

  async call<M extends BridgeMethod>(
    method: M,
    params: ParamsOf<M>,
    options: CallOptions = {},
  ): Promise<ResultOf<M>> {
    const request = { id: this.#nextId++, method, params } as BridgeRequest;
    const response = await this.#adapter.call(request, options.caller);
    if (response.ok) return response.result as ResultOf<M>;
    throw new BridgeCallError(method, response.error);
  }

  /** Relay a request a plugin made, unchanged, and hand back the raw response. */
  forward(request: BridgeRequest, caller: string): Promise<BridgeResponse> {
    return this.#adapter.call(request, caller);
  }

  onEvent(listener: (event: BridgeEvent) => void): () => void {
    return this.#adapter.onEvent(listener);
  }
}
