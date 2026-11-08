// A plugin's notice opens what it is about (#538, ADR 0113): a click on its text in the status line,
// or picking it in the notification history, focuses the plugin that sent it (desk.display.show)
// and then hands it the notification (the desk's request desk.notify.open), so a terminal can show the
// tab that sent it. The desk's own notices and plugins that are not running get neither.
import type { PluginManifest } from "@endue-ai/bridge";
import { describe, expect, it, vi } from "vitest";
import { browserCore } from "../bridge/core";
import { ManualClock } from "../clock";
import { PolicyHub } from "../hub";
import type { DeskContext } from "./context";
import { installNotify } from "./notify";

interface Fake {
  className: string;
  textContent: string;
  title: string;
  type: string;
  children: Fake[];
  click(): void;
  addEventListener(type: string, listener: () => void): void;
}

/** Just enough of a status line and its document for a notice's text and its buttons. */
function statusLine() {
  const element = (): Fake => {
    const listeners = new Map<string, () => void>();
    return {
      className: "",
      textContent: "",
      title: "",
      type: "",
      children: [],
      click: () => listeners.get("click")?.(),
      addEventListener: (type, listener) => void listeners.set(type, listener),
    };
  };
  const line = {
    ...element(),
    dataset: {} as Record<string, string>,
    classList: { toggle: () => {} },
    ownerDocument: { createElement: element },
    replaceChildren: (...nodes: Fake[]) => {
      line.children = nodes;
    },
    append: (...nodes: Fake[]) => {
      line.children.push(...nodes);
    },
  };
  return line;
}

const TERMINAL = "endue.terminal";

async function desk(picked?: string) {
  const manifests: PluginManifest[] = [
    { id: "desk.notify", kind: "policy", version: "0.1.0" },
    { id: TERMINAL, kind: "ui", version: "0.1.0", entry: "ui/index.html" },
  ];
  const core = browserCore({ manifests });
  const hub = new PolicyHub(core.client);
  const log: string[] = [];
  const request = vi.fn(async (plugin: string, name: string, args?: unknown) => {
    log.push(`${name} ${plugin} ${JSON.stringify(args)}`);
    return null;
  });
  const ctx = {
    hub,
    bridge: core.client,
    clock: new ManualClock(),
    request,
    mounted: (plugin: string) => plugin === TERMINAL,
  } as unknown as DeskContext;
  const line = statusLine();
  const policy = installNotify(ctx, line as unknown as HTMLElement);
  hub.commands.define("desk.display.show", {
    title: "Show",
    owner: "desk",
    run: (args) => void log.push(`show ${JSON.stringify(args)}`),
  });
  hub.commands.define("desk.palette.pick", { title: "Pick", owner: "desk", run: () => picked });
  hub.apply(core.plugins);
  await hub.commands.settled();
  const notified = (notificationId: string, caller = TERMINAL) =>
    core.stub.emit({
      event: "ui.notified",
      data: { notificationId, caller, title: "zsh — make", body: "done", level: "info" },
    });
  const show = () => line.children.find((c) => c.className.split(" ").includes("desk-status-open"));
  return { hub, line, policy, request, log, notified, show };
}

describe("opening a plugin's notice", () => {
  it("a click on the notice focuses the plugin and hands it the notification", async () => {
    const d = await desk();
    d.notified("n7");
    // The notice's text is the button: the status line reads as before (desk.notify's e2e).
    expect(d.line.children).toHaveLength(1);
    expect(d.show()?.textContent).toBe("zsh — make — done");
    expect(d.show()?.title).toBe("zsh — make — done");
    expect(d.show()?.className).toBe("desk-status-text desk-status-open");
    d.show()?.click();
    await vi.waitFor(() => expect(d.request).toHaveBeenCalledOnce());
    expect(d.log).toEqual([
      `show {"plugin":"${TERMINAL}"}`,
      `desk.notify.open ${TERMINAL} {"notificationId":"n7"}`,
    ]);
    expect(d.policy.notifications.current()).toBeNull();
  });

  it("picking a notice in the history opens it the same way", async () => {
    const d = await desk("n8");
    d.notified("n8");
    await d.hub.commands.run("desk.notify.history");
    await vi.waitFor(() =>
      expect(d.request).toHaveBeenCalledWith(TERMINAL, "desk.notify.open", {
        notificationId: "n8",
      }),
    );
    expect(d.log[0]).toBe(`show {"plugin":"${TERMINAL}"}`);
  });

  it("the desk's own notices and plugins that are not running have nothing to open", async () => {
    const d = await desk("n9");
    d.policy.notify({ caller: "desk", title: "Saved", level: "info" });
    expect(d.show()).toBeUndefined();
    d.notified("n9", "test.gone");
    expect(d.show()).toBeUndefined();
    await d.hub.commands.run("desk.notify.history");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(d.request).not.toHaveBeenCalled();
    expect(d.log).toEqual([]);
  });
});
