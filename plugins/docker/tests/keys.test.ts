import { describe, expect, it } from "vitest";
import { actionFor, BINDINGS, hints, LISTS, pressOf } from "../ui/keys.js";
import { mount } from "./harness";

const press = (key: string, extra: Partial<{ mod: boolean; alt: boolean }> = {}) => ({
  key,
  mod: false,
  shift: key !== key.toLowerCase(),
  alt: false,
  ...extra,
});

/** Actions the view handles itself, without the controller. */
const VIEW_ONLY = new Set(["next", "previous", "first", "last", "fold", "end", "top"]);

describe("keys", () => {
  it("maps single letters per view and leaves every chord to the desk", () => {
    expect(actionFor("containers", press("s"))).toBe("start");
    expect(actionFor("containers", press("D"))).toBe("remove");
    expect(actionFor("images", press("D"))).toBe("removeImage");
    expect(actionFor("compose", press("u"))).toBe("up");
    expect(actionFor("logs", press("f"))).toBe("toggleFollow");
    expect(actionFor("inspect", press("q"))).toBe("back");
    expect(actionFor("volumes", press("3"))).toBe("images");
    expect(actionFor("containers", press("s", { mod: true }))).toBeUndefined();
    expect(actionFor("containers", press("s", { alt: true }))).toBeUndefined();
    expect(actionFor("logs", press("1"))).toBeUndefined();
  });

  it("lists the labelled keys of a view as its hint line", () => {
    expect(hints("volumes")).toBe("D remove · X prune · g refresh · ? keys · 1–6 lists");
    expect(hints("logs")).toBe(
      "f follow · t times · / filter · c clear · q back · g reload · ? keys",
    );
    expect(hints("containers")).toContain("↵ detail");
  });

  it("gives every key an action the controller or the view answers", async () => {
    const m = await mount();
    for (const [view, bindings] of Object.entries(BINDINGS))
      for (const { action } of bindings)
        if (!VIEW_ONLY.has(action))
          expect(typeof m.keys[action], `${view}: ${action}`).toBe("function");
    expect(LISTS).toHaveLength(6);
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
