// Mounts the chat plugin on the SDK's test host over an in-memory index of message items
// (chat-index.ts), with a view that records what it was asked to show, and three chat connectors
// (acme.slack, acme.discord, acme.bridge) whose actions are desk commands that change the index as
// a real connector's sync would. The SDK is imported by its workspace path: plugin folders are not
// workspace packages yet.
import type {
  CmdInvokePermission,
  DataReadPermission,
  Item,
  ItemKind,
} from "../../../packages/bridge/src/index";
import { defineUiPlugin } from "../../../packages/plugin-sdk/src/index";
import { createTestHost, type TestHost } from "../../../packages/plugin-sdk/src/testing/index";
import { createChat } from "../ui/chat.js";
import { plain } from "../ui/markup.js";
import type { Chrome, Main, Row, ThreadModel } from "../ui/present.js";
import { sample } from "./chat-fixtures";
import { connectorActions, type Handlers, type Index, index, NOW } from "./chat-index";

export { type Handlers, type Index, index, NOW };

type Options = Parameters<typeof createTestHost>[0];
export type Commands = NonNullable<Options["commands"]>;
type Sidebar = ReturnType<typeof import("../ui/present.js").sidebarOf>;

export const CONNECTORS = ["acme.slack", "acme.discord", "acme.bridge"];
export const ACTIONS = ["send", "react", "read", "edit", "delete"] as const;

export interface RecordingView {
  chromes: Chrome[];
  sidebars: Sidebar[];
  mains: Main[];
  threads: Array<ThreadModel | null>;
  statuses: string[];
  focused: string[];
  chrome(model: Chrome): void;
  sidebar(model: Sidebar): void;
  main(model: Main): void;
  thread(model: ThreadModel | null): void;
  status(text: string): void;
  focus(where: string): void;
  /** The navigation now: `group: #name(unread/mentions)` per conversation. */
  nav(): string[];
  /** The rows of the main area now (all panes), one line each: `author: text`, days as [label]. */
  shown(): string[];
  /** The main area now. */
  last(): Main;
}

const line = (row: Row) => {
  if (row.type === "day") return `[${row.label}]`;
  if (row.type === "new") return "--new--";
  const m = row.message;
  const text = m.blocks.map((b) => (b.t === "pre" ? b.v : plain(b.c))).join(" ");
  return `${m.author}: ${text}${m.pending ? ` (${m.pending})` : ""}`;
};

export function recordingView(): RecordingView {
  const view: RecordingView = {
    chromes: [],
    sidebars: [],
    mains: [],
    threads: [],
    statuses: [],
    focused: [],
    chrome: (m) => view.chromes.push(m),
    sidebar: (m) => view.sidebars.push(m),
    main: (m) => view.mains.push(m),
    thread: (m) => view.threads.push(m),
    status: (text) => view.statuses.push(text),
    focus: (where) => view.focused.push(where),
    nav: () =>
      (view.sidebars.at(-1)?.groups ?? []).flatMap((g) =>
        g.rows.map(
          (r) =>
            `${g.title}: ${r.kind === "dm" || r.kind === "group" ? "" : "#"}${r.name}(${r.unread}/${r.mentions})`,
        ),
      ),
    last: () => view.mains.at(-1) as Main,
    shown: () => {
      const main = view.mains.at(-1);
      if (!main) return [];
      if (main.layout === "timeline") return main.rows.map(line);
      const panes =
        main.layout === "conversation"
          ? main.pane
            ? [main.pane]
            : []
          : main.layout === "inbox"
            ? main.cards
            : main.columns;
      return panes.flatMap((p) => p.rows.map(line));
    },
  };
  return view;
}

export interface Mounted {
  host: TestHost;
  view: RecordingView;
  app: ReturnType<typeof createChat>;
  index: Index;
  notices: Array<{ title: string; body: string }>;
  store: Record<string, unknown>;
  params(method: string): unknown[];
  ran(name: string): unknown[];
  settle(): Promise<void>;
}

export interface MountOptions {
  items?: Item[];
  handlers?: Handlers;
  commands?: Commands;
  /** Which actions every connector provides; all five by default. */
  actions?: ReadonlyArray<(typeof ACTIONS)[number]>;
  settings?: Record<string, unknown>;
  init?: Record<string, unknown>;
  store?: Record<string, unknown>;
  pick?: (args: unknown) => string | undefined;
  /** A DOM view to draw into as well (view.js on jsdom), made with a handle on the app. */
  dom?: (app: () => ReturnType<typeof createChat> | undefined) => View;
}

type View = Parameters<typeof createChat>[1];

/** Every call reaches the recording view and, when there is one, the DOM view too. */
function tee(record: RecordingView, dom: View | undefined): View {
  if (!dom) return record;
  return {
    chrome(m) {
      record.chrome(m);
      dom.chrome(m);
    },
    sidebar(m) {
      record.sidebar(m);
      dom.sidebar(m);
    },
    main(m) {
      record.main(m);
      dom.main(m);
    },
    thread(m) {
      record.thread(m);
      dom.thread(m);
    },
    status(t) {
      record.status(t);
      dom.status(t);
    },
    focus(w) {
      record.focus(w);
      dom.focus(w);
    },
  };
}

export const READ: DataReadPermission = { permission: "data:read", kinds: ["message"] };
export const INVOKE: CmdInvokePermission = {
  permission: "cmd:invoke",
  ids: [...ACTIONS.map((a) => `*.chat.${a}`), "desk.palette.pick", "desk.connectors.open"],
};

/** connector.list answering these installed connectors, `[id, title, kinds]`, none connected. */
export const installed = (...connectors: Array<[string, string, ItemKind[]]>): Handlers => ({
  "connector.list": () => ({
    connectors: connectors.map(([id, title, kinds]) => ({
      id,
      title,
      instances: [],
      resources: kinds.map((kind) => ({ kind })),
    })),
  }),
});

export async function mount(options: MountOptions = {}): Promise<Mounted> {
  const store = options.store ?? {};
  const notices: Array<{ title: string; body: string }> = [];
  const data = index(options.items ?? sample());
  const commands: Commands = {
    "desk.palette.pick": (args) => {
      const answer = options.pick?.(args);
      if (answer === undefined) throw new Error("nothing was picked");
      return answer;
    },
  };
  for (const connector of CONNECTORS) {
    const all = connectorActions(data, connector);
    for (const action of options.actions ?? ACTIONS)
      commands[`${connector}.chat.${action}`] = all[action] as never;
  }
  Object.assign(commands, options.commands);
  const host = createTestHost({
    pluginId: "endue.chat",
    handlers: {
      "store.get": ({ key }) => (key in store ? { value: store[key] } : {}),
      "store.set": ({ key, value }) => {
        store[key] = value;
        return {};
      },
      "init.get": () => ({ profile: "default", settings: options.init ?? {} }),
      "ui.notify": (params) => {
        notices.push({ title: params.title, body: params.body ?? "" });
        return { notificationId: `n${notices.length}` };
      },
      "shell.open": () => ({ opened: true }),
      ...data.handlers,
      ...options.handlers,
    },
    commands,
    settings: options.settings,
    grants: [READ, INVOKE, { permission: "ui:notify" }, { permission: "connector:manage" }],
    now: () => new Date(NOW).toISOString(),
  });
  data.attach(host);
  const view = recordingView();
  let app: ReturnType<typeof createChat> | undefined;
  const drawn = tee(
    view,
    options.dom?.(() => app),
  );
  await defineUiPlugin(
    {
      async mount(ctx) {
        app = createChat(ctx, drawn, { now: () => NOW, zone: "Asia/Seoul", saveMs: 0 });
        await app.start();
      },
    },
    host.transport,
  );
  const settle = async () => {
    for (let i = 0; i < 8; i++) await host.settle();
    await new Promise((resolve) => setTimeout(resolve, 5));
    for (let i = 0; i < 4; i++) await host.settle();
  };
  if (!app) throw new Error("the plugin did not mount");
  return {
    host,
    view,
    app,
    index: data,
    notices,
    store,
    params: (method) => host.calls.filter((c) => c.method === method).map((c) => c.params),
    ran: (name) => host.ran.filter((r) => r.name === name).map((r) => r.args),
    settle,
  };
}
