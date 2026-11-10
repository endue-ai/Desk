// The CEF desk as the app e2e drives it (ADR 0144): the debug build `just build-shell` writes (on macOS
// its .app bundle; a release build never opens the debugging port), started with the spec's
// environment and DESK_REMOTE_DEBUGGING_PORT, its stdout and stderr appended to the spec's log.
// A start is in once it printed the ready line, or marked itself ready in last-start.json (safe mode
// puts its notice on the status line instead), and its DevTools answer; chromedriver attaches there.
import { type ChildProcess, spawn } from "node:child_process";
import { closeSync, openSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

/** The CEF desk's binary: DESK_APP, else the debug build `just build-shell` leaves. */
export function cefBinary(root: string, platform = process.platform): string {
  if (process.env.DESK_APP) return resolve(process.env.DESK_APP);
  if (platform === "darwin") {
    return join(root, "target/bundle/endue-desk-cef.app/Contents/MacOS/endue-desk-cef");
  }
  return join(root, "target/debug", platform === "win32" ? "endue-desk-cef.exe" : "endue-desk-cef");
}

/** The desk's data folder under `home`, as both shells name it (apps/desk/shell/src/paths.rs). */
export function dataDir(home: string, platform = process.platform): string {
  if (platform === "darwin") return join(home, "Library/Application Support/ai.endue.desk");
  if (platform === "win32") return join(home, "AppData/Roaming/ai.endue.desk");
  return join(home, ".local/share/ai.endue.desk");
}

/** A port nothing listens on now. */
export function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const server = createServer();
    server.once("error", fail);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => done(typeof address === "object" && address ? address.port : 0));
    });
  });
}

/** Whether `text` (the log since this start) or last-start.json says this start reached ready. */
export function startedReady(text: string, lastStart: unknown, pid: number | undefined): boolean {
  if (/^desk ready/m.test(text)) return true;
  const record = lastStart as { pid?: number; phase?: string } | undefined;
  return record?.phase === "ready" && record.pid === pid;
}

export interface CefOptions {
  binary: string;
  env: NodeJS.ProcessEnv;
  /** The spec's log: the app's stdout and stderr are appended to it. */
  log: string;
  home: string;
  port: number;
  timeoutMs?: number;
}

export interface CefDesk {
  readonly pid: number | undefined;
  /** Whether the process is gone within `ms` (the shell quits once its browser closed). */
  exits(ms: number): Promise<boolean>;
  /**
   * Quit as the person does (DevTools' Browser.close: every page ends, its pagehide saves, and the
   * shell's own Quit runs), then SIGTERM after 10 s and SIGKILL after 10 more; resolves once the
   * process is gone.
   */
  stop(): Promise<void>;
}

const sizeOf = (file: string) => {
  try {
    return statSync(file).size;
  } catch {
    return 0;
  }
};

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
}

/** Ask the browser on `port` to close over DevTools; false when it did not take the message. */
export async function closeBrowser(port: number): Promise<boolean> {
  try {
    const version = await fetch(`http://127.0.0.1:${port}/json/version`);
    const { webSocketDebuggerUrl: url } = (await version.json()) as {
      webSocketDebuggerUrl?: string;
    };
    if (!url) return false;
    const socket = new WebSocket(url);
    return await new Promise<boolean>((done) => {
      const timer = setTimeout(() => done(false), 5_000);
      socket.onopen = () => socket.send(JSON.stringify({ id: 1, method: "Browser.close" }));
      socket.onmessage = () => {
        clearTimeout(timer);
        done(true);
      };
      socket.onerror = () => {
        clearTimeout(timer);
        done(false);
      };
    }).finally(() => socket.close());
  } catch {
    return false;
  }
}

async function devtoolsAnswer(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`);
    const targets = (await response.json()) as Array<{ type?: string; url?: string }>;
    return targets.some((t) => t.type === "page" && t.url?.startsWith("desk-app://"));
  } catch {
    return false;
  }
}

/** Start the CEF desk and wait until it is in: the ready line and its DevTools page. */
export async function launchCef(options: CefOptions): Promise<CefDesk> {
  const { binary, env, log, home, port, timeoutMs = 60_000 } = options;
  const from = sizeOf(log);
  const out = openSync(log, "a");
  let child: ChildProcess;
  try {
    child = spawn(binary, [], {
      env: { ...env, DESK_REMOTE_DEBUGGING_PORT: String(port) },
      stdio: ["ignore", out, out],
    });
  } finally {
    closeSync(out);
  }
  const exited = new Promise<number | null>((done) => {
    child.once("exit", (code) => done(code));
    child.once("error", () => done(-1));
  });
  let gone = false;
  void exited.then(() => {
    gone = true;
  });
  const exits = (ms: number) =>
    Promise.race([exited.then(() => true), delay(ms).then(() => false)]);
  const desk: CefDesk = {
    pid: child.pid,
    exits,
    async stop() {
      if (gone) return;
      if ((await closeBrowser(port)) && (await exits(10_000))) return;
      child.kill("SIGTERM");
      if (!(await exits(10_000))) {
        child.kill("SIGKILL");
        await exited;
      }
    },
  };

  const lastStart = join(dataDir(home), "last-start.json");
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (gone) throw new Error(`the CEF desk (${binary}) exited before it was ready; see ${log}`);
    const text = readFileSync(log, "utf8").slice(from);
    if (/^desk cannot reach the core/m.test(text)) {
      await desk.stop();
      throw new Error(`the CEF desk cannot reach its core; see ${log}`);
    }
    if (startedReady(text, readJson(lastStart), child.pid) && (await devtoolsAnswer(port))) {
      return desk;
    }
    await delay(200);
  }
  await desk.stop();
  throw new Error(`the CEF desk was not ready within ${timeoutMs / 1000} s; see ${log}`);
}
