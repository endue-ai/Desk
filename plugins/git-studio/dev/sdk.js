// The preview's stand-in for /_desk/plugin-sdk.js: defineUiPlugin and the parts of the context Git
// Studio uses, with proc.* answered by dev/serve.mjs (the real git) and everything the desk would
// ask the person granted. `?scheme=dark|light` picks the theme; `?repo=` the repository; `?brain=demo`
// answers brain.ask with the canned answers in window.__brainAnswers (screenshots only).

const query = new URLSearchParams(location.search);
const params = query;
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
/** @type {Map<string, string>} */
const inputs = new Map();
let next = 0;

/** @param {string} method @param {any} params */
async function call(method, params) {
  if (method === "proc.spawn") {
    const procId = `p${++next}`;
    setTimeout(async () => {
      const response = await fetch("/_dev/git", {
        method: "POST",
        body: JSON.stringify({
          args: params.args,
          cwd: params.cwd,
          env: params.env,
          input: inputs.get(procId),
        }),
      });
      inputs.delete(procId);
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
      emit({ event: "proc.exit", data: { procId, code: out.code, signal: out.signal } });
    }, 0);
    return { procId };
  }
  if (method === "proc.write") {
    inputs.set(params.procId, params.data);
    return {};
  }
  if (method === "proc.kill") return {};
  if (method === "perm.request") return { granted: true };
  if (method === "brain.ask") {
    const turnId = `t${++next}`;
    const answers = /** @type {any} */ (window).__brainAnswers ?? {};
    const answer = answers[params.tool.name];
    setTimeout(() => {
      emit({ event: "brain.turn", data: { turnId, kind: "started" } });
      if (answer && query.get("brain") === "demo") {
        setTimeout(
          () =>
            emit({ event: "brain.turn", data: { turnId, kind: "completed", structured: answer } }),
          700,
        );
      } else
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
  const config = await (await fetch("/_dev/config")).json();
  const key = "git-studio-preview";
  let state = params.has("fresh")
    ? undefined
    : (JSON.parse(localStorage.getItem(key) ?? "null") ?? undefined);
  const repo = params.get("repo") ?? config.repo;
  if (repo && !params.has("welcome")) state = { ...(state ?? {}), repo };
  if (params.has("welcome")) state = { recent: [config.repo] };
  plugin.mount({
    pluginId: "endue.git-studio",
    instance: "endue.git-studio",
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
    commands: {
      on: (/** @type {string} */ name, /** @type {any} */ handler) => handlers.set(name, handler),
      run: async (/** @type {string} */ id) => {
        throw new CommandFailed(id, "unknown_command", `${id} is not in the preview`);
      },
      list: async () => [],
    },
    theme: { get: () => undefined, on: () => () => {} },
    surface: { show() {}, hide() {}, onUnload: () => () => {}, restored: undefined },
  });
  /** @type {any} */ (window).__commands = handlers;
}
