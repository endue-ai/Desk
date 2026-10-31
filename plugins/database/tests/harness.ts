// Mounts the Database plugin on the SDK's test host with scripted clients behind `proc.spawn` and a
// view that records what it was asked to show. The fake psql and sqlite3 answer in their real
// protocol (markers read from the arguments, CSV or quote mode), so the controller, the engines and
// the runner all run as in the desk. The SDK is imported by its workspace path.
import { StubError } from "../../../packages/bridge/src/index";
import { defineUiPlugin } from "../../../packages/plugin-sdk/src/index";
import { createTestHost, type TestHost } from "../../../packages/plugin-sdk/src/testing/index";
import type { Console } from "../ui/consoles.js";
import { createDatabase, type View } from "../ui/database.js";
import type { Connection } from "../ui/engines/common.js";
import type { Node } from "../ui/explorer.js";
import type { FormModel, PasswordModel } from "../ui/manage.js";

type Options = Parameters<typeof createTestHost>[0];
export type Handlers = NonNullable<Options["handlers"]>;
export type Commands = NonNullable<Options["commands"]>;

/** What a scripted statement gives back: rows (the first is the header), changes, or an error. */
export interface Answer {
  rows?: string[][];
  changes?: number;
  error?: string;
}
export type Script = (sql: string, env: Record<string, string>) => Answer | "auth";

export interface Spawned {
  command: string;
  args: string[];
  env: Record<string, string>;
}

const VERSIONS: Record<string, string> = {
  psql: "psql (PostgreSQL) 17.6\n",
  sqlite3: "3.50.6 2025-09-22 18:50:24 9cc5\n",
  mysql: "mysql  Ver 8.4.13 for Linux on aarch64 (MySQL Community Server - GPL)\n",
};

const quote = (value: string) =>
  /^-?\d+(\.\d+)?$/u.test(value) ? value : `'${value.replaceAll("'", "''")}'`;

/** sqlite3's answer to a run: each statement's rows in quote mode, then its marker's total. */
function sqliteRun(args: string[], script: Script, env: Record<string, string>) {
  let stdout = "";
  let total = 0;
  for (let i = 0; i < args.length; i++) {
    const marker = /^SELECT total_changes\(\) AS "(.*)"$/u.exec(args[i + 1] ?? "");
    if (!marker) continue;
    const answer = script(args[i] ?? "", env);
    if (answer === "auth") throw new Error("sqlite3 has no passwords");
    if (answer.error) return { stdout, stderr: `Error: in prepare, ${answer.error}\n`, code: 1 };
    for (const row of answer.rows ?? []) stdout += `${row.map(quote).join(",")}\n`;
    total += answer.changes ?? 0;
    stdout += `'${marker[1]}'\n${total}\n`;
    i++;
  }
  return { stdout, stderr: "", code: 0 };
}

/** psql's answer: CSV per statement, \echo and \warn markers after each. */
function psqlRun(args: string[], script: Script, env: Record<string, string>) {
  let stdout = "";
  let stderr = "";
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== "-c" || (args[i + 1] ?? "").startsWith("\\")) continue;
    const sql = args[i + 1] ?? "";
    const echo = /^\\echo (\S+) :ROW_COUNT$/u.exec(args[i + 3] ?? "");
    const answer = script(sql, env);
    if (answer === "auth")
      return {
        stdout,
        stderr:
          'psql: error: connection to server at "db" failed: fe_sendauth: no password supplied\n',
        code: 2,
      };
    if (answer.error) return { stdout, stderr: `${stderr}ERROR:  ${answer.error}\n`, code: 1 };
    for (const row of answer.rows ?? []) stdout += `${row.join(",")}\n`;
    if (!echo) {
      i += 1;
      continue;
    }
    stdout += `${echo[1]} ${answer.rows ? answer.rows.length - 1 : (answer.changes ?? 0)}\n`;
    stderr += `${echo[1]}\n`;
    i += 5;
  }
  return { stdout, stderr, code: 0 };
}

export interface FakeClients {
  handlers: Handlers;
  spawned: Spawned[];
  attach(host: TestHost): void;
}

/** psql and sqlite3 behind proc.spawn; `missing` programs are not found. */
export function fakeClients(script: Script, missing: string[] = []): FakeClients {
  let host: TestHost | undefined;
  let n = 0;
  const spawned: Spawned[] = [];
  const handlers: Handlers = {
    "proc.spawn": (params) => {
      const command = params.command;
      if (missing.includes(command))
        throw new StubError("not_found", `${command}: no such program`);
      const args = params.args ?? [];
      const env = (params.env ?? {}) as Record<string, string>;
      spawned.push({ command, args, env });
      const procId = `p-${++n}`;
      const reply =
        args[0] === "--version"
          ? { stdout: VERSIONS[command] ?? "", stderr: "", code: 0 }
          : command === "psql"
            ? psqlRun(args, script, env)
            : sqliteRun(args, script, env);
      setTimeout(() => {
        for (const stream of ["stdout", "stderr"] as const)
          if (reply[stream])
            host?.emit({
              event: "proc.output",
              data: { procId, stream, data: reply[stream], encoding: "utf8" },
            });
        host?.emit({ event: "proc.exit", data: { procId, code: reply.code } });
      }, 0);
      return { procId, pid: 100 + n };
    },
    "proc.kill": () => ({}),
  };
  return {
    handlers,
    spawned,
    attach: (h) => {
      host = h;
    },
  };
}

export interface RecordingView extends View {
  trees: Node[][];
  consoles: Array<{ model: Console | null; conn: Connection | null }>;
  forms: Array<FormModel | null>;
  passwords: Array<PasswordModel | null>;
  said: string[];
  copied: string[];
  inserted: string[];
  text: string;
  caret: number;
  selectionEnd: number;
}

export function recordingView(): RecordingView {
  const view: RecordingView = {
    trees: [],
    consoles: [],
    forms: [],
    passwords: [],
    said: [],
    copied: [],
    inserted: [],
    text: "",
    caret: 0,
    selectionEnd: -1,
    explorer: (rows) => void view.trees.push(rows),
    console: (model, conn) =>
      void view.consoles.push({
        model: model ? structuredClone({ ...model, execution: null }) : null,
        conn,
      }),
    form: (model) => void view.forms.push(model),
    password: (model) => void view.passwords.push(model),
    say: (text) => void view.said.push(text),
    busy: () => {},
    editor: () => ({
      text: view.text,
      start: view.caret,
      end: view.selectionEnd < 0 ? view.caret : view.selectionEnd,
    }),
    select: () => {},
    insert: (text) => void view.inserted.push(text),
    copy: (text) => {
      view.copied.push(text);
      return true;
    },
    focus: () => {},
    selection: () => undefined,
  };
  return view;
}

export interface Mounted {
  host: TestHost;
  view: RecordingView;
  app: ReturnType<typeof createDatabase>;
  clients: FakeClients;
  store: Record<string, unknown>;
  picks: Array<{ title: string; items: Array<{ id: string; label: string }> }>;
  shown(): Console | null;
  settle(): Promise<void>;
}

export async function mount(
  options: {
    script?: Script;
    missing?: string[];
    commands?: Commands;
    store?: Record<string, unknown>;
    init?: Record<string, unknown>;
    pick?: (args: { title: string; items: Array<{ id: string; label: string }> }) => string;
  } = {},
): Promise<Mounted> {
  const clients = fakeClients(options.script ?? (() => ({})), options.missing);
  const store: Record<string, unknown> = { ...options.store };
  const picks: Mounted["picks"] = [];
  let buffers = 0;
  const host = createTestHost({
    pluginId: "endue.database",
    handlers: {
      "store.get": ({ key }) => (key in store ? { value: store[key] } : {}),
      "store.set": ({ key, value }) => {
        store[key] = value;
        return {};
      },
      "init.get": () => ({ profile: "default", settings: options.init ?? {} }),
      ...clients.handlers,
    },
    commands: {
      "desk.palette.pick": (args) => {
        const asked = args as { title: string; items: Array<{ id: string; label: string }> };
        picks.push(asked);
        return options.pick ? options.pick(asked) : "";
      },
      "desk.buffers.open": () => `endue.database:${++buffers}`,
      "desk.buffers.update": () => true,
      "desk.buffers.close": () => true,
      ...options.commands,
    },
  });
  clients.attach(host);
  const view = recordingView();
  let app: ReturnType<typeof createDatabase> | undefined;
  let ids = 0;
  await defineUiPlugin(
    {
      mount(ctx) {
        app = createDatabase(ctx, view, { random: () => ((ids++ * 7) % 36) / 36 });
      },
    },
    host.transport,
  );
  const settle = async () => {
    for (let i = 0; i < 8; i++) {
      await host.settle();
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
  };
  await settle();
  if (!app) throw new Error("the plugin did not mount");
  await app.ready;
  await settle();
  return {
    host,
    view,
    app,
    clients,
    store,
    picks,
    shown: () => view.consoles.at(-1)?.model ?? null,
    settle,
  };
}

/** A saved SQLite connection and a PostgreSQL one, as the store keeps them. */
export const SAVED: Connection[] = [
  {
    id: "c-lite",
    name: "Notes",
    engine: "sqlite",
    host: "",
    port: null,
    database: "",
    user: "",
    ssl: "default",
    sslCa: "",
    file: "~/notes.db",
    tag: "none",
    readOnly: false,
  },
  {
    id: "c-prod",
    name: "Shop",
    engine: "postgresql",
    host: "db.example",
    port: 5432,
    database: "shop",
    user: "app",
    ssl: "require",
    sslCa: "",
    file: "",
    tag: "production",
    readOnly: false,
  },
];
