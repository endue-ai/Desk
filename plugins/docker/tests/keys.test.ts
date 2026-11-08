import { describe, expect, it } from "vitest";
import { actionFor, BINDINGS, hints, keyTable, LISTS, pressOf, VIEW_ONLY } from "../ui/keys.js";
import { mount } from "./harness";

const press = (key: string, extra: Partial<{ mod: boolean; alt: boolean }> = {}) => ({
  key,
  mod: false,
  shift: key !== key.toLowerCase(),
  alt: false,
  ...extra,
});

describe("keys", () => {
  it("maps single letters per view and leaves every chord to the desk", () => {
    expect(actionFor("containers", press("s"))).toBe("start");
    expect(actionFor("containers", press("D"))).toBe("remove");
    expect(actionFor("images", press("D"))).toBe("removeImage");
    expect(actionFor("compose", press("u"))).toBe("up");
    expect(actionFor("logs", press("f"))).toBe("toggleFollow");
    expect(actionFor("inspect", press("q"))).toBe("back");
    expect(actionFor("volumes", press("4"))).toBe("images");
    expect(actionFor("containers", press("s", { mod: true }))).toBeUndefined();
    expect(actionFor("containers", press("s", { alt: true }))).toBeUndefined();
    expect(actionFor("logs", press("1"))).toBeUndefined();
  });

  it("opens on the overview at 1, marks with Space, sorts with S, and leaves Tab alone", () => {
    expect(LISTS).toEqual(["overview", "containers", "compose", "images", "volumes", "networks"]);
    expect(actionFor("overview", press("1"))).toBe("overview");
    expect(actionFor("overview", press("Enter"))).toBe("activate");
    expect(actionFor("overview", press("c"))).toBe("switchContext");
    expect(actionFor("containers", press(" "))).toBe("mark");
    expect(actionFor("containers", press("M"))).toBe("markAll");
    expect(actionFor("containers", press("/"))).toBe("search");
    expect(actionFor("containers", press("S"))).toBe("nextSort");
    expect(actionFor("containers", press("w"))).toBe("openPort");
    expect(actionFor("containers", press("ArrowLeft"))).toBe("collapse");
    expect(actionFor("images", press("B"))).toBe("build");
    expect(actionFor("images", press("h"))).toBe("history");
    expect(actionFor("inspect", press("]"))).toBe("nextTab");
    expect(actionFor("inspect", press("y"))).toBe("copyOut");
    expect(actionFor("logs", press("w"))).toBe("toggleWrap");
    for (const view of Object.keys(BINDINGS))
      expect(actionFor(view as keyof typeof BINDINGS, press("Tab")), view).toBeUndefined();
  });

  it("lists the labelled keys of a view as its hint line, and all of them for the keys panel", () => {
    expect(hints("volumes")).toBe(
      "D remove · X prune · / search · M mark all · S sort · Z reverse · g refresh · ? keys · 1–6 lists",
    );
    expect(hints("logs")).toBe(
      "f follow · t times · w wrap · / search · c clear · g reload · ] tabs · q back · ? keys",
    );
    expect(hints("containers")).toContain("↵ detail");
    expect(keyTable("containers")).toContainEqual(["Space", "mark"]);
    expect(keyTable("overview")).not.toContainEqual(["Space", "mark"]);
  });

  it("gives every key an action the controller or the view answers", async () => {
    const m = await mount();
    for (const [view, bindings] of Object.entries(BINDINGS))
      for (const { action } of bindings)
        if (!VIEW_ONLY.has(action))
          expect(typeof m.keys[action], `${view}: ${action}`).toBe("function");
    for (const action of ["query", "sort", "goto", "paneTab", "openPortOf", "browse", "focused"])
      expect(typeof m.keys[action], action).toBe("function");
  });

  it("reads Meta or Control as Mod", () => {
    expect(
      pressOf({ key: "k", metaKey: false, ctrlKey: true, shiftKey: false, altKey: false }),
    ).toEqual({
      key: "k",
      mod: true,
      shift: false,
      alt: false,
    });
  });
});
