// Mounts the permissions plugin on the SDK's test host with a view that records what it was asked to
// show. The SDK is imported by its workspace path: plugin folders are not workspace packages yet.
import type { CallerGrant, Permission, PluginInfo } from "../../../packages/bridge/src/index";
import { defineUiPlugin } from "../../../packages/plugin-sdk/src/index";
import { createTestHost, type TestHost } from "../../../packages/plugin-sdk/src/testing/index";
import { createPermissions } from "../ui/controller.js";
import type { GrantList, PromptModel } from "../ui/model.js";

export type Handlers = NonNullable<Parameters<typeof createTestHost>[0]["handlers"]>;

export interface RecordingView {
  lists: GrantList[];
  prompts: Array<PromptModel | null>;
  statuses: string[];
  grants(list: GrantList): void;
  prompt(model: PromptModel | null): void;
  status(text: string): void;
}

export function recordingView(): RecordingView {
  const view: RecordingView = {
    lists: [],
    prompts: [],
    statuses: [],
    grants: (list) => view.lists.push(list),
    prompt: (model) => view.prompts.push(model),
    status: (text) => view.statuses.push(text),
  };
  return view;
}

export interface Mounted {
  host: TestHost;
  view: RecordingView;
  app: ReturnType<typeof createPermissions>;
  /** The methods the plugin called, in order. */
  methods(): string[];
  /** The params of every call to one method. */
  params(method: string): unknown[];
  /** Wait until the plugin is quiet: calls answered and follow-up calls answered too. */
  settle(): Promise<void>;
}

export async function mount(handlers: Handlers): Promise<Mounted> {
  const host = createTestHost({ pluginId: "endue.permissions", handlers });
  const view = recordingView();
  let app: ReturnType<typeof createPermissions> | undefined;
  await defineUiPlugin(
    {
      async mount(ctx) {
        app = createPermissions(ctx, view);
        await app.ready;
      },
    },
    host.transport,
  );
  const settle = async () => {
    for (let i = 0; i < 4; i++) await host.settle();
  };
  await settle();
  if (!app) throw new Error("the plugin did not mount");
  return {
    host,
    view,
    app,
    methods: () => host.calls.map((call) => call.method),
    params: (method) => host.calls.filter((c) => c.method === method).map((c) => c.params),
    settle,
  };
}

export const plugin = (id: string, name: string, kind: "ui" | "logic" | "tool"): PluginInfo => ({
  id,
  status: "ready",
  enabled: true,
  builtIn: false,
  revision: 1,
  manifest: { id, name, version: "0.1.0", kind, entry: "ui/index.html" },
});

export const grant = (
  caller: string,
  grantId: string,
  permission: Permission,
  duration: "once" | "session" | "always" = "session",
): CallerGrant => ({
  caller,
  grant: { grantId, permission, duration, grantedAt: "2026-10-29T09:00:00Z" },
});

export const MANAGE = { permission: "perm:manage" } as const;
