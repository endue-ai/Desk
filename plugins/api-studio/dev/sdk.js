// The preview's stand-in for /_desk/plugin-sdk.js: defineUiPlugin and the parts of the context API
// Studio uses. proc.* runs the real curl through dev/serve.mjs, fs.* a folder of its own, store.*
// and the state live in localStorage, and everything the desk would ask the person is granted.
// `?scheme=light` picks the light theme, `?fresh` starts without saved state, `?brain=demo`
// answers brain.ask with the canned answers in dev/brain-demo.js (screenshots only).

const query = new URLSearchParams(location.search);
document.documentElement.dataset.scheme = query.get("scheme") ?? "dark";
if (query.get("scheme") === "light") {
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "/_dev/theme.css?id=desk.theme.light";
  document.head.append(link);
}
const PREFIX = "api-studio-preview:";
if (query.has("fresh"))
  for (const key of Object.keys(localStorage))
    if (key.startsWith(PREFIX)) localStorage.removeItem(key);

/** @type {Set<(event: unknown) => void>} */
const listeners = new Set();
const emit = (/** @type {unknown} */ event) => {
  for (const listener of listeners) listener(event);
};
/** @type {Map<string, { params: any, input: string, timer: ReturnType<typeof setTimeout> }>} */
const pending = new Map();
let next = 0;

/** Run a spawned curl once its stdin is closed (or at once when nothing is written). @param {string} procId */
async function start(procId) {
  const job = pending.get(procId);
  if (!job) return;
  pending.delete(procId);
  clearTimeout(job.timer);
  const response = await fetch("/_dev/spawn", {
    method: "POST",
    body: JSON.stringify({ command: job.params.command, args: job.params.args, input: job.input }),
  });
  const out = await response.json();
  if (out.stdout)
    emit({
      event: "proc.output",
      data: { procId, stream: "stdout", data: out.stdout, encoding: "base64" },
    });
  if (out.stderr)
    emit({
      event: "proc.output",
      data: { procId, stream: "stderr", data: out.stderr, encoding: "base64" },
    });
  emit({
    event: "proc.exit",
    data: { procId, code: out.code ?? undefined, signal: out.signal ? "kill" : undefined },
  });
}

const fail = (/** @type {string} */ code, /** @type {string} */ message) =>
  Object.assign(new Error(message), { code });

/** @param {string} method @param {any} params */
async function call(method, params) {
  if (method === "proc.spawn") {
    const procId = `p${++next}`;
    pending.set(procId, { params, input: "", timer: setTimeout(() => void start(procId), 400) });
    return { procId };
  }
  if (method === "proc.write") {
    const job = pending.get(params.procId);
    if (job) {
      job.input += params.data;
      if (params.close) void start(params.procId);
    }
    return {};
  }
  if (method === "proc.kill") {
    const job = pending.get(params.procId);
    if (job) {
      pending.delete(params.procId);
      emit({ event: "proc.exit", data: { procId: params.procId, signal: "kill" } });
    }
    return {};
  }
  if (method === "perm.request") return { granted: true };
  if (method === "store.get")
    return {
      value:
        JSON.parse(localStorage.getItem(`${PREFIX}store:${params.key}`) ?? "null") ?? undefined,
    };
  if (method === "store.set") {
    localStorage.setItem(`${PREFIX}store:${params.key}`, JSON.stringify(params.value));
    return {};
  }
  if (method.startsWith("fs.") && method !== "fs.watch") {
    const answer = await (
      await fetch("/_dev/fs", { method: "POST", body: JSON.stringify({ method, params }) })
    ).json();
    if (answer.error) throw fail(answer.error.code, answer.error.message);
    return answer.result;
  }
  if (method === "fs.watch") return { watchId: `w${++next}` };
  if (method === "dialog.open") {
    const path = /** @type {any} */ (window).__pick?.(params);
    return path ? { cancelled: false, paths: [path] } : { cancelled: true, paths: [] };
  }
  if (method === "dialog.save") {
    const path = /** @type {any} */ (window).__pickSave?.(params);
    return path ? { cancelled: false, path } : { cancelled: true };
  }
  if (method === "brain.ask") {
    const turnId = `t${++next}`;
    const { DEMO_ANSWERS } = await import("/_dev/brain-demo.js").catch(() => ({
      DEMO_ANSWERS: {},
    }));
    const answers = /** @type {any} */ (window).__brainAnswers ?? DEMO_ANSWERS;
    const answer = answers[params.tool?.name];
    setTimeout(() => {
      emit({ event: "brain.turn", data: { turnId, kind: "started" } });
      if (answer && query.get("brain") === "demo")
        setTimeout(
          () =>
            emit({ event: "brain.turn", data: { turnId, kind: "completed", structured: answer } }),
          900,
        );
      else
        emit({
          event: "brain.turn",
          data: { turnId, kind: "offline", text: "The preview has no brain." },
        });
    }, 0);
    return { turnId };
  }
  if (method === "ui.notify" || method === "log.write") return {};
  throw fail("unsupported", `${method} is not in the preview`);
}

/** @type {Map<string, (args: unknown) => unknown>} */
const handlers = new Map();

/** @param {{ mount(ctx: any): void }} plugin */
export async function defineUiPlugin(plugin) {
  const config = await (await fetch("/_dev/config")).json();
  /** @type {any} */ (window).__config = config;
  const stateKey = `${PREFIX}state`;
  let state = JSON.parse(localStorage.getItem(stateKey) ?? "null") ?? undefined;
  /** @type {Set<(change: any) => void>} */
  const settingListeners = new Set();
  plugin.mount({
    pluginId: "endue.api-studio",
    instance: "endue.api-studio",
    bridge: {
      call,
      onEvent: (/** @type {any} */ l) => {
        listeners.add(l);
        return () => listeners.delete(l);
      },
    },
    state: {
      get: () => state,
      set: (/** @type {unknown} */ value) => {
        state = value;
        localStorage.setItem(stateKey, JSON.stringify(value));
      },
    },
    settings: {
      get: async (/** @type {string} */ key) =>
        JSON.parse(localStorage.getItem(`${PREFIX}setting:${key}`) ?? "null") ?? undefined,
      set: async (/** @type {string} */ key, /** @type {unknown} */ value) => {
        localStorage.setItem(`${PREFIX}setting:${key}`, JSON.stringify(value));
        for (const l of settingListeners) l({ key, value, owner: "endue.api-studio" });
      },
      onChange: (/** @type {(change: any) => void} */ l) => {
        settingListeners.add(l);
        return () => settingListeners.delete(l);
      },
    },
    commands: {
      on: (/** @type {string} */ name, /** @type {any} */ handler) => handlers.set(name, handler),
      run: async (/** @type {string} */ id) => {
        throw fail("unknown_command", `${id} is not in the preview`);
      },
      list: async () => [],
    },
    theme: { get: () => undefined, on: () => () => {} },
    surface: { show() {}, hide() {}, onUnload: () => () => {}, restored: undefined },
  });
  /** @type {any} */ (window).__commands = handlers;
}
