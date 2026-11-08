// @vitest-environment jsdom
// desk.today is data only: desk.views draws it (plugins/views). A section whose require has no
// connected source names the installed connectors that could bring it, with Connect a source, or
// says plainly that no installed connector brings it, with no button that leads nowhere.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  fixtureConnector,
  type ItemKind,
  type PluginManifest,
  type View,
} from "../../../packages/bridge/src/index";
import { mount } from "../../views/tests/harness";
import { drawComponent } from "../../views/ui/draw.js";
import type { ComponentModel } from "../../views/ui/engine.js";

const root = join(import.meta.dirname, "../../..");
const today = () =>
  (JSON.parse(readFileSync(join(root, "plugins/today/plugin.json"), "utf8")) as PluginManifest)
    .view as View;

/**
 * connector.list: desk.fixtures connected with events, tasks and notes (no messages), and the
 * connectors given, `[id, title, kind]`, installed with no instance.
 */
const listing = (...more: Array<[string, string, ItemKind]>) => ({
  "connector.list": () => {
    const { id, title, instances } = fixtureConnector();
    const kinds: ItemKind[] = ["event", "task", "note"];
    return {
      connectors: [
        { id, title, instances, resources: kinds.map((kind) => ({ kind })) },
        ...more.map(([id, title, kind]) => ({ id, title, instances: [], resources: [{ kind }] })),
      ],
    };
  },
});

/** desk.today opened by desk.views: each section by its title, and the buttons each draws. */
async function opened(handlers: ReturnType<typeof listing>) {
  const m = await mount({ views: [today()], handlers });
  await m.open({ id: "desk.today" });
  const env = m.view.drawn.at(-1)?.env;
  if (!env) throw new Error("nothing was drawn");
  const none = () => undefined;
  const buttons = { reconnect: none, requestAccess: none, connect: none, link: none };
  const drawn = (component: ComponentModel) =>
    [...drawComponent(document, component, env, buttons, none).querySelectorAll("desk-button")].map(
      (button) => button.textContent,
    );
  return new Map(m.shown().map((c) => [c.title, { ...c, buttons: drawn(c) }]));
}

describe("desk.today's sections with nothing connected", () => {
  it("an unbound section names the installed connectors that bring its kind and offers Connect a source", async () => {
    const sections = await opened(
      listing(["acme.slack", "Slack", "message"], ["desk.github", "GitHub", "task"]),
    );
    expect(sections.get("Due")?.state).toBe("ready");
    expect(sections.get("Unread")).toMatchObject({
      state: "unbound",
      message: "Connect Slack to show messages here.",
      buttons: ["Connect a source"],
    });
    expect(sections.get("GitHub")).toMatchObject({
      state: "unbound",
      message: "Connect GitHub to show tasks here.",
      buttons: ["Connect a source"],
    });
  });

  it("an unbound section that no installed connector can serve says so and offers no Connect", async () => {
    const sections = await opened(listing());
    expect(sections.get("Unread")).toMatchObject({
      state: "unbound",
      message: "No installed connector brings messages yet.",
      buttons: [],
    });
    expect(sections.get("GitHub")).toMatchObject({
      state: "unbound",
      message: "desk.github is not installed.",
      buttons: [],
    });
  });
});
