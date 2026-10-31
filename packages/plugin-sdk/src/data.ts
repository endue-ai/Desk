// ctx.data and ctx.views: thin wrappers over the bridge's data.* and view.* (specs/bridge/v0, ADR
// 0032). Reads carry a data:read scope, the narrowest the query allows unless the plugin passes one;
// views carry view:manage. The core checks both against the plugin's own grants.
import type {
  BridgeEvent,
  BridgeMethod,
  DataReadPermission,
  Item,
  ItemChange,
  ItemPage,
  ItemQuery,
  ItemSource,
  ParamsOf,
  ResultOf,
  View,
  ViewManagePermission,
  ViewSummary,
} from "@endue-ai/bridge";

/** The desk's item index (data.*): what connectors brought in, as far as the grants reach. */
export interface PluginData {
  /** One page of the items a query matches (data.query). */
  query(query: ItemQuery, options?: { scope?: DataReadPermission }): Promise<ItemPage>;
  /** One item by its source and id, or undefined when there is none (data.get). */
  get(source: ItemSource, id: string, options?: { scope?: DataReadPermission }): Promise<Item | undefined>;
  /**
   * Hear the changes to the items a query selects (data.subscribe); resolves with the function that
   * unsubscribes, which sends data.unsubscribe once however often it is called.
   */
  subscribe(
    query: ItemQuery,
    listener: (changes: ItemChange[]) => void,
    options?: { scope?: DataReadPermission },
  ): Promise<() => void>;
}

/** The person's views (view.*); every call needs a `view:manage` grant. */
export interface PluginViews {
  list(): Promise<ViewSummary[]>;
  get(id: string): Promise<View>;
  /** Write a view, new or replacing the one with its id; an invalid one is invalid_params. */
  save(view: View): Promise<void>;
  remove(id: string): Promise<void>;
}

/** The bridge calls and events the groups need. */
export interface DataBridge {
  call<M extends BridgeMethod>(method: M, params: ParamsOf<M>): Promise<ResultOf<M>>;
  onEvent(listener: (event: BridgeEvent) => void): () => void;
}

const VIEWS: ViewManagePermission = { permission: "view:manage" };

/**
 * The narrowest data:read scope a query needs: its kinds, and the connectors its sources name
 * (`connector/instance` is its connector). Without kinds or sources, every one.
 */
export function readScope(query: Pick<ItemQuery, "kinds" | "sources">): DataReadPermission {
  const connectors = query.sources?.map((source) => source.split("/")[0] ?? source);
  return {
    permission: "data:read",
    ...(query.kinds ? { kinds: [...query.kinds] } : {}),
    ...(connectors ? { sources: [...new Set(connectors)] } : {}),
  };
}

export function dataFor(bridge: DataBridge): { data: PluginData; views: PluginViews } {
  const data: PluginData = {
    query: (query, options = {}) =>
      bridge.call("data.query", { query, scope: options.scope ?? readScope(query) }),
    get: async (source, id, options = {}) => {
      const scope = options.scope ?? readScope({ sources: [source.connector] });
      return (await bridge.call("data.get", { source, id, scope })).item;
    },
    subscribe: async (query, listener, options = {}) => {
      const scope = options.scope ?? readScope(query);
      const { subscriptionId } = await bridge.call("data.subscribe", { query, scope });
      const off = bridge.onEvent((event) => {
        if (event.event === "data.changed" && event.data.subscriptionId === subscriptionId)
          listener(event.data.changes);
      });
      let on = true;
      return () => {
        if (!on) return;
        on = false;
        off();
        bridge.call("data.unsubscribe", { subscriptionId }).catch(() => {});
      };
    },
  };
  const views: PluginViews = {
    list: async () => (await bridge.call("view.list", { scope: VIEWS })).views,
    get: async (id) => (await bridge.call("view.get", { id, scope: VIEWS })).view,
    save: async (view) => {
      await bridge.call("view.save", { view, scope: VIEWS });
    },
    remove: async (id) => {
      await bridge.call("view.remove", { id, scope: VIEWS });
    },
  };
  return { data, views };
}
