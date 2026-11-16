// The preview's stand-in for /_desk/plugin-sdk.js: defineUiPlugin and the parts of the context
// Docker Studio uses. proc.* goes to dev/serve.mjs (the seeded engine, or docker with --real);
// everything the desk would ask the person is granted. `?scheme=light` picks the light theme;
// `?brain=demo` answers brain.ask with the canned answers of dev/brain-demo.js (screenshots).

import { DEMO_ANSWERS } from "./brain-demo.js";

const query = new URLSearchParams(location.search);
document.documentElement.dataset.scheme = query.get("scheme") ?? "dark";
if (query.get("scheme") === "light") {
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "/_dev/theme.css?id=desk.theme.light";
  document.head.append(link);
}

export class CommandFailed extends Error {
  /** @param {string} command @param {string} code @param {string} message */
  constructor(command, code, message) {
    super(message);
    this.command = command;
    this.code = code;
  }
}

/** @type {Set<(event: unknown) => void>} */
const listeners = new Set();
const emit = (/** @type {unknown} */ event) => {
  for (const listener of listeners) listener(event);
};
let next = 0;
/** @type {Map<string, AbortController>} */
const running = new Map();
const post = (/** @type {string} */ path, /** @type {unknown} */ data) =>
  fetch(path, { method: "POST", body: JSON.stringify(data) });

/** Read the NDJSON frames of one process and hand them over as the desk's proc events. */
async function pump(/** @type {string} */ procId, /** @type {Response} */ response) {
  const reader = response.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let rest = "";
  let exited = false;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      rest += decoder.decode(value, { stream: true });
      const lines = rest.split("\n");
      rest = lines.pop() ?? "";
      for (const line of lines) {
        if (!line) continue;
        const frame = JSON.parse(line);
        if ("exit" in frame) {
          exited = true;
          emit({
            event: "proc.exit",
            data: { procId, code: frame.exit, signal: frame.signal ?? null },
          });
        } else
          emit({
            event: "proc.output",
            data: { procId, stream: frame.s, data: frame.d, encoding: "utf8" },
          });
      }
    }
  } catch {
    // Aborted by a kill.
  }
  running.delete(procId);
  if (!exited) emit({ event: "proc.exit", data: { procId, code: null, signal: "SIGTERM" } });
}

/** @param {string} method @param {any} params */
async function call(method, params) {
  if (method === "proc.spawn") {
    const procId = `p${++next}`;
    const controller = new AbortController();
    running.set(procId, controller);
    const response = await fetch("/_dev/spawn", {
      method: "POST",
      body: JSON.stringify({ procId, args: params.args, cwd: params.cwd, env: params.env }),
      signal: controller.signal,
    });
    void pump(procId, response);
    return { procId };
  }
  if (method === "proc.write") {
    await post("/_dev/write", { procId: params.procId, data: params.data, close: params.close });
    return {};
  }
  if (method === "proc.kill") {
    await post("/_dev/kill", { procId: params.procId });
    running.get(params.procId)?.abort();
    return {};
  }
  if (method === "perm.request") return { granted: true };
  if (method === "shell.open") {
    console.log("shell.open", params.target);
    return {};
  }
  if (method === "ui.notify") return {};
  if (method === "brain.ask") {
    const turnId = `t${++next}`;
    const answer =
      /** @type {any} */ (window).__brainAnswers?.[params.tool.name] ??
      DEMO_ANSWERS[params.tool.name];
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
  const error = /** @type {Error & { code?: string }} */ (
    new Error(`${method} is not in the preview`)
  );
  error.code = "unsupported";
  throw error;
}

/** @type {Map<string, (args: unknown) => unknown>} */
const handlers = new Map();

/** @param {{ mount(ctx: any): void }} plugin */
export async function defineUiPlugin(plugin) {
  const key = "docker-studio-preview";
  let state = query.has("fresh")
    ? undefined
    : (JSON.parse(localStorage.getItem(key) ?? "null") ?? undefined);
  if (query.get("page")) state = { ...(state ?? {}), page: query.get("page"), detail: null };
  /** @type {Record<string, unknown>} */
  const settings = {};
  plugin.mount({
    pluginId: "endue.docker-studio",
    instance: "endue.docker-studio",
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
        localStorage.setItem(key, JSON.stringify(value));
      },
    },
    settings: {
      get: async (/** @type {string} */ k) => settings[k],
      set: async (/** @type {string} */ k, /** @type {unknown} */ v) => {
        settings[k] = v;
      },
      onChange: () => () => {},
    },
    commands: {
      on: (/** @type {string} */ name, /** @type {any} */ handler) => handlers.set(name, handler),
      run: async (/** @type {string} */ id, /** @type {unknown} */ args) => {
        console.log("command", id, args);
        throw new CommandFailed(id, "unknown_command", `${id} is not in the preview`);
      },
      list: async () => [],
    },
    theme: { get: () => undefined, on: () => () => {} },
    surface: { show() {}, hide() {}, onUnload: () => () => {}, restored: undefined },
  });
  /** @type {any} */ (window).__commands = handlers;
}
