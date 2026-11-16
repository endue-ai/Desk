// Hosts outside the page (the OS's notifications while endue is out of sight, #306) hear every
// notice that shows, from a plugin's ui.notified and from the desk itself, but not one do not
// disturb holds back; and act on one as a click would: its first action, or open what it is about.
import type { PluginManifest } from "@endue-ai/bridge";
import { describe, expect, it, vi } from "vitest";
import { browserCore } from "../bridge/core";
import { ManualClock } from "../clock";
import { PolicyHub } from "../hub";
import type { Notice } from "../notify";
import type { DeskContext } from "./context";
import { installNotify } from "./notify";

interface Fake {
  className: string;
  textContent: string;
  title: string;
  type: string;
  children: Fake[];
  setAttribute(name: string, value: string): void;
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
      setAttribute: () => {},
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

async function desk() {
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
  hub.commands.define("test.restart", {
    title: "Restart",
    owner: "desk",
    run: () => void log.push("restart"),
  });
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

describe("notices for hosts outside the page", () => {
  it("onShown hears every notice that shows and activate runs it", async () => {
    const d = await desk();
    const shown: Notice[] = [];
    const stop = d.policy.onShown((notice) => shown.push(notice));
    d.notified("n1");
    d.policy.notify({
      caller: "desk",
      title: "Update ready",
      level: "info",
      actions: [{ label: "Restart", command: "test.restart" }],
    });
    d.hub.settings.set("desk.notify.dnd", true);
    d.policy.notify({ caller: "desk", title: "Held", level: "info" });
    expect(shown.map((n) => n.title)).toEqual(["zsh — make", "Update ready"]);
    expect(shown[0]?.id).toBe("n1");

    const update = shown[1]?.id ?? "";
    await d.policy.activate(update, true);
    expect(d.log).toEqual(["restart"]);

    await d.policy.activate("n1", false);
    await vi.waitFor(() =>
      expect(d.request).toHaveBeenCalledWith(TERMINAL, "desk.notify.open", {
        notificationId: "n1",
      }),
    );
    expect(d.log.slice(1)).toEqual([
      `show {"plugin":"${TERMINAL}"}`,
      `desk.notify.open ${TERMINAL} {"notificationId":"n1"}`,
    ]);

    await d.policy.activate("nope", true);
    expect(d.log).toHaveLength(3);
    stop();
    d.hub.settings.set("desk.notify.dnd", false);
    d.notified("n2");
    expect(shown).toHaveLength(2);
  });
});
