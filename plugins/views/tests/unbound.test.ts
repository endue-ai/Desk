// @vitest-environment jsdom
// An item view's section whose require has no connected source (desk.views draws item views, ADR
// 0032; deprecated by ADR 0103 but read through v0) names the installed connectors that could bring
// it, with Connect a source, or says plainly that no installed connector brings it, with no button
// that leads nowhere. The view here has the requires desk.today's item view had.
import { describe, expect, it } from "vitest";
import { fixtureConnector, type ItemKind, type View } from "../../../packages/bridge/src/index";
import { drawComponent } from "../ui/draw.js";
import type { ComponentModel } from "../ui/engine.js";
import { mount } from "./harness";

const list = (title: string, kind: ItemKind, source: string) => ({
  type: "list" as const,
  title,
  binding: { kinds: [kind], sources: [source] },
  fields: [{ value: "{title}" }],
});
const day: View = {
  id: "test.day",
  version: "0.1.0",
  title: "Day",
  requires: {
    tasks: { kinds: ["task"], title: "A task list (optional)" },
    messages: { kinds: ["message"], title: "Messages (optional)" },
    github: { kinds: ["task"], connector: "desk.github", title: "GitHub (optional)" },
  },
  layout: {
    type: "grid",
    columns: 3,
    children: [
      list("Due", "task", "$tasks"),
      list("Unread", "message", "$messages"),
      list("GitHub", "task", "$github"),
    ],
  },
};

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

/** The view opened by desk.views: each section by its title, and the buttons each draws. */
async function opened(handlers: ReturnType<typeof listing>) {
  const m = await mount({ views: [day], handlers });
  await m.open({ id: "test.day" });
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

describe("an item view's sections with nothing connected", () => {
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
