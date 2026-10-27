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
  call(request: BridgeRequest): Promise<BridgeResponse>;
  onEvent(listener: (event: BridgeEvent) => void): () => void;
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

  async call<M extends BridgeMethod>(method: M, params: ParamsOf<M>): Promise<ResultOf<M>> {
    const request = { id: this.#nextId++, method, params } as BridgeRequest;
    const response = await this.#adapter.call(request);
    if (response.ok) return response.result as ResultOf<M>;
    throw new BridgeCallError(method, response.error);
  }

  onEvent(listener: (event: BridgeEvent) => void): () => void {
    return this.#adapter.onEvent(listener);
  }
}
