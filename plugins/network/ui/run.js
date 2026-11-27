// Runs one of macOS's own programs through the bridge (NET-01): proc.spawn by its full path, the
// arguments as an array and no shell, its output gathered from proc.output events until proc.exit,
// killed when it takes too long. The grant covers exactly the programs of PROGRAMS; when it is
// missing it is asked for once. A program that is not there is a refusal with its name.
import { NetworkRefusal } from "./refusal.js";

/**
 * @typedef {{ code: number | null, stdout: string }} Outcome
 * @typedef {{ call(method: string, params: any): Promise<any>,
 *   onEvent(listener: (event: { event: string, data: any }) => void): () => void }} Bridge
 */

/** The programs, by the name the plugin calls them, at the paths macOS installs them. */
export const PROGRAMS = Object.freeze({
  arp: "/usr/sbin/arp",
  ping: "/sbin/ping",
  route: "/sbin/route",
  ifconfig: "/sbin/ifconfig",
  dig: "/usr/bin/dig",
  profiler: "/usr/sbin/system_profiler",
});

/** @typedef {keyof typeof PROGRAMS} Program */

/** Everything proc:spawn may run, as the manifest declares it. */
export const SPAWN_SCOPE = Object.freeze({
  permission: "proc:spawn",
  commands: Object.freeze(Object.values(PROGRAMS)),
});

const OUTPUT_LIMIT = 4 * 1024 * 1024;
const codeOf = (/** @type {unknown} */ e) => /** @type {{ code?: string }} */ (e)?.code ?? "error";

/** @param {string} data @param {string | undefined} encoding */
function decode(data, encoding) {
  if (encoding !== "base64") return data;
  const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** @param {Bridge} bridge @param {{ reason?: string }} [options] */
export function createRunner(bridge, options = {}) {
  /** @type {Map<string, (event: { event: string, data: any }) => void>} */
  const jobs = new Map();
  /** @type {Map<string, Array<{ event: string, data: any }>>} */
  const early = new Map();
  /** Asked once per session: a refusal is not asked again until the plugin reloads. */
  let asked = /** @type {Promise<boolean> | null} */ (null);

  bridge.onEvent((event) => {
    if (event.event !== "proc.output" && event.event !== "proc.exit") return;
    const id = event.data?.procId;
    const job = jobs.get(id);
    if (job) return job(event);
    const kept = early.get(id) ?? [];
    kept.push(event);
    early.set(id, kept);
    if (early.size > 64) early.delete(/** @type {string} */ (early.keys().next().value));
  });

  /** @param {Program} program @param {string[]} args */
  const spawn = async (program, args) => {
    const command = PROGRAMS[program];
    const params = { command, args, scope: { permission: "proc:spawn", commands: [command] } };
    try {
      return await bridge.call("proc.spawn", params);
    } catch (error) {
      const code = codeOf(error);
      if (code === "not_found") throw new NetworkRefusal("missing-program", { program: command });
      if (code === "unsupported") throw new NetworkRefusal("unsupported-proc");
      if (code !== "permission_denied") throw error;
    }
    asked ??= bridge
      .call("perm.request", {
        permission: { ...SPAWN_SCOPE, commands: [...SPAWN_SCOPE.commands] },
        reason: options.reason ?? "To read the network with macOS's own programs",
      })
      .then((/** @type {{ granted: boolean }} */ r) => r.granted === true)
      .catch(() => false);
    if (!(await asked)) {
      asked = null;
      throw new NetworkRefusal("programs-denied");
    }
    try {
      return await bridge.call("proc.spawn", params);
    } catch (error) {
      if (codeOf(error) === "not_found")
        throw new NetworkRefusal("missing-program", { program: command });
      throw new NetworkRefusal("programs-denied");
    }
  };

  /**
   * Run a program and resolve with its exit code and what it wrote on stdout. A timeout kills it
   * and resolves with what came so far and code null.
   * @param {Program} program @param {string[]} args @param {{ timeoutMs?: number }} [opts]
   * @returns {Promise<Outcome>}
   */
  const run = async (program, args, opts = {}) => {
    const { procId } = await spawn(program, args);
    return new Promise((resolve) => {
      let stdout = "";
      const done = (/** @type {number | null} */ code) => {
        if (!jobs.delete(procId)) return;
        clearTimeout(timer);
        resolve({ code, stdout });
      };
      const timer = setTimeout(() => {
        void bridge
          .call("proc.kill", {
            procId,
            signal: "kill",
            scope: { ...SPAWN_SCOPE, commands: [PROGRAMS[program]] },
          })
          .catch(() => {});
        done(null);
      }, opts.timeoutMs ?? 10_000);
      const feed = (/** @type {{ event: string, data: any }} */ event) => {
        if (event.event === "proc.output") {
          if (event.data.stream !== "stderr" && stdout.length < OUTPUT_LIMIT)
            stdout += decode(event.data.data, event.data.encoding);
        } else done(typeof event.data.code === "number" ? event.data.code : null);
      };
      jobs.set(procId, feed);
      for (const event of early.get(procId) ?? []) feed(event);
      early.delete(procId);
    });
  };

  return { run };
}

/** @typedef {ReturnType<typeof createRunner>} Runner */
