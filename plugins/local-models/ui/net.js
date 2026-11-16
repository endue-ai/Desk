// Sockets through the bridge: net.connect under a net:connect scope, the bytes that come back as
// net.data events (base64) and the end as net.closed. A caller holds at most 8 sockets, so opens past
// MAX_OPEN wait their turn. A host outside the manifest's (another computer on the network) is asked
// for once with perm.request, the way a person adds a server.

/** Sockets one page keeps open at once; the bridge refuses a ninth. */
export const MAX_OPEN = 6;
export const LOCAL_HOSTS = Object.freeze(["localhost", "127.0.0.1"]);
export const LOCAL_SCOPE = Object.freeze({ permission: "net:connect", hosts: [...LOCAL_HOSTS] });

/** @param {string} host */
export const isLocalHost = (host) => LOCAL_HOSTS.includes(host.toLowerCase());

/** The net:connect scope a host and port need. @param {string} host @param {number} port */
export function scopeFor(host, port) {
  if (isLocalHost(host)) return LOCAL_SCOPE;
  return { permission: "net:connect", hosts: [`${host.toLowerCase()}:${port}`] };
}

const CHUNK = 0x8000;

/** Bytes to base64. @param {Uint8Array} bytes */
export function toBase64(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i += CHUNK)
    out += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(out);
}

/** base64 to bytes. @param {string} text */
export function fromBase64(text) {
  const raw = atob(text);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/**
 * @typedef {{ call(method: string, params?: unknown): Promise<any>, onEvent(listener: (event: any) => void): () => void }} Bridge
 * @typedef {{
 *   id: string,
 *   write(data: Uint8Array | string): Promise<void>,
 *   close(): void,
 *   chunks(): AsyncGenerator<Uint8Array>,
 *   closed: Promise<string | undefined>,
 * }} Socket
 */

const codeOf = (/** @type {unknown} */ error) =>
  /** @type {{ code?: string }} */ (error)?.code ?? "";

/** A socket's incoming side: chunks queued until read, and the end. */
function inbox() {
  /** @type {Uint8Array[]} */
  const queue = [];
  /** @type {(() => void) | undefined} */
  let wake;
  let ended = false;
  /** @type {string | undefined} */
  let reason;
  /** @type {(reason: string | undefined) => void} */
  let settle = () => {};
  /** @type {Promise<string | undefined>} */
  const closed = new Promise((resolve) => {
    settle = resolve;
  });
  return {
    closed,
    /** @param {Uint8Array} bytes */
    push(bytes) {
      queue.push(bytes);
      wake?.();
    },
    /** @param {string | undefined} why */
    end(why) {
      if (ended) return;
      ended = true;
      reason = why;
      settle(why);
      wake?.();
    },
    async *chunks() {
      for (;;) {
        const next = queue.shift();
        if (next) {
          yield next;
          continue;
        }
        if (ended) {
          if (reason && reason !== "closed")
            throw Object.assign(new Error(`connection ended: ${reason}`), { code: "io_error" });
          return;
        }
        await new Promise((resolve) => {
          wake = () => {
            wake = undefined;
            resolve(undefined);
          };
        });
      }
    },
  };
}

/**
 * The page's sockets, on one bridge.
 * @param {Bridge} bridge
 * @param {{ reason?: (host: string, port: number) => string }} [options]
 */
export function createSockets(bridge, options = {}) {
  /** @type {Map<string, ReturnType<typeof inbox>>} */
  const open = new Map();
  /** @type {Map<string, { data: Uint8Array[], closed?: string, done: boolean }>} */
  const early = new Map();
  /** @type {Set<string>} */
  const asked = new Set();
  let active = 0;
  /** @type {(() => void)[]} */
  const waiting = [];

  bridge.onEvent((event) => {
    if (event?.event !== "net.data" && event?.event !== "net.closed") return;
    const id = event.data?.socketId;
    const box = open.get(id);
    if (event.event === "net.data") {
      const bytes = fromBase64(event.data.data ?? "");
      if (box) box.push(bytes);
      else {
        const held = early.get(id) ?? { data: [], done: false };
        held.data.push(bytes);
        early.set(id, held);
      }
      return;
    }
    if (box) {
      open.delete(id);
      box.end(event.data.reason);
      release();
    } else {
      const held = early.get(id) ?? { data: [], done: false };
      held.closed = event.data.reason;
      held.done = true;
      early.set(id, held);
    }
  });

  const take = async () => {
    if (active < MAX_OPEN) {
      active++;
      return;
    }
    await new Promise((resolve) => waiting.push(() => resolve(undefined)));
  };
  const release = () => {
    const next = waiting.shift();
    if (next) next();
    else active = Math.max(0, active - 1);
  };

  /** @param {string} host @param {number} port @param {number} timeoutMs */
  const attempt = (host, port, timeoutMs) =>
    bridge.call("net.connect", { host, port, timeoutMs, scope: scopeFor(host, port) });

  /**
   * Open a TCP connection. Rejects with the bridge's code: `io_error` for a refused port,
   * `timeout`, `permission_denied` when the person said no.
   * @param {{ host: string, port: number, timeoutMs?: number, ask?: boolean }} target
   * @returns {Promise<Socket>}
   */
  async function connect({ host, port, timeoutMs = 4000, ask = true }) {
    await take();
    /** @type {{ socketId: string }} */
    let result;
    try {
      try {
        result = await attempt(host, port, timeoutMs);
      } catch (error) {
        const key = `${host}:${port}`;
        if (codeOf(error) !== "permission_denied" || !ask || isLocalHost(host) || asked.has(key))
          throw error;
        asked.add(key);
        const granted = await bridge
          .call("perm.request", {
            permission: scopeFor(host, port),
            reason: options.reason?.(host, port) ?? `To talk to the model server on ${key}`,
          })
          .catch(() => ({ granted: false }));
        if (!granted?.granted) throw error;
        result = await attempt(host, port, timeoutMs);
      }
    } catch (error) {
      release();
      throw error;
    }
    const id = result.socketId;
    const box = inbox();
    const held = early.get(id);
    early.delete(id);
    for (const bytes of held?.data ?? []) box.push(bytes);
    if (held?.done) {
      box.end(held.closed);
      release();
    } else open.set(id, box);
    const encoder = new TextEncoder();
    return {
      id,
      closed: box.closed,
      chunks: () => box.chunks(),
      async write(data) {
        const bytes = typeof data === "string" ? encoder.encode(data) : data;
        await bridge.call("net.send", { socketId: id, data: toBase64(bytes) });
      },
      close() {
        if (!open.has(id)) return;
        open.delete(id);
        box.end(undefined);
        release();
        void bridge.call("net.close", { socketId: id }).catch(() => {});
      },
    };
  }

  return {
    connect,
    /** Sockets open now. */
    get active() {
      return open.size;
    },
  };
}
