// @vitest-environment jsdom
// The launcher on its page (ui/index.html, ui/view.js, ui/launcher.js) over a fake desk: it shows
// on its command, lists Recent then All, filters, moves with the arrows, opens with Enter or a
// press, and goes away with Escape or a press on the ground.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { createLauncher } from "../ui/launcher.js";
import { createView } from "../ui/view.js";

const html = readFileSync(join(import.meta.dirname, "../ui/index.html"), "utf8");
const plugin = (id: string, name: string, more: object = {}) => ({
  id,
  status: "ready",
  enabled: true,
  manifest: { id, name, kind: "ui", surfaces: [{ id: "main", placement: "center" }] },
  ...more,
});

function mount(kept: unknown = ["endue.notes"], listed = true) {
  document.documentElement.innerHTML = html.replace(/<script[\s\S]*?<\/script>/g, "");
  const calls: Array<[string, any]> = [];
  const ran: Array<[string, any]> = [];
  let visible = false;
  let app: ReturnType<typeof createLauncher> | undefined;
  const view = createView(document, {
    type: (text) => app?.type(text),
    move: (step) => app?.move(step),
    launch: (id) => void app?.launch(id),
    close: () => app?.close(),
  });
  // jsdom lays nothing out: three tiles a row.
  view.columns = () => 3;
  app = createLauncher(
    {
      call: async (method, params) => {
        calls.push([method, params]);
        if (method === "plugin.list") {
          if (!listed) throw new Error("permission_denied");
          return {
            plugins: [
              plugin("endue.terminal", "Terminal"),
              plugin("endue.browser", "Browser", { enabled: false }),
              plugin("endue.notes", "Notes"),
              plugin("endue.git", "Git", { status: "failed", error: "entry is missing" }),
              plugin("endue.calendar", "Calendar"),
            ],
          };
        }
        if (method === "store.get") return { value: kept };
        return {};
      },
      run: async (command, args) => void ran.push([command, args]),
      show: () => {
        visible = true;
      },
      hide: () => {
        visible = false;
      },
    },
    view,
  );
  const names = (id: string) =>
    [...document.querySelectorAll(`#${id} .tile .name`)].map((n) => n.textContent);
  const selected = () =>
    [...document.querySelectorAll('.tile[aria-selected="true"]')].map(
      (t) => (t as HTMLElement).dataset.plugin,
    );
  const key = (name: string) =>
    document.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true }));
  return { app, calls, ran, names, selected, key, visible: () => visible };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("the launcher", () => {
  beforeEach(() => {
    document.documentElement.innerHTML = "";
  });

  it("shows on its command with Recent first, then every plugin by name, the field focused", async () => {
    const { app, names, selected, visible } = mount();
    expect(visible()).toBe(false);
    await app.toggle();
    expect(visible()).toBe(true);
    expect(names("recent")).toEqual(["Notes"]);
    expect(names("all")).toEqual(["Browser", "Calendar", "Git", "Notes", "Terminal"]);
    expect(selected()).toEqual(["endue.notes"]);
    expect(document.activeElement?.id).toBe("find");
    // The same command puts it away.
    await app.toggle();
    expect(visible()).toBe(false);
  });

  it("filters as the person types, and says when no plugin has that name", async () => {
    const { app, names, selected } = mount();
    await app.toggle();
    const find = document.getElementById("find") as HTMLInputElement;
    find.value = "cal";
    find.dispatchEvent(new Event("input"));
    expect(document.getElementById("recent-group")?.hidden).toBe(true);
    expect(names("all")).toEqual(["Calendar"]);
    expect(selected()).toEqual(["endue.calendar"]);
    find.value = "zzz";
    find.dispatchEvent(new Event("input"));
    expect(document.getElementById("none")?.hidden).toBe(false);
  });

  it("moves with the arrows and opens the selected plugin on Enter, remembering it", async () => {
    const { app, calls, ran, key, selected, visible } = mount([]);
    await app.toggle();
    expect(selected()).toEqual(["endue.browser"]);
    key("ArrowRight");
    expect(selected()).toEqual(["endue.calendar"]);
    key("ArrowDown");
    expect(selected()).toEqual(["endue.terminal"]);
    key("Enter");
    await settle();
    expect(ran).toEqual([["desk.plugins.open", { plugin: "endue.terminal" }]]);
    expect(visible()).toBe(false);
    expect(calls.at(-1)).toEqual(["store.set", { key: "recent", value: ["endue.terminal"] }]);
  });

  it("opens a plugin that is off on a press, and says why a failed one cannot open", async () => {
    const { app, ran, visible } = mount();
    await app.toggle();
    (document.querySelector('#all [data-plugin="endue.git"]') as HTMLElement).click();
    await settle();
    expect(ran).toEqual([]);
    expect(visible()).toBe(true);
    expect(document.getElementById("status")?.textContent).toBe(
      "Git cannot open: entry is missing.",
    );
    (document.querySelector('#all [data-plugin="endue.browser"]') as HTMLElement).click();
    await settle();
    expect(ran).toEqual([["desk.plugins.open", { plugin: "endue.browser" }]]);
  });

  it("goes away on Escape and on a press on the ground, not on a press on the field", async () => {
    const { app, key, visible } = mount();
    await app.toggle();
    document.getElementById("find")?.click();
    expect(visible()).toBe(true);
    key("Escape");
    expect(visible()).toBe(false);
    await app.toggle();
    document.getElementById("launcher")?.click();
    expect(visible()).toBe(false);
  });

  it("still shows, and says so, when the plugins cannot be listed", async () => {
    const { app, names, visible } = mount([], false);
    await app.toggle();
    expect(visible()).toBe(true);
    expect(names("all")).toEqual([]);
    expect(document.getElementById("status")?.textContent).toBe("The plugins could not be listed.");
  });
});
