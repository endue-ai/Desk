// A bridge on real things for the tests: net.* opens node:net sockets (the usual model-server ports
// sent to the made-up servers when a remap is given), fs.* works under a temporary folder, store.*
// keeps values in memory, and perm.request answers as told.
import {
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { connect, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { startFakeEngine } from "../dev/fake-engine.mjs";

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
  options: {
    remap?: Map<number, number>;
    grant?: boolean;
    engine?: boolean;
    memory?: number;
    pick?: string;
  } = {},
): NodeBridge {
  const root = mkdtempSync(join(process.env.LM_TMP ?? tmpdir(), "lm-test-"));
  const listeners = new Set<Listener>();
  const sockets = new Map<string, Socket>();
  const store = new Map<string, unknown>();
  const calls: { method: string; params: Json }[] = [];
  const procs = new Map<string, () => void>();
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
        const port =
          options.remap && params.port < 39281 ? options.remap.get(params.port) : params.port;
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
        const full = inside(params.path);
        let size: number;
        try {
          size = statSync(full).size;
        } catch {
          throw fail("not_found", params.path);
        }
        let data: Buffer;
        if (params.offset !== undefined || params.length !== undefined) {
          const start = Math.min(params.offset ?? 0, size);
          const length = Math.max(0, Math.min(params.length ?? size - start, size - start));
          data = Buffer.alloc(length);
          const fd = openSync(full, "r");
          try {
            readSync(fd, data, 0, length, start);
          } finally {
            closeSync(fd);
          }
        } else data = readFileSync(full);
        return params.encoding === "base64"
          ? { content: data.toString("base64"), encoding: "base64", size }
          : { content: data.toString("utf8"), encoding: "utf8", size };
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
      case "proc.spawn": {
        const name = String(params.command).split("/").pop();
        const id = `p${++next}`;
        const out = (stream: string, text: string) =>
          emit("proc.output", {
            procId: id,
            stream,
            data: Buffer.from(`${text}\n`).toString("base64"),
            encoding: "base64",
          });
        const exit = (code: number | null) =>
          emit("proc.exit", { procId: id, ...(code === null ? { signal: "term" } : { code }) });
        if (name === "llama-server" && options.engine !== false) {
          const cwd = params.cwd ? inside(params.cwd) : root;
          const args = (params.args as string[]).map((a, i, all) =>
            all[i - 1] === "-m" || all[i - 1] === "--mmproj" ? resolve(cwd, a) : a,
          );
          const engine = await startFakeEngine(args, {
            onLine: out,
            onExit: exit,
            loadMs: 150,
            tokenMs: 0,
          });
          procs.set(id, () => engine.kill());
        } else if (name === "sysctl" && options.memory) {
          setTimeout(() => {
            out("stdout", `${options.memory}\n1`);
            exit(0);
          }, 5);
        } else throw fail("not_found", `${params.command} is not installed`);
        return { procId: id };
      }
      case "proc.kill":
        procs.get(params.procId)?.();
        procs.delete(params.procId);
        return {};
      case "dialog.open":
        return options.pick
          ? { cancelled: false, paths: [options.pick] }
          : { cancelled: true, paths: [] };
      case "dialog.save":
        mkdirSync(join(root, "Downloads"), { recursive: true });
        return { cancelled: false, path: `~/Downloads/${params.suggestedName}` };
      case "shell.open":
        return { opened: true };
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
