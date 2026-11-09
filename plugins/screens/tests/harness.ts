// A fake bridge for the Screen Sharing plugin's tests, and a fake RFB 3.8 server behind it that
// speaks VNC authentication (security type 2) over net.connect, net.send and net.data, as a Mac with
// "VNC viewers may control screen with password" would. Fixture names only.
import { fromBase64, toBase64 } from "../ui/codec.js";

export type SocketEvent = {
  event: string;
  data: { socketId: string; data?: string; reason?: string };
};
type Handler = (params: Record<string, unknown>) => unknown;

export interface FakeBridge {
  calls: Array<{ method: string; params: Record<string, unknown> }>;
  handlers: Record<string, Handler>;
  call(method: string, params: unknown): Promise<unknown>;
  onEvent(listener: (event: SocketEvent) => void): () => void;
  emit(event: SocketEvent): void;
  params(method: string): Array<Record<string, unknown>>;
}

export const bridgeError = (code: string, message = code) =>
  Object.assign(new Error(message), { code });

export function fakeBridge(handlers: Record<string, Handler> = {}): FakeBridge {
  const listeners = new Set<(event: SocketEvent) => void>();
  const bridge: FakeBridge = {
    calls: [],
    handlers: { ...handlers },
    async call(method, params) {
      const p = (params ?? {}) as Record<string, unknown>;
      bridge.calls.push({ method, params: p });
      const handler = bridge.handlers[method];
      if (!handler) throw bridgeError("unsupported", `${method} is not served`);
      return handler(p);
    },
    onEvent(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit(event) {
      for (const listener of [...listeners]) listener(event);
    },
    params: (method) => bridge.calls.filter((c) => c.method === method).map((c) => c.params),
  };
  return bridge;
}

/** Bytes as a net.data event for socket `id`. */
export const dataEvent = (id: string, bytes: Uint8Array | string): SocketEvent => ({
  event: "net.data",
  data: {
    socketId: id,
    data: toBase64(typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes),
  },
});

const u16 = (n: number) => [(n >> 8) & 0xff, n & 0xff];
const u32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];

export interface FakeServer {
  /** What the client sent, in order. */
  received: Uint8Array[];
  /** The 16-byte challenge and the client's answer to it. */
  challenge: Uint8Array;
  response: Uint8Array | null;
  closed: boolean;
}

/**
 * Serve net.connect, net.send and net.close on `bridge` as one RFB 3.8 server: the version, VNC
 * authentication, then ServerInit for a 4×2 screen named `name`. `accept` decides the sign-in.
 */
export function rfbServer(
  bridge: FakeBridge,
  options: { name?: string; accept?: (response: Uint8Array) => boolean } = {},
): FakeServer {
  const id = "s-1";
  const server: FakeServer = {
    received: [],
    challenge: Uint8Array.from({ length: 16 }, (_, i) => i * 7 + 3),
    response: null,
    closed: false,
  };
  let step: "version" | "type" | "response" | "init" | "done" = "version";
  let buffer = new Uint8Array(0);
  const say = (bytes: number[] | string) =>
    setTimeout(() =>
      bridge.emit(dataEvent(id, typeof bytes === "string" ? bytes : Uint8Array.from(bytes))),
    );
  const take = (n: number) => {
    if (buffer.length < n) return null;
    const out = buffer.slice(0, n);
    buffer = buffer.slice(n);
    return out;
  };
  const name = new TextEncoder().encode(options.name ?? "Studio");
  const advance = () => {
    for (;;) {
      if (step === "version") {
        if (!take(12)) return;
        say([1, 2]);
        step = "type";
      } else if (step === "type") {
        if (!take(1)) return;
        say([...server.challenge]);
        step = "response";
      } else if (step === "response") {
        const response = take(16);
        if (!response) return;
        server.response = response;
        if (options.accept && !options.accept(response)) {
          const reason = new TextEncoder().encode("Authentication failed");
          say([...u32(1), ...u32(reason.length), ...reason]);
          step = "done";
          return;
        }
        say(u32(0));
        step = "init";
      } else if (step === "init") {
        if (!take(1)) return;
        const format = [32, 24, 0, 1, ...u16(255), ...u16(255), ...u16(255), 16, 8, 0, 0, 0, 0];
        say([...u16(4), ...u16(2), ...format, ...u32(name.length), ...name]);
        step = "done";
      } else return;
    }
  };
  bridge.handlers["net.connect"] = () => {
    say("RFB 003.008\n");
    return { socketId: id };
  };
  bridge.handlers["net.send"] = (params) => {
    const bytes = fromBase64(String(params.data));
    server.received.push(bytes);
    const next = new Uint8Array(buffer.length + bytes.length);
    next.set(buffer);
    next.set(bytes, buffer.length);
    buffer = next;
    advance();
    return {};
  };
  bridge.handlers["net.close"] = () => {
    server.closed = true;
    setTimeout(() => bridge.emit({ event: "net.closed", data: { socketId: id } }));
    return {};
  };
  return server;
}

/** Let timers and promises run. */
export const settle = async (rounds = 20) => {
  for (let i = 0; i < rounds; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};
