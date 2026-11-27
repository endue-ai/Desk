/**
 * The desk the notification centre's tests run on (#307): desk.notify installed on a status line in
 * a page (jsdom), on the browser stub's core with a plugin of a name of its own, so a row reads
 * that name. The notices' wall clock is the test's (`vi.setSystemTime`). Only tests import this.
 */
import type { PluginManifest } from "@endue-ai/bridge";
import { browserCore } from "../bridge/core";
import { ManualClock } from "../clock";
import { PolicyHub } from "../hub";
import type { DeskContext } from "../policies/context";
import { installNotify } from "../policies/notify";

export const TERMINAL = "endue.terminal";

export interface CentreDeskOptions {
  /** Plugins running now: a notice of theirs opens what it is about (ADR 0113). */
  mounted?: string[];
  /** How the desk asks a running plugin (desk.notify.open). */
  request?: (plugin: string, command: string, args?: unknown) => Promise<unknown>;
}

export async function centreDesk(options: CentreDeskOptions = {}) {
  const manifests: PluginManifest[] = [
    { id: "desk.notify", kind: "policy", version: "0.1.0" },
    { id: TERMINAL, name: "Terminal", kind: "ui", version: "0.1.0", entry: "ui/index.html" },
  ];
  const core = browserCore({ manifests });
  const hub = new PolicyHub(core.client);
  const mounted = new Set(options.mounted ?? []);
  const ctx = {
    hub,
    bridge: core.client,
    clock: new ManualClock(),
    mounted: (plugin: string) => mounted.has(plugin),
    request: options.request ?? (async () => null),
    language: () => "en",
  } as unknown as DeskContext;
  const root = document.createElement("div");
  root.className = "desk";
  const line = document.createElement("footer");
  line.className = "desk-status";
  root.append(line);
  document.body.replaceChildren(root);
  const policy = installNotify(ctx, line);
  hub.apply(core.plugins);
  await hub.commands.settled();

  const bell = () => root.querySelector<HTMLButtonElement>(".desk-notify-bell");
  const panel = () => root.querySelector<HTMLElement>('[role="dialog"]');
  const rows = () => [...root.querySelectorAll<HTMLElement>('[role="listitem"]')];
  /** A row's button by its text or its label. */
  const button = (row: Element, name: string) =>
    [...row.querySelectorAll<HTMLButtonElement>("button")].find(
      (b) => b.textContent?.trim() === name || b.getAttribute("aria-label") === name,
    );
  const notified = (notificationId: string, title: string, body?: string) =>
    core.stub.emit({
      event: "ui.notified",
      data: { notificationId, caller: TERMINAL, title, level: "info", ...(body ? { body } : {}) },
    });
  return { core, hub, ctx, root, line, policy, bell, panel, rows, button, notified };
}

/** Press a key on `target`, as the keyboard does: it bubbles to the window. */
export function press(target: Element, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}
