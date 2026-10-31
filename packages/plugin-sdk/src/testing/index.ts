// Test harness for plugin authors: a fake runtime speaking the real protocol, over memory,
// with a mock bridge. No browser needed.
import {
  BridgeClient,
  type BridgeEvent,
  type BridgeMethod,
  type BridgeRequest,
  browserStub,
  type CmdAnsweredData,
  type ErrorCode,
  type Grant,
  type Item,
  type ItemSource,
  type LogEntry,
  type ParamsOf,
  type Permission,
  type PermPromptData,
  type ResultOf,
  StubError,
  type StubHandlers,
  type StubSurface,
  stubCommands,
} from "@endue-ai/bridge";
import type { HostMessage, KeyPress, PluginMessage, ThemeState, Transport } from "../protocol";

export interface TestHostOptions {
  pluginId: string;
  /** State the runtime hands the plugin at init, as after a reload. */
  state?: unknown;
  /**
   * Bridge methods answered your way, ahead of the stub's copy of the core (cmd.*, perm.*,
   * settings.*, log.*, events.*, ui.surface.*); they check no grants. Any other method is
   * `unsupported`.
   */
  handlers?: StubHandlers;
  /**
   * Commands the desk provides in the registry (cmd.*), which the plugin may run with
   * ctx.commands.run; ids nobody registered are unknown_command, as in the core.
   */
  commands?: Record<string, (args: unknown) => unknown>;
  /** Settings at start: a bare key is the plugin's own, `owner/key` another caller's. */
  settings?: Record<string, unknown>;
  /** The plugin's grants at start. */
  grants?: Permission[];
  /** Other callers' grants at start: a prompter holding perm:manage, owners to list, ... */
  callers?: Record<string, Permission[]>;
  /** The person's answer to perm.request when no caller holds perm:manage; granted by default. */
  prompt?: (data: PermPromptData) => boolean;
  /** The core's clock, for log entries and grants. */
  now?: () => string;
  /** Methods that fail with the given code whoever serves them. */
  refuse?: Partial<Record<BridgeMethod, ErrorCode>>;
}

export interface TestHost {
  /** Pass this to `defineUiPlugin(plugin, host.transport)`. */
  readonly transport: Transport;
  /** Every bridge request the plugin made, in order. */
  readonly calls: readonly BridgeRequest[];
  /** How many postMessage batches carried those calls. */
  readonly batches: number;
  /** The last state the plugin saved. */
  readonly state: unknown;
  /** Whether the plugin closed its surface. */
  readonly closed: boolean;
  /** Whether the plugin's surface is shown, after its last show() or hide(); undefined before. */
  readonly visible: boolean | undefined;
  /** Every command the plugin ran (cmd.invoke), in order. */
  readonly ran: ReadonlyArray<{ name: string; args: unknown }>;
  /** Every key the plugin passed on to the desk. */
  readonly keys: readonly KeyPress[];
  /** Every setting: the plugin's own by key, other callers' as `owner/key`. */
  readonly settings: Record<string, unknown>;
  /** The plugin's grants, oldest first. */
  readonly grants: readonly Grant[];
  /** Every log entry, whoever wrote it, oldest first. */
  readonly logged: readonly LogEntry[];
  /** The surfaces the plugin has open (ui.surface.open). */
  readonly surfaces: readonly StubSurface[];
  /** Call the bridge as the desk, or as `caller`: how a test makes other callers act. */
  call<M extends BridgeMethod>(
    method: M,
    params: ParamsOf<M>,
    caller?: string,
  ): Promise<ResultOf<M>>;
  /** Deliver a bridge event to the plugin, whoever it is for. */
  emit(event: BridgeEvent): void;
  /** Send the plugin a request by name (desk.files.visit, say) and resolve with its answer. */
  command(name: string, args?: unknown): Promise<unknown>;
  /** Invoke a command the plugin registered, as the desk would, and resolve with its answer. */
  invoke(id: string, args?: Record<string, unknown>): Promise<unknown>;
  /** Hand the plugin a theme, as the runtime does at start and on every change. */
  theme(theme: ThemeState): void;
  /** Put an item in the stub's index, or replace it, as a sync would: subscribers hear data.changed. */
  upsert(item: Item): void;
  /** Take an item out of the index (false when it was not there); subscribers hear data.changed. */
  remove(source: ItemSource, id: string): boolean;
  /** Wait until every call the plugin made has been answered. */
  settle(): Promise<void>;
}

export function createTestHost(options: TestHostOptions): TestHost {
  const me = options.pluginId;
  const answers = new Map<string, (data: CmdAnsweredData) => void>();
  const settings = Object.entries(options.settings ?? {}).map(([name, value]) => {
    const [owner, key] = name.includes("/") ? name.split("/", 2) : [me, name];
    return { owner: owner ?? me, key: key ?? name, value };
  });
  const grants = { ...options.callers, [me]: options.grants ?? [] };
  // Route the core's events as the runtime does: to the plugins the core names, and the desk's own.
  const registry = stubCommands(
    (event: BridgeEvent) => {
      if (registry.audience(event).includes(me)) toPlugin({ type: "desk:event", event });
      if (event.event === "cmd.invoked" && registry.providerOf(event.data.id) === "desk")
        void answerForDesk(event.data);
      else if (event.event === "cmd.answered" && event.data.caller === "desk")
        answers.get(event.data.invocationId)?.(event.data);
    },
    { grants, settings, prompt: options.prompt, now: options.now },
  );
  const refused = Object.fromEntries(
    Object.entries(options.refuse ?? {}).map(([method, code]) => [
      method,
      (params: { scope?: Permission }) => {
        const scope = code === "permission_denied" ? params.scope : undefined;
        throw new StubError(code, `${method} is refused by the test`, scope);
      },
    ]),
  ) as StubHandlers;
  const stub = browserStub({ ...registry.handlers, ...options.handlers, ...refused });
  const bridge = new BridgeClient(stub);
  for (const id of Object.keys(options.commands ?? {})) {
    void registry.handlers["cmd.register"]({ id, title: id }, undefined);
  }
  const answerForDesk = async (data: { invocationId: string; id: string; args?: unknown }) => {
    const { invocationId } = data;
    try {
      const result = await options.commands?.[data.id]?.(data.args ?? {});
      await bridge.call("cmd.answer", {
        invocationId,
        ...(result === undefined ? {} : { result }),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await bridge.call("cmd.answer", { invocationId, error: { code: "failed", message } });
    }
  };
  const calls: BridgeRequest[] = [];
  const inFlight = new Set<Promise<void>>();
  let handler: ((message: HostMessage) => void) | undefined;
  let state = options.state;
  let batches = 0;
  let closed = false;
  let visible: boolean | undefined;
  let nextCall = 1;
  const keys: KeyPress[] = [];
  const replies = new Map<number, { resolve(v: unknown): void; reject(e: unknown): void }>();

  const toPlugin = (message: HostMessage) => queueMicrotask(() => handler?.(message));

  const transport: Transport = {
    send: (message: PluginMessage) => {
      if (message.type === "desk:hello") {
        toPlugin({ type: "desk:init", pluginId: options.pluginId, state });
      } else if (message.type === "desk:state") {
        state = message.state;
      } else if (message.type === "desk:close") {
        closed = true;
      } else if (message.type === "desk:visible") {
        visible = message.visible;
      } else if (message.type === "desk:key") {
        keys.push(message.key);
      } else if (message.type === "desk:reply") {
        const reply = replies.get(message.call);
        replies.delete(message.call);
        if (message.ok) reply?.resolve(message.result);
        else reply?.reject(new Error(`${message.error?.code}: ${message.error?.message}`));
      } else {
        batches++;
        calls.push(...message.calls);
        const work = Promise.all(
          message.calls.map(async (request) => ({
            id: request.id,
            response: await bridge.forward(request, options.pluginId),
          })),
        ).then((results) => toPlugin({ type: "desk:results", results }));
        inFlight.add(work);
        void work.finally(() => inFlight.delete(work));
      }
    },
    listen: (h) => {
      handler = h;
      return () => {
        handler = undefined;
      };
    },
  };

  return {
    transport,
    calls,
    get batches() {
      return batches;
    },
    get closed() {
      return closed;
    },
    get visible() {
      return visible;
    },
    get ran() {
      return calls.flatMap((request) =>
        request.method === "cmd.invoke"
          ? [{ name: request.params.id, args: request.params.args }]
          : [],
      );
    },
    keys,
    command: (name, args) =>
      new Promise((resolve, reject) => {
        const call = nextCall++;
        replies.set(call, { resolve, reject });
        toPlugin({ type: "desk:command", name, args, call });
      }),
    invoke: async (id, args) => {
      const { invocationId } = await bridge.call("cmd.invoke", {
        id,
        ...(args ? { args } : {}),
        scope: { permission: "cmd:invoke", ids: [id] },
      });
      const data = await new Promise<CmdAnsweredData>((resolve) =>
        answers.set(invocationId, resolve),
      );
      answers.delete(invocationId);
      if (data.ok) return data.result;
      throw new Error(`${data.error?.code}: ${data.error?.message}`);
    },
    theme: (theme) => toPlugin({ type: "desk:theme", theme }),
    get state() {
      return state;
    },
    get settings() {
      const all = registry.state().settings;
      return Object.fromEntries(
        all.map((s) => [s.owner === me ? s.key : `${s.owner}/${s.key}`, s.value]),
      );
    },
    get grants() {
      return registry.state().grants.flatMap((g) => (g.caller === me ? [g.grant] : []));
    },
    get logged() {
      return registry.state().log;
    },
    get surfaces() {
      return registry.state().surfaces.filter((s) => s.caller === me);
    },
    call: (method, params, caller) => bridge.call(method, params, caller ? { caller } : {}),
    emit: (event) => handler?.({ type: "desk:event", event }),
    upsert: (item) => registry.upsert(item),
    remove: (source, id) => registry.remove(source, id),
    settle: async () => {
      while (inFlight.size > 0) await Promise.all(inFlight);
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
}
