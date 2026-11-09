// A TCP connection the core holds (net.connect, ADR 0133) dressed as the WebSocket-like channel noVNC
// takes (core/websock.js: binaryType, send, close, onopen, onmessage, onclose, onerror, protocol,
// readyState). Bytes go out with net.send, one call at a time with whatever queued meanwhile, so
// they arrive in order; they come in as net.data events. No DOM.
import { concat, fromBase64, toBase64 } from "./codec.js";

/**
 * @typedef {{ event: string, data: { socketId: string, data?: string, reason?: string } }} SocketEvent
 * @typedef {{
 *   call(method: string, params: unknown): Promise<any>,
 *   onEvent(listener: (event: SocketEvent) => void): () => void,
 * }} Bridge
 * @typedef {{ host: string, port: number, timeoutMs?: number }} Target
 * @typedef {{ code: number, reason: string, wasClean: boolean }} CloseInfo
 */

/** How many sockets' events wait for their net.connect answer, at most. */
const EARLY_SOCKETS = 8;

/** The net:connect scope a connection to `host:port` carries. */
export const scopeOf = (/** @type {string} */ host, /** @type {number} */ port) =>
  /** @type {const} */ ({ permission: "net:connect", hosts: [`${host}:${port}`] });

/** The channel noVNC reads and writes: one open socket. */
export class BridgeChannel {
  /** @type {((event: { data: ArrayBuffer }) => void) | null} */
  #onmessage = null;
  /** Bytes that came before anyone listened. @type {ArrayBuffer[]} */
  #held = [];
  /** @type {Uint8Array[]} */
  #pending = [];
  #sending = false;
  #closing = false;
  #bridge;
  #forget;

  /**
   * @param {Bridge} bridge
   * @param {string} socketId
   * @param {() => void} forget called once, when the socket has ended
   */
  constructor(bridge, socketId, forget) {
    this.#bridge = bridge;
    this.#forget = forget;
    this.socketId = socketId;
    this.binaryType = "arraybuffer";
    this.protocol = "";
    /** @type {"open" | "closing" | "closed"} */
    this.readyState = "open";
    /** @type {((event: { type: string }) => void) | null} */
    this.onopen = null;
    /** @type {((event: CloseInfo) => void) | null} */
    this.onclose = null;
    /** @type {((event: { type: string, error?: unknown }) => void) | null} */
    this.onerror = null;
  }

  get onmessage() {
    return this.#onmessage;
  }

  /** The first listener gets what came before it, after the caller has finished attaching. */
  set onmessage(listener) {
    this.#onmessage = listener;
    if (listener && this.#held.length > 0) queueMicrotask(() => this.#release());
  }

  /** @param {ArrayBuffer | ArrayBufferView} data */
  send(data) {
    if (this.readyState !== "open") return;
    // noVNC hands a view of its reused send buffer: copy it before the next push overwrites it.
    const bytes = ArrayBuffer.isView(data)
      ? new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength))
      : new Uint8Array(data.slice(0));
    if (bytes.length === 0) return;
    this.#pending.push(bytes);
    this.#pump();
  }

  close() {
    if (this.readyState !== "open") return;
    this.readyState = "closing";
    this.#closing = true;
    void this.#bridge
      .call("net.close", { socketId: this.socketId })
      .catch(() => {})
      .finally(() => this.#end(null));
  }

  /** A net.data or net.closed event for this socket. @param {SocketEvent} event */
  hear(event) {
    if (event.event === "net.closed") {
      this.#end(this.#closing ? null : (event.data.reason ?? null));
      return;
    }
    if (event.event !== "net.data" || this.readyState === "closed") return;
    const bytes = fromBase64(event.data.data ?? "");
    const buffer = /** @type {ArrayBuffer} */ (
      bytes.byteLength === bytes.buffer.byteLength ? bytes.buffer : bytes.slice().buffer
    );
    if (this.#onmessage && this.#held.length === 0) this.#onmessage({ data: buffer });
    else this.#held.push(buffer);
  }

  #release() {
    const held = this.#held;
    this.#held = [];
    for (const data of held) this.#onmessage?.({ data });
  }

  #pump() {
    if (this.#sending || this.#pending.length === 0 || this.readyState !== "open") return;
    const bytes = concat(this.#pending);
    this.#pending = [];
    this.#sending = true;
    this.#bridge.call("net.send", { socketId: this.socketId, data: toBase64(bytes) }).then(
      () => {
        this.#sending = false;
        this.#pump();
      },
      (/** @type {unknown} */ error) => {
        this.#sending = false;
        this.onerror?.({ type: "error", error });
        this.#end(error instanceof Error ? error.message : "the connection failed");
      },
    );
  }

  /** @param {string | null} reason why it ended, or null for a clean end */
  #end(reason) {
    if (this.readyState === "closed") return;
    this.readyState = "closed";
    this.#pending = [];
    this.#forget();
    this.onclose?.({ code: reason ? 1006 : 1000, reason: reason ?? "", wasClean: !reason });
  }
}

/**
 * The plugin's sockets: one listener for every socket's events, and the events of a socket whose
 * net.connect answer has not come yet kept for it.
 * @param {Bridge} bridge
 */
export function createSockets(bridge) {
  /** @type {Map<string, BridgeChannel>} */
  const open = new Map();
  /** @type {Map<string, SocketEvent[]>} */
  const early = new Map();
  const off = bridge.onEvent((event) => {
    if (event.event !== "net.data" && event.event !== "net.closed") return;
    const id = event.data.socketId;
    const channel = open.get(id);
    if (channel) {
      channel.hear(event);
      return;
    }
    early.set(id, [...(early.get(id) ?? []), event]);
    const oldest = early.keys().next().value;
    if (early.size > EARLY_SOCKETS && oldest !== undefined) early.delete(oldest);
  });
  return {
    /**
     * Connect; resolves the open channel, rejects with the bridge's error (`permission_denied`,
     * `timeout`, `io_error` …).
     * @param {Target} target
     */
    async connect({ host, port, timeoutMs }) {
      const params = {
        host,
        port,
        scope: scopeOf(host, port),
        ...(timeoutMs ? { timeoutMs } : {}),
      };
      const { socketId } = await bridge.call("net.connect", params);
      const channel = new BridgeChannel(bridge, socketId, () => open.delete(socketId));
      open.set(socketId, channel);
      for (const event of early.get(socketId) ?? []) channel.hear(event);
      early.delete(socketId);
      return channel;
    },
    /** How many sockets are open. */
    get size() {
      return open.size;
    },
    dispose() {
      off();
      for (const channel of [...open.values()]) channel.close();
    },
  };
}
