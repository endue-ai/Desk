// The palette's page on jsdom: ui/main.js with its imports supplied (the page imports the SDK through
// a browser import map), a ctx whose bridge and commands the test plays, and the person's controls.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { vi } from "vitest";
import * as keys from "../ui/keys.js";
import * as match from "../ui/match.js";
import * as providers from "../ui/providers.js";
import * as search from "../ui/search.js";

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

export interface Command {
  id: string;
  title: string;
  provider?: string;
  keywords?: string[];
  argsSchema?: Record<string, unknown>;
}

export interface Options {
  /** What the one palette provider answers; no provider without it. */
  provider?: Promise<unknown>;
  /** What search.query answers for a query; else the shared `plugins` deferred. */
  pluginSearch?: (query: string) => Promise<{ hits: unknown[] }>;
  bindings?: unknown[];
  /** What cmd.list answers, in the registry's order. */
  commands?: Command[];
  /** The history the palette's store holds at start. */
  history?: string[];
}

const TERMINALS: Command[] = [
  { id: "example.alpha", title: "Terminal alpha", provider: "example" },
  { id: "example.bravo", title: "Terminal bravo", provider: "example" },
];

/** Mount the palette and open it as desk.palette.open does, nothing typed. */
export async function mount(options: Options = {}) {
  vi.useFakeTimers();
  document.body.innerHTML = `<div data-testid="scrim"></div><div data-testid="title"></div>
    <input data-testid="query"><ul data-testid="results"></ul>
    <div data-testid="actions"></div><div data-testid="status"></div>`;
  const { provider, pluginSearch, bindings = [], commands = TERMINALS, history } = options;
  const plugins = deferred<{ hits: unknown[] }>();
  const system = deferred<{ hits: unknown[] }>();
  const callbacks = new Map<string, (args?: unknown) => Promise<unknown>>();
  const run = vi.fn(async (id: string) => {
    if (id === "desk.keys.list") return bindings;
    if (id === "desk.palette.providers")
      return provider ? [{ command: "example.provider.search", title: "Provider" }] : [];
    if (id === "example.provider.search") return provider;
    return undefined;
  });
  const call = vi.fn((method: string, params?: { query?: string; key?: string }) => {
    if (method === "cmd.list") return Promise.resolve({ commands });
    if (method === "search.query") return pluginSearch?.(params?.query ?? "") ?? plugins.promise;
    if (method === "search.system") return system.promise;
    if (method === "init.get") return Promise.resolve({ settings: {} });
    if (method === "store.get" && params?.key === "history")
      return Promise.resolve(history ? { value: history } : {});
    return Promise.resolve({});
  });
  const surface = { show: vi.fn(), hide: vi.fn() };
  const ctx = {
    pluginId: "desk.palette",
    bridge: { call },
    commands: {
      list: async () => commands.map((c) => ({ provider: "example", keywords: [], ...c })),
      on: (id: string, handler: (args?: unknown) => Promise<unknown>) => callbacks.set(id, handler),
      run,
    },
    data: { query: vi.fn() },
    surface,
  };
  const source = readFileSync(join(import.meta.dirname, "../ui/main.js"), "utf8");
  const names = [...source.matchAll(/^import \{([^}]+)\} from .*;$/gm)].flatMap(([, list]) =>
    (list ?? "").split(",").map((name) => name.trim()),
  );
  let registered: { mount: (context: unknown) => Promise<void> } | undefined;
  const supplied: Record<string, unknown> = {
    ...keys,
    ...match,
    ...providers,
    ...search,
    CommandFailed: Error,
    defineUiPlugin: (definition: typeof registered) => {
      registered = definition;
    },
  };
  for (const name of names) if (!(name in supplied)) throw new Error(`main.js imports ${name}`);
  new Function(...names, source.replace(/^import .*;\n/gm, ""))(...names.map((n) => supplied[n]));
  if (!registered) throw new Error("palette did not register");
  await registered.mount(ctx);
  const open = (args: unknown = {}) => callbacks.get("desk.palette.open")?.(args);
  await open();
  const input = document.querySelector<HTMLInputElement>('[data-testid="query"]');
  const list = document.querySelector<HTMLUListElement>('[data-testid="results"]');
  if (!input || !list) throw new Error("palette elements missing");
  const type = (value: string) => {
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const key = (name: string) => input.dispatchEvent(new KeyboardEvent("keydown", { key: name }));
  const selected = () => document.getElementById(input.getAttribute("aria-activedescendant") ?? "");
  /** Every option's id, in the order the person sees them. */
  const ids = () =>
    [...list.querySelectorAll<HTMLElement>('[role="option"]')].map((o) => o.dataset.id);
  /** The groups the list shows: each title with its options' ids. */
  const sections = () =>
    [...list.querySelectorAll<HTMLElement>('[role="group"]')].map((group) => [
      group.getAttribute("aria-label"),
      [...group.querySelectorAll<HTMLElement>('[role="option"]')].map((o) => o.dataset.id),
    ]);
  return {
    input,
    list,
    plugins,
    system,
    run,
    call,
    surface,
    type,
    key,
    selected,
    ids,
    sections,
    open,
    callbacks,
  };
}
