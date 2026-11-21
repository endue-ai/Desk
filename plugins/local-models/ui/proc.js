// Programs through the bridge: proc.spawn without a shell, output gathered from proc.output events
// by process id, the end from proc.exit. run() waits for a short program's whole output; start()
// keeps a long one (the model engine) running and hands over its lines as they come. When a program
// is not on the desk's PATH (an app opened from the Finder gets the system's), the usual install
// folders are tried once.
import { fromBase64 } from "./net.js";

/** The programs the plugin may run. */
export const PROGRAMS = Object.freeze(["llama-server", "curl", "git", "sysctl", "nvidia-smi"]);
export const PROC_SCOPE = Object.freeze({ permission: "proc:spawn", commands: [...PROGRAMS] });
export const FALLBACK_PATH = [
  "/opt/homebrew/bin",
  "/usr/local/bin",
  "/usr/bin",
  "/bin",
  "/usr/sbin",
  "/sbin",
  "/snap/bin",
].join(":");

/** @typedef {import("./net.js").Bridge} Bridge */

/** @param {Bridge} bridge */
export function createProcs(bridge) {
  /** @type {Map<string, { line: (stream: string, text: string) => void, exit: (code: number | undefined, signal?: string) => void, rest: Record<string, string> }>} */
  const live = new Map();
  /** @type {Map<string, any[]>} */
  const early = new Map();
  const decoder = new TextDecoder();

  /** @param {any} event */
  function deliver(event) {
    const id = event.data?.procId;
    const entry = live.get(id);
    if (!entry) {
      const list = early.get(id) ?? [];
      list.push(event);
      early.set(id, list.slice(-200));
      return;
    }
    if (event.event === "proc.output") {
      const text =
        event.data.encoding === "base64"
          ? decoder.decode(fromBase64(event.data.data))
          : String(event.data.data ?? "");
      const stream = event.data.stream ?? "stdout";
      const all = (entry.rest[stream] ?? "") + text;
      const lines = all.split(/\r?\n/);
      entry.rest[stream] = lines.pop() ?? "";
      for (const line of lines) entry.line(stream, line);
    } else if (event.event === "proc.exit") {
      for (const [stream, rest] of Object.entries(entry.rest)) if (rest) entry.line(stream, rest);
      live.delete(id);
      entry.exit(event.data.code, event.data.signal);
    }
  }
  bridge.onEvent((event) => {
    if (event?.event === "proc.output" || event?.event === "proc.exit") deliver(event);
  });

  /**
   * Start one program. A program the manifest names runs under its scope; another (an engine at a
   * path the person chose) is asked for once.
   * @param {string} command @param {string[]} args @param {Record<string, string>} [env] @param {string} [cwd]
   */
  async function spawn(command, args, env, cwd) {
    const named = PROGRAMS.includes(command);
    const scope = named ? PROC_SCOPE : { permission: "proc:spawn", commands: [command] };
    const params = { command, args, scope, ...(env ? { env } : {}), ...(cwd ? { cwd } : {}) };
    const codeOf = (/** @type {unknown} */ e) => /** @type {{ code?: string }} */ (e)?.code;
    try {
      return /** @type {{ procId: string }} */ (await bridge.call("proc.spawn", params));
    } catch (error) {
      if (codeOf(error) === "permission_denied" && !named) {
        const asked = await bridge
          .call("perm.request", { permission: scope, reason: `To run ${command}` })
          .catch(() => ({ granted: false }));
        if (!asked?.granted) throw error;
        return /** @type {{ procId: string }} */ (await bridge.call("proc.spawn", params));
      }
      if (codeOf(error) !== "not_found" || env?.PATH || !named) throw error;
      return /** @type {{ procId: string }} */ (
        await bridge.call("proc.spawn", { ...params, env: { ...env, PATH: FALLBACK_PATH } })
      );
    }
  }

  /**
   * Start a program and follow it.
   * @param {string} command @param {string[]} args
   * @param {{ env?: Record<string, string>, cwd?: string, onLine?: (stream: string, text: string) => void, onExit?: (code: number | undefined, signal?: string) => void }} [o]
   */
  async function start(command, args, o = {}) {
    const { procId } = await spawn(command, args, o.env, o.cwd);
    live.set(procId, { line: o.onLine ?? (() => {}), exit: o.onExit ?? (() => {}), rest: {} });
    for (const event of early.get(procId) ?? []) deliver(event);
    early.delete(procId);
    return {
      procId,
      /** @param {"term" | "kill" | "int"} [signal] */
      kill: (signal = "term") => bridge.call("proc.kill", { procId, signal }).catch(() => {}),
    };
  }

  /**
   * Run a short program to its end.
   * @param {string} command @param {string[]} args @param {{ timeoutMs?: number, cwd?: string }} [o]
   * @returns {Promise<{ code: number, stdout: string, stderr: string }>}
   */
  function run(command, args, o = {}) {
    return new Promise((resolve, reject) => {
      /** @type {string[]} */
      const out = [];
      /** @type {string[]} */
      const err = [];
      /** @type {{ kill: () => Promise<unknown> } | undefined} */
      let handle;
      const timer = setTimeout(() => {
        void handle?.kill();
        reject(Object.assign(new Error(`${command} did not finish`), { code: "timeout" }));
      }, o.timeoutMs ?? 5000);
      start(command, args, {
        ...(o.cwd ? { cwd: o.cwd } : {}),
        onLine: (stream, text) => (stream === "stderr" ? err : out).push(text),
        onExit: (code) => {
          clearTimeout(timer);
          resolve({ code: code ?? -1, stdout: out.join("\n"), stderr: err.join("\n") });
        },
      })
        .then((h) => {
          handle = h;
        })
        .catch((e) => {
          clearTimeout(timer);
          reject(e);
        });
    });
  }

  return {
    start,
    run,
    /** @param {string} command @param {string[]} args @param {string} cwd */
    runIn: (command, args, cwd) => run(command, args, { cwd, timeoutMs: 15000 }),
  };
}

/** @typedef {ReturnType<typeof createProcs>} Procs */
