// Test harness for plugin authors: a fake runtime speaking the real protocol, over memory,
// with a mock bridge. No browser needed.
import {
  BridgeClient,
  type BridgeEvent,
  type BridgeRequest,
  browserStub,
  type StubHandlers,
} from "@endue-ai/bridge";
import type { HostMessage, PluginMessage, Transport } from "../protocol";

export interface TestHostOptions {
  pluginId: string;
  /** State the runtime hands the plugin at init, as after a reload. */
  state?: unknown;
  /** Bridge methods that answer; everything else is denied, as the core would. */
  handlers?: StubHandlers;
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
  /** Deliver a bridge event to the plugin. */
  emit(event: BridgeEvent): void;
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

  const toPlugin = (message: HostMessage) => queueMicrotask(() => handler?.(message));

  const transport: Transport = {
    send: (message: PluginMessage) => {
      if (message.type === "desk:hello") {
        toPlugin({ type: "desk:init", pluginId: options.pluginId, state });
      } else if (message.type === "desk:state") {
        state = message.state;
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
