// Mounts desk.views on the SDK's test host, over the stub's fixture items, with a view that records
// what the engine asks it to draw. The SDK is imported by its workspace path, as plugins/notes does.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  FIXTURE_NOW,
  type Permission,
  type PluginManifest,
  type View,
} from "../../../packages/bridge/src/index";
import { defineUiPlugin } from "../../../packages/plugin-sdk/src/index";
import { createTestHost, type TestHost } from "../../../packages/plugin-sdk/src/testing/index";
import {
  type ComponentModel,
  createEngine,
  type Engine,
  type NodeModel,
  type ViewModel,
} from "../ui/engine.js";

type Options = Parameters<typeof createTestHost>[0];
const root = join(import.meta.dirname, "../../..");

export const VIEWS = { permission: "view:manage" } as const;
export const CONNECTORS = { permission: "connector:manage" } as const;
export const LINKS = { permission: "shell:open", schemes: ["http", "https", "mailto"] } as const;
export const manifest = () =>
  JSON.parse(readFileSync(join(root, "plugins/views/plugin.json"), "utf8")) as PluginManifest;

/** A valid view from specs/view/v0/vectors. */
export const vector = (name: string) =>
  (
    JSON.parse(readFileSync(join(root, "specs/view/v0/vectors/valid", `${name}.json`), "utf8")) as {
      instance: View;
    }
  ).instance;

export interface RecordingView {
  drawn: Array<ViewModel | null>;
  updated: ComponentModel[];
  /** Draws and updates in the order they came. */
  log: Array<{ draw: ViewModel | null } | { update: ComponentModel }>;
  notices: string[];
  toasts: string[];
  draw(model: ViewModel | null): void;
  update(component: ComponentModel): void;
  notice(text: string): void;
  toast(text: string): void;
}

export function recordingView(): RecordingView {
  const view: RecordingView = {
    drawn: [],
    updated: [],
    log: [],
    notices: [],
    toasts: [],
    draw: (model) => {
      view.drawn.push(structuredClone(model));
      view.log.push({ draw: structuredClone(model) });
    },
    update: (component) => {
      view.updated.push(structuredClone(component));
      view.log.push({ update: structuredClone(component) });
    },
    notice: (text) => view.notices.push(text),
    toast: (text) => view.toasts.push(text),
  };
  return view;
}

/** Every component of a model, depth first, as the view would draw them now. */
export function components(node: NodeModel | undefined): ComponentModel[] {
  if (!node) return [];
  if (node.kind === "component") return [node];
  return node.children.flatMap(components);
}

export interface Mounted {
  host: TestHost;
  view: RecordingView;
  engine: Engine;
  /** desk.views.open, as the desk runs it. */
  open(args: Record<string, unknown>): Promise<unknown>;
  /** The components as drawn last: the last draw, with every update since applied. */
  shown(): ComponentModel[];
  /** The params of every call to one bridge method. */
  params(method: string): unknown[];
  settle(): Promise<void>;
}

export async function mount(
  options: {
    grants?: Permission[];
    handlers?: Options["handlers"];
    commands?: Options["commands"];
    views?: View[];
    prompt?: Options["prompt"];
  } = {},
): Promise<Mounted> {
  const host = createTestHost({
    pluginId: "desk.views",
    grants: options.grants ?? manifest().permissions ?? [],
    handlers: options.handlers ?? {},
    commands: options.commands ?? {},
    prompt: options.prompt,
    now: () => FIXTURE_NOW,
  });
  // The runtime registers what the manifest contributes, as desk.views, when it mounts.
  for (const { id, title } of manifest().contributes?.commands ?? [])
    await host.call("cmd.register", { id, title }, "desk.views");
  for (const view of options.views ?? []) await host.call("view.save", { view, scope: VIEWS });
  const view = recordingView();
  let engine: Engine | undefined;
  await defineUiPlugin(
    {
      mount(ctx) {
        engine = createEngine(ctx, view, {
          now: () => Date.parse(FIXTURE_NOW),
          zone: "Asia/Seoul",
          locale: "en-US",
        });
      },
    },
    host.transport,
  );
  const settle = async () => {
    for (let i = 0; i < 6; i++) await host.settle();
  };
  await settle();
  if (!engine) throw new Error("the plugin did not mount");
  const shown = () => {
    let drawn: ComponentModel[] = [];
    for (const entry of view.log) {
      if ("draw" in entry) drawn = components(entry.draw?.root);
      else drawn = drawn.map((c) => (c.path === entry.update.path ? entry.update : c));
    }
    return drawn;
  };
  return {
    host,
    view,
    engine,
    open: async (args) => {
      const result = host.invoke("desk.views.open", args);
      await settle();
      return result;
    },
    shown,
    params: (method) => host.calls.filter((c) => c.method === method).map((c) => c.params),
    settle,
  };
}
