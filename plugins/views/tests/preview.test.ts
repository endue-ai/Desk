import { describe, expect, it } from "vitest";
import type { View } from "../../../packages/bridge/src/index";
import { mount, vector } from "./harness";

/** A view no file holds yet: the spec's today vector under the id the desk would give it. */
const proposed: View = { ...vector("view-today"), id: "eris.today" };

describe("desk.views.preview", () => {
  it("desk.views.preview draws an inline view over live data with Apply, Try again and Discard, and answers the person's choice", async () => {
    const m = await mount();
    const first = m.host.invoke("desk.views.preview", { view: proposed, note: "Eris made this." });
    await m.settle();
    // Drawn from the view it was given: no file is read.
    expect(m.params("view.get")).toEqual([]);
    expect(m.view.drawn.at(-1)).toMatchObject({
      id: "eris.today",
      title: "Today",
      preview: { note: "Eris made this." },
    });
    expect(m.shown().map((component) => [component.type, component.state])).toEqual([
      ["agenda", "ready"],
      ["list", "ready"],
    ]);
    expect(m.host.visible).toBe(true);
    m.preview.choose("retry", "  only work  ");
    expect(await first).toEqual({ choice: "retry", correction: "only work" });

    // A newer preview replaces one still waiting: the older one counts as discarded.
    const second = m.host.invoke("desk.views.preview", { view: proposed });
    await m.settle();
    const third = m.host.invoke("desk.views.preview", {
      view: { ...proposed, title: "Today, again" },
    });
    await m.settle();
    expect(await second).toEqual({ choice: "discard" });
    expect(m.view.drawn.at(-1)).toMatchObject({ title: "Today, again", preview: { note: "" } });
    m.preview.choose("apply");
    expect(await third).toEqual({ choice: "apply" });
    // Apply leaves the preview on screen until the desk opens the saved view.
    expect(m.host.visible).toBe(true);

    // Escape (desk.views.close) is Discard, and so is the Discard button; both hide the surface.
    const fourth = m.host.invoke("desk.views.preview", { view: proposed });
    await m.settle();
    await m.host.invoke("desk.views.close");
    expect(await fourth).toEqual({ choice: "discard" });
    expect(m.host.visible).toBe(false);
    const fifth = m.host.invoke("desk.views.preview", { view: proposed });
    await m.settle();
    m.preview.choose("discard");
    expect(await fifth).toEqual({ choice: "discard" });
    await m.settle();
    expect(m.host.visible).toBe(false);
    expect(m.view.drawn.at(-1)).toBeNull();

    await expect(m.host.invoke("desk.views.preview", {})).rejects.toThrow(/needs a view/);
  });

  it("a view.changed for the previewed id does not reload it; desk.views.open with a notice draws its text and its action runs the command", async () => {
    const undone: unknown[] = [];
    const m = await mount({
      views: [vector("view-today")],
      commands: {
        "desk.propose.undo": (args) => {
          undone.push(args);
          return {};
        },
      },
    });
    void m.host.invoke("desk.views.preview", { view: proposed });
    await m.settle();
    const draws = m.view.drawn.length;
    m.host.emit({ event: "view.changed", data: { id: "eris.today", change: "saved" } });
    await m.settle();
    expect(m.view.drawn).toHaveLength(draws);
    expect(m.params("view.get")).toEqual([]);

    const notice = {
      text: "Eris made this view: ~/.desk/views/desk.today.yaml",
      action: {
        title: "Undo",
        command: "desk.propose.undo",
        args: { kind: "view", id: "desk.today" },
      },
    };
    await m.open({ id: "desk.today", notice });
    const drawn = m.view.drawn.at(-1);
    expect(drawn).toMatchObject({ id: "desk.today", notice });
    expect(drawn?.preview).toBeUndefined();
    await m.engine.noticeAction();
    expect(undone).toEqual([{ kind: "view", id: "desk.today" }]);
  });
});
