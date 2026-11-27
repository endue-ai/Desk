import { describe, expect, test } from "vitest";
import { fleetOf, helperPose, Slots } from "./satellites";

describe("Eris's delegated moons", () => {
  test("two delegated runs keep independent orbits until each one ends", () => {
    const runs = [
      { runId: "a", state: "running", caller: "desk" },
      { runId: "b", state: "running", caller: "agent:eris" },
      { runId: "c", state: "running", caller: "desk" },
    ] as const;
    const fleet = new Slots();
    const ids = fleetOf(runs, ["a"]);
    expect(ids).toEqual(["a", "b"]);
    const [a, b] = fleet.update(ids, 100);
    if (!a || !b) throw new Error("missing moons");
    expect(fleet.update(["b"], 250)).toEqual([b]);
    expect(fleetOf([{ ...runs[0], state: "done" }, runs[1]], ["a"])).toEqual(["b"]);
    for (const moon of [a, b]) {
      const orbit = Array.from({ length: 120 }, (_, i) => helperPose(moon, 100 + i * 60, false));
      const transits = orbit.filter(({ x, y }) => Math.hypot(x, y) < 43);
      expect(transits.some((p) => p.z < 0)).toBe(true);
      expect(transits.some((p) => p.z > 0)).toBe(true);
      expect(helperPose(moon, 200, true)).toEqual(helperPose(moon, 2000, true));
    }
    expect(helperPose(a, 500, false)).not.toEqual(helperPose(b, 500, false));
  });
});
