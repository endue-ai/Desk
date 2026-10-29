// Test harness for plugin authors: a fake runtime speaking the real protocol, over memory,
// with a mock bridge. No browser needed.
import {
  BridgeClient,
  type BridgeEvent,
  type BridgeRequest,
  browserStub,
  type CmdAnsweredData,
  type StubHandlers,
  stubCommands,
} from "@endue-ai/bridge";
import type { HostMessage, KeyPress, PluginMessage, ThemeState, Transport } from "../protocol";

export interface TestHostOptions {
  pluginId: string;
  /** State the runtime hands the plugin at init, as after a reload. */
  state?: unknown;
  /** Bridge methods that answer; everything else is denied, as the core would. */
  handlers?: StubHandlers;
  /**
   * Commands the desk provides in the registry (cmd.*), which the plugin may run with
   * ctx.commands.run; ids nobody registered are unknown_command, as in the core.
   */
  commands?: Record<string, (args: unknown) => unknown>;
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
  /** Deliver a bridge event to the plugin. */
  emit(event: BridgeEvent): void;
  /** Send the plugin a request by name (desk.files.visit, say) and resolve with its answer. */
  command(name: string, args?: unknown): Promise<unknown>;
  /** Invoke a command the plugin registered, as the desk would, and resolve with its answer. */
  invoke(id: string, args?: Record<string, unknown>): Promise<unknown>;
  /** Hand the plugin a theme, as the runtime does at start and on every change. */
  theme(theme: ThemeState): void;
  /** Wait until every call the plugin made has been answered. */
  settle(): Promise<void>;
}

export function createTestHost(options: TestHostOptions): TestHost {
  const me = options.pluginId;
  const answers = new Map<string, (data: CmdAnsweredData) => void>();
  // Route the registry's events as the runtime does: to the provider, and to the caller.
  const registry = stubCommands((event: BridgeEvent) => {
    if (event.event === "cmd.invoked") {
      const provider = registry.providerOf(event.data.id);
      if (provider === me) toPlugin({ type: "desk:event", event });
      else if (provider === "desk") void answerForDesk(event.data);
    } else if (event.event === "cmd.answered") {
      if (event.data.caller === me) toPlugin({ type: "desk:event", event });
      else answers.get(event.data.invocationId)?.(event.data);
    }
  });
  const stub = browserStub({ ...registry.handlers, ...options.handlers });
  const bridge = new BridgeClient(stub);
  for (const id of Object.keys(options.commands ?? {})) {
    void registry.handlers["cmd.register"]?.({ id, title: id }, undefined);
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
    emit: (event) => handler?.({ type: "desk:event", event }),
    settle: async () => {
      while (inFlight.size > 0) await Promise.all(inFlight);
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
}
