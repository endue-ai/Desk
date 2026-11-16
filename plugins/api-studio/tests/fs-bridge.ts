// A bridge whose fs.* calls work on a temporary folder standing in for the home folder (paths
// start with ~), store.* in memory, and perm.request granted, for the collection tests.
import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export async function fsBridge() {
  const home = await mkdtemp(join(process.env.AS_TMP ?? tmpdir(), "api-studio-"));
  const real = (path: string) =>
    path.startsWith(home) ? path : join(home, path.replace(/^~\/?/, ""));
  const store = new Map<string, unknown>();
  const calls: string[] = [];
  const listeners = new Set<(event: unknown) => void>();
  const bridge = {
    calls,
    home,
    real,
    onEvent: (l: (event: unknown) => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    call: async (method: string, params: Record<string, unknown>) => {
      const p = params as {
        path: string;
        from: string;
        to: string;
        content: string;
        key: string;
        createDirs?: boolean;
        parents?: boolean;
        value?: unknown;
      };
      calls.push(method);
      try {
        switch (method) {
          case "fs.read":
            return { content: await readFile(real(p.path), "utf8"), encoding: "utf8" };
          case "fs.write":
            if (p.createDirs) await mkdir(dirname(real(p.path)), { recursive: true });
            await writeFile(real(p.path), p.content);
            return {};
          case "fs.list": {
            const entries = [];
            for (const name of await readdir(real(p.path))) {
              const s = await stat(join(real(p.path), name));
              entries.push({ name, kind: s.isDirectory() ? "dir" : "file" });
            }
            return { entries };
          }
          case "fs.stat": {
            const s = await lstat(real(p.path));
            const kind = s.isSymbolicLink() ? "symlink" : s.isDirectory() ? "dir" : "file";
            return { kind, size: s.size };
          }
          case "fs.mkdir":
            await mkdir(real(p.path), { recursive: !!p.parents });
            return {};
          case "fs.rename":
            await rename(real(p.from), real(p.to));
            return {};
          case "fs.trash":
            await rm(real(p.path), { recursive: true, force: true });
            return {};
          case "fs.watch":
            return { watchId: "w1" };
          case "store.get":
            return { value: store.get(p.key) };
          case "store.set":
            store.set(p.key, p.value);
            return {};
          case "perm.request":
            return { granted: true };
          case "dialog.open":
            return { cancelled: false, paths: ["~"] };
        }
      } catch (error) {
        const e = error as NodeJS.ErrnoException;
        throw Object.assign(new Error(e.message), {
          code: e.code === "ENOENT" ? "not_found" : "io",
        });
      }
      throw Object.assign(new Error(method), { code: "unsupported" });
    },
    cleanup: () => rm(home, { recursive: true, force: true }),
  };
  return bridge;
}
