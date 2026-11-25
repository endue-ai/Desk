// Binary output stays in chunks until the browser decodes the frame. A small adb invocation can
// finish before proc.spawn answers, so subscribe before spawning and replay events by process id.
const decoder = new TextDecoder();
const encoder = new TextEncoder();
const folders = ["Library/Android/sdk", "Android/Sdk", "AppData/Local/Android/Sdk"];
const tools = { adb: "platform-tools/adb", emulator: "emulator/emulator" };
const maxBytes = 32 * 1024 * 1024;

function bytes({ data, encoding }) {
  if (encoding !== "base64") return encoder.encode(data);
  if (Uint8Array.fromBase64) return Uint8Array.fromBase64(data);
  return Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
}

export function createProcesses(bridge, sdk = () => "") {
  const found = new Map();
  const jobs = new Map();
  let waiting = 0;
  const early = new Map();
  let earlySize = 0;
  let disposed = false;
  const off = bridge.onEvent((event) => {
    if (event.event !== "proc.output" && event.event !== "proc.exit") return;
    const id = event.data.procId;
    const job = jobs.get(id);
    if (job) return job.feed(event);
    if (!waiting) return;
    const events = early.get(id) ?? [];
    earlySize += event.data.data?.length ?? 1;
    if (earlySize <= maxBytes * 2) events.push(event);
    else events.overflow = true;
    early.set(id, events);
  });

  async function spawn(tool, args, signal) {
    const folder = tools[tool];
    const root = sdk()
      .trim()
      .replace(/[\\/]+$/, "");
    if (!folder) throw new Error("Unknown Android SDK tool.");
    if (root && !/^(?:\/|[A-Za-z]:[\\/])/.test(root))
      throw new Error("Enter an absolute Android SDK directory in Desk settings.");
    const key = `${root}\n${tool}`;
    const candidates = root ? [tool] : [tool, ...folders.map((base) => `${base}/${folder}`)];
    const cached = found.get(key);
    if (cached) candidates.unshift(cached);
    for (const command of new Set(candidates)) {
      if (disposed || signal?.aborted) throw new DOMException("Cancelled.", "AbortError");
      const scope = { permission: "proc:spawn", commands: [command] };
      const params = { command, args, cwd: "~", scope };
      if (root) params.env = { PATH: `${root}/${folder.split("/")[0]}`, ANDROID_HOME: root };
      try {
        let result;
        try {
          result = await bridge.call("proc.spawn", params);
        } catch (error) {
          if (error.code !== "permission_denied") throw error;
          const grant = await bridge.call("perm.request", {
            permission: scope,
            reason: `Use the local Android SDK's ${tool} tool.`,
          });
          if (!grant.granted)
            throw new Error(`Allow ${tool} in Desk permissions and refresh the devices.`);
          if (disposed || signal?.aborted) throw new DOMException("Cancelled.", "AbortError");
          result = await bridge.call("proc.spawn", params);
        }
        found.set(key, command);
        return { procId: result.procId, scope };
      } catch (error) {
        if (error.code !== "not_found") throw error;
        found.delete(key);
      }
    }
    const pkg = tool === "adb" ? "Android SDK Platform-Tools" : "Android Emulator";
    throw new Error(
      `Cannot find ${tool}. Install ${pkg} in SDK Manager or set the SDK directory in Desk settings.`,
    );
  }

  async function start(tool, args, options = {}) {
    const { signal, background = false, binary = false, timeout = 15000 } = options;
    waiting++;
    try {
      const { procId, scope } = await spawn(tool, args, signal);
      let resolve, reject;
      const done = new Promise((yes, no) => {
        resolve = yes;
        reject = no;
      });
      // The child can exit before start() hands its owner the handle.
      done.catch(() => {});
      const chunks = [];
      let size = 0;
      let detail = "";
      let timer;
      let settled = false;
      function finish(action, value) {
        if (settled) return;
        settled = true;
        jobs.delete(procId);
        signal?.removeEventListener("abort", abort);
        clearTimeout(timer);
        action(value);
      }
      function stop(error = new DOMException("Cancelled.", "AbortError")) {
        if (settled) return;
        finish(reject, error);
        return bridge.call("proc.kill", { procId, scope, signal: "term" }).catch(() => {});
      }
      const abort = () => void stop();
      function feed({ event, data }) {
        if (settled) return;
        if (event === "proc.exit") {
          if (data.code !== 0) {
            const output =
              detail.trim() ||
              (!binary && chunks.length ? decoder.decode(chunks.at(-1)).trim() : "");
            finish(reject, new Error(output || `${tool} ended with ${data.signal ?? data.code}.`));
          } else {
            const blob = new Blob(chunks, { type: binary ? "image/png" : "text/plain" });
            finish(resolve, binary ? blob : blob.text());
          }
          return;
        }
        const chunk = bytes(data);
        if (background || data.stream === "stderr") {
          detail = (detail + decoder.decode(chunk)).slice(-4096);
          return;
        }
        size += chunk.length;
        if (size > maxBytes) return void stop(new Error(`${tool} returned too much data.`));
        chunks.push(chunk);
      }
      jobs.set(procId, { feed, stop });
      if (!background)
        timer = setTimeout(
          () => void stop(new Error(`${tool} timed out. Refresh and try again.`)),
          timeout,
        );
      signal?.addEventListener("abort", abort, { once: true });
      const events = early.get(procId) ?? [];
      early.delete(procId);
      if (disposed || signal?.aborted) abort();
      else if (events.overflow) void stop(new Error(`${tool} produced too much early output.`));
      else for (const event of events) feed(event);
      return { done, stop };
    } finally {
      if (--waiting === 0) {
        early.clear();
        earlySize = 0;
      }
    }
  }

  return {
    start,
    run: async (tool, args, options) => (await start(tool, args, options)).done,
    dispose() {
      disposed = true;
      off();
      for (const job of jobs.values()) void job.stop();
    },
  };
}
