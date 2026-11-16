// A bridge on real things for the tests: net.* opens node:net sockets (the usual model-server ports
// sent to the made-up servers when a remap is given), fs.* works under a temporary folder, store.*
// keeps values in memory, and perm.request answers as told.
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { connect, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

// biome-ignore lint/suspicious/noExplicitAny: bridge parameters and results take any JSON shape
type Json = any;
type Listener = (event: { event: string; data: Record<string, unknown> }) => void;

export type NodeBridge = {
  call(method: string, params?: Json): Promise<Json>;
  onEvent(listener: Listener): () => void;
  calls: { method: string; params: Json }[];
  root: string;
  store: Map<string, unknown>;
  close(): void;
};

const fail = (code: string, message: string) => Object.assign(new Error(message), { code });

export function nodeBridge(
  options: { remap?: Map<number, number>; grant?: boolean } = {},
): NodeBridge {
  const root = mkdtempSync(join(process.env.LM_TMP ?? tmpdir(), "lm-test-"));
  const listeners = new Set<Listener>();
  const sockets = new Map<string, Socket>();
  const store = new Map<string, unknown>();
  const calls: { method: string; params: Json }[] = [];
  let next = 0;
  const emit = (event: string, data: Record<string, unknown>) => {
    for (const l of listeners) l({ event, data });
  };
  const inside = (path: string) => {
    const full = resolve(root, path.replace(/^~\/?/, ""));
    if (!full.startsWith(root)) throw fail("permission_denied", "outside");
    return full;
  };
  const granted = new Set<string>();

  async function call(method: string, params: Json = {}) {
    calls.push({ method, params });
    switch (method) {
      case "net.connect": {
        const local = params.host === "127.0.0.1" || params.host === "localhost";
        if (!local && !granted.has(`${params.host}:${params.port}`))
          throw fail("permission_denied", "not granted");
        const port = options.remap ? options.remap.get(params.port) : params.port;
        if (port === undefined) throw fail("io_error", "connection refused");
        return await new Promise((done, reject) => {
          const socket = connect({ host: "127.0.0.1", port });
          socket.once("error", (e) => reject(fail("io_error", e.message)));
          socket.once("connect", () => {
            const id = `s${++next}`;
            sockets.set(id, socket);
            socket.on("data", (d) =>
              emit("net.data", { socketId: id, data: d.toString("base64") }),
            );
            socket.on("close", () => {
              sockets.delete(id);
              emit("net.closed", { socketId: id });
            });
            socket.on("error", () => {});
            done({ socketId: id });
          });
        });
      }
      case "net.send": {
        const socket = sockets.get(params.socketId);
        if (!socket) throw fail("not_found", "no socket");
        await new Promise((r) =>
          socket.write(Buffer.from(params.data, "base64"), () => r(undefined)),
        );
        return {};
      }
      case "net.close":
        sockets.get(params.socketId)?.destroy();
        return {};
      case "perm.request": {
        const hosts: string[] = params.permission?.hosts ?? [];
        if (options.grant !== false) for (const h of hosts) granted.add(h);
        return { granted: options.grant !== false };
      }
      case "fs.read": {
        let data: Buffer;
        try {
          data = readFileSync(inside(params.path));
        } catch {
          throw fail("not_found", params.path);
        }
        const slice =
          params.offset !== undefined
            ? data.subarray(params.offset, params.offset + (params.length ?? data.length))
            : data;
        return params.encoding === "base64"
          ? { content: slice.toString("base64"), encoding: "base64", size: data.length }
          : { content: slice.toString("utf8"), encoding: "utf8", size: data.length };
      }
      case "fs.write": {
        const full = inside(params.path);
        if (params.createDirs) mkdirSync(dirname(full), { recursive: true });
        writeFileSync(
          full,
          params.encoding === "base64" ? Buffer.from(params.content, "base64") : params.content,
        );
        return { bytes: params.content.length };
      }
      case "fs.list": {
        const full = inside(params.path);
        try {
          return {
            entries: readdirSync(full).map((name) => {
              const s = statSync(join(full, name));
              return {
                name,
                kind: s.isDirectory() ? "dir" : "file",
                size: s.size,
                modifiedAt: s.mtime.toISOString(),
              };
            }),
          };
        } catch {
          throw fail("not_found", params.path);
        }
      }
      case "fs.stat": {
        try {
          const s = statSync(inside(params.path));
          return {
            kind: s.isDirectory() ? "dir" : "file",
            size: s.size,
            modifiedAt: s.mtime.toISOString(),
          };
        } catch {
          throw fail("not_found", params.path);
        }
      }
      case "fs.mkdir":
        mkdirSync(inside(params.path), { recursive: true });
        return { created: [] };
      case "fs.trash":
        rmSync(inside(params.path), { recursive: true, force: true });
        return {};
      case "store.get":
        return { value: store.get(params.key) };
      case "store.set":
        store.set(params.key, structuredClone(params.value));
        return {};
      default:
        throw fail("unsupported", method);
    }
  }

  return {
    call,
    onEvent(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    calls,
    root,
    store,
    close() {
      for (const s of sockets.values()) s.destroy();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

export const until = async (check: () => boolean, ms = 8000) => {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 15));
  }
};
