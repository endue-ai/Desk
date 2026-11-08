// Mounts endue.computer on the SDK's test host: computer.* answered as desk-core answers it on its
// fake (Safari in front, TextEdit behind), each call kept with its params, and a view that keeps
// every model it was asked to draw. The SDK is imported by its workspace path.
import { StubError } from "../../../packages/bridge/src/index";
import { defineUiPlugin } from "../../../packages/plugin-sdk/src/index";
import { createTestHost, type TestHost } from "../../../packages/plugin-sdk/src/testing/index";
import { createComputer } from "../ui/app.js";
import type { Shown } from "../ui/page.js";

export type Handlers = NonNullable<Parameters<typeof createTestHost>[0]["handlers"]>;
export type Call = { method: string; params: Record<string, unknown> };

const safari = { pid: 412, name: "Safari", bundleId: "com.apple.Safari", active: true };
const textedit = { pid: 530, name: "TextEdit", bundleId: "com.apple.TextEdit", active: false };
export const APPS = [safari, textedit].map((a) => ({ ...a, hidden: false, regular: true }));

/** An act's answer, as the core gives it. */
const done = (summary: string) => ({ summary, events: 3, app: APPS[0] });

/** computer.* over the fake, recording every call; `over` replaces any. */
export function computerHandlers(calls: Call[], over: Handlers = {}): Handlers {
  const kept =
    (method: string, answer: (params: Record<string, unknown>) => unknown) =>
    (params: Record<string, unknown>) => {
      calls.push({ method, params });
      return answer(params);
    };
  const all: Record<string, (params: Record<string, unknown>) => unknown> = {
    "computer.permissions.status": () => ({
      accessibility: true,
      screenRecording: false,
      bundleId: "ai.endue.desk",
      stopped: false,
    }),
    "computer.permissions.request": () => ({ granted: false }),
    "computer.permissions.open": () => ({}),
    "computer.apps.list": () => ({ apps: APPS }),
    "computer.screenshot": () => ({
      image: "iVBORw0KGgo=",
      mediaType: "image/png",
      width: 1280,
      height: 800,
      scale: 0.889,
      bounds: { x: 0, y: 0, width: 1440, height: 900 },
    }),
    "computer.ax.tree": () => ({
      pid: 412,
      app: APPS[0],
      nodes: [
        {
          path: [0],
          role: "AXWindow",
          title: "Start Page",
          enabled: true,
          focused: true,
          actions: [],
        },
        {
          path: [0, 0],
          role: "AXButton",
          title: "Send",
          frame: { x: 100, y: 200, width: 80, height: 24 },
          enabled: true,
          focused: false,
          actions: ["AXPress"],
        },
      ],
      truncated: false,
    }),
    "computer.ax.find": () => ({ pid: 412, elements: [] }),
    "computer.ax.perform": () => done("AXPress on element 0/0 of pid 412 in Safari"),
    "computer.input.click": (p) => done(`click left at (${p.x}, ${p.y}) in Safari`),
    "computer.input.type": () => done("type in Safari"),
    "computer.input.keys": () => done("press cmd+t in Safari"),
    "computer.input.scroll": () => done("scroll 3 lines down in Safari"),
    "computer.apps.activate": () => done("activate the app of pid 530"),
    "computer.apps.launch": () => done("launch com.apple.Notes"),
    "computer.stop": (p) => ({ stopped: p.resume !== true }),
  };
  const handlers: Handlers = {};
  for (const [method, answer] of Object.entries(all)) {
    (handlers as Record<string, unknown>)[method] = kept(method, answer);
  }
  return { ...handlers, ...over };
}

/** A view that keeps what it was asked to draw and say. */
export function recordingView() {
  const shown: Shown[] = [];
  const said: string[] = [];
  return {
    shown,
    said,
    last: () => shown.at(-1) as Shown,
    view: { show: (s: Shown) => shown.push(s), status: (text: string) => said.push(text) },
  };
}

/** endue.computer mounted, with agent:eris allowed to run its commands. */
export async function mount(
  options: { handlers?: Handlers; settings?: Record<string, unknown> } = {},
) {
  const calls: Call[] = [];
  const recorded = recordingView();
  const host: TestHost = createTestHost({
    pluginId: "endue.computer",
    handlers: computerHandlers(calls, options.handlers),
    settings: options.settings,
    callers: { "agent:eris": [{ permission: "cmd:invoke", ids: ["endue.computer.*"] }] },
  });
  let app: ReturnType<typeof createComputer> | undefined;
  defineUiPlugin(
    {
      async mount(ctx) {
        app = createComputer(ctx as never, recorded.view);
        await app.ready;
      },
    },
    host.transport,
  );
  await host.settle();
  if (!app) throw new Error("endue.computer did not mount");
  const computer = (method: string) => calls.filter((c) => c.method === method);
  /** Invoke a tool as `caller`, the way Eris's tool call reaches the plugin. */
  const invokeAs = async (caller: string, id: string, args: Record<string, unknown> = {}) => {
    const scope = { permission: "cmd:invoke" as const, ids: [id] };
    const { invocationId } = await host.call("cmd.invoke", { id, args, scope }, caller);
    await host.settle();
    await new Promise((resolve) => setTimeout(resolve, 5));
    await host.settle();
    return invocationId;
  };
  return { host, app, calls, computer, invokeAs, ...recorded };
}

export { StubError };
