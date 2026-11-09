// A plugin that opens one of its surfaces comes into view (#17): its one frame draws every surface it
// has, so ui.surface.opened shows that frame and gives it the focus, as desk.display.show does. The
// permissions plugin's prompt is a dialog in its own frame; without this it waited behind the focused
// window, and the plugin that asked for a permission waited with it.
import type { BridgeEvent, PluginManifest } from "@endue-ai/bridge";
import { describe, expect, it } from "vitest";
import { browserCore } from "../bridge/core";
import { PolicyHub } from "../hub";
import type { SurfaceHost } from "../surfaces";
import type { DeskContext } from "./context";
import { installDisplay } from "./display";

const PERMISSIONS = "endue.permissions";

function desk() {
  const manifests: PluginManifest[] = [
    { id: "desk.display", kind: "policy", version: "0.1.0" },
    { id: PERMISSIONS, kind: "ui", version: "0.1.0", entry: "ui/index.html" },
  ];
  const core = browserCore({ manifests });
  const log: string[] = [];
  const mounted = new Set([PERMISSIONS]);
  const surfaces = {
    get: (id: string) => (mounted.has(id) ? ({} as HTMLElement) : undefined),
    show: (id: string, visible: boolean) => void log.push(`show ${id} ${visible}`),
  } as unknown as SurfaceHost;
  const ctx = {
    hub: new PolicyHub(core.client),
    bridge: core.client,
    surfaces,
  } as unknown as DeskContext;
  const policy = installDisplay(ctx, {
    focus: (id) => void log.push(`focus ${id}`),
    visible: () => [...mounted],
    focused: () => null,
  });
  const opened = (caller: string) =>
    core.stub.emit({
      event: "ui.surface.opened",
      data: {
        handle: "s-1",
        caller,
        surface: "prompt",
        placement: "overlay",
        title: "Permission request",
      },
      to: ["desk"],
    } as BridgeEvent);
  return { log, policy, opened };
}

describe("ui.surface.opened", () => {
  it("shows the plugin's surface and gives it the focus", () => {
    const { log, opened } = desk();
    opened(PERMISSIONS);
    expect(log).toEqual([`show ${PERMISSIONS} true`, `focus ${PERMISSIONS}`]);
  });

  it("does nothing for a plugin that is not running", () => {
    const { log, opened } = desk();
    opened("example.gone");
    expect(log).toEqual([]);
  });

  it("is no longer heard once the policy is disposed", () => {
    const { log, policy, opened } = desk();
    policy.dispose();
    opened(PERMISSIONS);
    expect(log).toEqual([]);
  });
});
