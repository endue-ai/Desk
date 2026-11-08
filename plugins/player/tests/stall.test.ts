import { describe, expect, it } from "vitest";
import { actionFor } from "../ui/keys.js";
import { createStallWatch } from "../ui/stall.js";

describe("the stall watch", () => {
  const sample = (time: number, frames = -1, playing = true, visible = true) => ({
    playing,
    time,
    frames,
    visible,
  });

  it("reports a position that stands still while playing, once", () => {
    const watch = createStallWatch(6000);
    expect(watch.check(sample(10), 0)).toBe(false);
    expect(watch.check(sample(11), 1000)).toBe(false);
    expect(watch.check(sample(11), 6500)).toBe(false);
    expect(watch.check(sample(11), 7000)).toBe(true);
    expect(watch.check(sample(11), 9000)).toBe(false);
    expect(watch.check(sample(12), 9500)).toBe(false);
    expect(watch.check(sample(12), 16000)).toBe(true);
  });

  it("reports frames that stop while the clock runs on, only when the surface is visible", () => {
    const watch = createStallWatch(6000);
    for (let s = 0; s <= 5; s++) expect(watch.check(sample(s, 100), s * 1000)).toBe(false);
    expect(watch.check(sample(6, 100), 6000)).toBe(true);

    const hidden = createStallWatch(6000);
    for (let s = 0; s <= 10; s++)
      expect(hidden.check(sample(s, 100, true, false), s * 1000)).toBe(false);
  });

  it("a pause is never a stall", () => {
    const watch = createStallWatch(6000);
    watch.check(sample(5), 0);
    expect(watch.check(sample(5, -1, false), 10000)).toBe(false);
    expect(watch.check(sample(5), 11000)).toBe(false);
  });
});

describe("the transport's keys", () => {
  const body = { tag: "BODY" };
  it("map to actions inside the surface and leave chords alone", () => {
    expect(actionFor({ key: " " }, body)).toBe("toggle");
    expect(actionFor({ key: "PageDown" }, body)).toBe("next");
    expect(actionFor({ key: "]" }, body)).toBe("later");
    expect(actionFor({ key: "s", metaKey: true }, body)).toBeNull();
    expect(actionFor({ key: "ArrowLeft", altKey: true }, body)).toBeNull();
  });

  it("let menus, sliders and buttons keep their own keys", () => {
    expect(actionFor({ key: "ArrowUp" }, { tag: "SELECT" })).toBeNull();
    expect(actionFor({ key: "ArrowUp" }, { tag: "INPUT", type: "range", id: "volume" })).toBeNull();
    expect(actionFor({ key: "ArrowLeft" }, { tag: "INPUT", type: "range", id: "seek" })).toBe(
      "back5",
    );
    expect(actionFor({ key: " " }, { tag: "BUTTON" })).toBeNull();
    expect(actionFor({ key: "m" }, { tag: "BUTTON" })).toBe("mute");
    expect(actionFor({ key: "Escape" }, { tag: "SELECT" })).toBe("leave");
  });
});
