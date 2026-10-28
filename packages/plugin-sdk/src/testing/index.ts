// Test harness for plugin authors: a fake runtime speaking the real protocol, over memory,
// with a mock bridge. No browser needed.
import {
  BridgeClient,
  type BridgeEvent,
  type BridgeRequest,
  browserStub,
  type StubHandlers,
} from "@endue-ai/bridge";
import type { HostMessage, KeyPress, PluginMessage, ThemeState, Transport } from "../protocol";

export interface TestHostOptions {
  pluginId: string;
  /** State the runtime hands the plugin at init, as after a reload. */
  state?: unknown;
  /** Bridge methods that answer; everything else is denied, as the core would. */
  handlers?: StubHandlers;
  /** Desk commands the plugin may run (ctx.commands.run); everything else is unknown_command. */
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
  /** Every command the plugin ran, in order. */
  readonly ran: ReadonlyArray<{ name: string; args: unknown }>;
  /** Every key the plugin passed on to the desk. */
  readonly keys: readonly KeyPress[];
  /** Deliver a bridge event to the plugin. */
  emit(event: BridgeEvent): void;
  /** Deliver one of the plugin's commands and resolve with its answer, as the runtime would. */
  command(name: string, args?: unknown): Promise<unknown>;
  /** Hand the plugin a theme, as the runtime does at start and on every change. */
  theme(theme: ThemeState): void;
  /** Wait until every call the plugin made has been answered. */
  settle(): Promise<void>;
}

export function createTestHost(options: TestHostOptions): TestHost {
  const stub = browserStub(options.handlers ?? {});
  const bridge = new BridgeClient(stub);
  const calls: BridgeRequest[] = [];
  const inFlight = new Set<Promise<void>>();
  let handler: ((message: HostMessage) => void) | undefined;
  let state = options.state;
  let batches = 0;
  let closed = false;
  let visible: boolean | undefined;
  let nextCall = 1;
  const ran: Array<{ name: string; args: unknown }> = [];
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
      } else if (message.type === "desk:run") {
        ran.push({ name: message.name, args: message.args });
        const run = options.commands?.[message.name];
        const work = Promise.resolve()
          .then(() => {
            if (!run)
              throw Object.assign(new Error(`no command ${message.name}`), {
                code: "unknown_command",
              });
            return run(message.args);
          })
          .then(
            (result) => toPlugin({ type: "desk:ran", call: message.call, ok: true, result }),
            (error: { code?: string; message?: string }) =>
              toPlugin({
                type: "desk:ran",
                call: message.call,
                ok: false,
                error: { code: error.code ?? "failed", message: error.message ?? "" },
              }),
          );
        inFlight.add(work);
        void work.finally(() => inFlight.delete(work));
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
    ran,
    keys,
    command: (name, args) =>
      new Promise((resolve, reject) => {
        const call = nextCall++;
        replies.set(call, { resolve, reject });
        toPlugin({ type: "desk:command", name, args, call });
      }),
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
