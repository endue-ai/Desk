/**
 * The desk the window commands' tests run on (ADR 0269): the bridge stub's core and desk-wm as
 * WebAssembly on a 1440 × 900 app, three windows on the desktop in front (notes in use, calendar
 * snapped to the left half, reference floating) and one on desktop 2. Only tests import this.
 */
import { BridgeClient, browserStub, stubCommands } from "@endue-ai/bridge";
import { Commands } from "../commands";
import type { DesktopId, SurfacePlacement } from "../modes/types";
import { windowsOf } from "../shell/actions";
import type { ShellCtx } from "../shell/context";
import { type CopyKey, t } from "../shell/copy";
import { Store, sampleState } from "../shell/state";
import { testWindowManager } from "../wm/testing";
import type { Edit } from "../wm/types";
import { rectIn, takeDesk } from "../wm/view";
import { defineControlCommands } from "./control";
import { defineFrameCommands } from "./frame";

const epoch = Date.parse("2026-11-18T03:00:00.000Z");

export const at = (id: string, x: number, y: number, more: Partial<SurfacePlacement> = {}) => ({
  id,
  plugin: "endue.notes",
  x,
  y,
  w: 400,
  h: 300,
  pinned: false,
  ...more,
});

const place = (desktop: DesktopId, placement: SurfacePlacement): Edit => ({
  op: "place",
  desktop,
  placement,
});

/** The desk, with every window command defined; `keep` answers whether a close may go on. */
export async function windowDesk(keep = () => Promise.resolve(true)) {
  const registry = stubCommands((event) => stub.emit(event));
  const stub = browserStub({ ...registry.handlers });
  const client = new BridgeClient(stub);
  const commands = new Commands(client);
  const store = new Store({ ...sampleState("en", epoch), drawer: [] });
  const wm = testWindowManager();
  wm.connect((published) => takeDesk(store, published));
  await wm.edit([
    place("1", at("notes", 300, 200)),
    place("1", at("calendar", 10, 20, { fill: "left", restore: { x: 40, y: 50, w: 500, h: 400 } })),
    place("1", at("reference", 900, 100, { floating: true })),
    place("2", at("tomorrow", 700, 300)),
    { op: "focus", window: "notes" },
  ]);
  const ctx = {
    store,
    wm,
    runtime: {
      commands,
      shortcuts: { focused: null },
      focusSurface() {},
      followSurface() {},
      buffers: { mayGo: keep },
      plugins: { unmount() {} },
    },
    now: () => 0,
    wall: () => epoch,
    tr: (key: CopyKey, vars?: Record<string, string | number>) => t("en", key, vars),
  } as unknown as ShellCtx;
  defineFrameCommands(ctx);
  defineControlCommands(ctx);
  await commands.settled();
  return { store, wm, commands, client, ctx };
}

/** Where window `id` of the desktop in front is drawn, rounded, as desk.windows.list says it. */
export function drawn(store: Store, id: string) {
  const r = rectIn(store.get().wm, id);
  return r && { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) };
}

/** Window `id` as the desktop in front (or `desktop`) places it. */
export const placed = (store: Store, id: string, desktop?: DesktopId) =>
  windowsOf(store.get(), desktop).find((p) => p.id === id);
