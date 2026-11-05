import { describe, expect, test } from "vitest";
import { BODY, digest, frameModel, type Palette, paint } from "./draw";
import { DENSITIES, generateMesh, ringCounts, ringRadii, VIEW_IDLE } from "./mesh";
import { ERIS_STATES, LOOKS } from "./states";

const balanced = () => generateMesh({ ...DENSITIES.balanced, view: VIEW_IDLE, goldToward: [1, 1] });
const flat = new Array(9).fill(0);
const model = (state: (typeof ERIS_STATES)[number]) => {
  const look = LOOKS[state];
  const mesh = generateMesh({
    ...DENSITIES.balanced,
    view: look.view,
    goldToward: look.goldToward,
  });
  return frameModel({
    mesh,
    look,
    geometry: BODY,
    spin: 0,
    disp: flat,
    glow: flat,
    goldMoves: false,
  });
};

describe("the Eris mesh", () => {
  test("rings follow r_k = r_in + (1 - r_in)(1 - (1 - k/K)^q) and end at the rim", () => {
    const radii = ringRadii(DENSITIES.balanced);
    expect(radii[0]).toBeCloseTo(0.32);
    expect(radii[8]).toBe(1);
    for (let k = 1; k < radii.length; k++) expect(radii[k]).toBeGreaterThan(radii[k - 1] ?? 0);
  });

  test("rings get more vertices outwards, never fewer than the ring inside", () => {
    const counts = ringCounts(DENSITIES.balanced, ringRadii(DENSITIES.balanced));
    expect(counts[0]).toBe(6);
    for (let k = 1; k < counts.length; k++)
      expect(counts[k]).toBeGreaterThanOrEqual(counts[k - 1] ?? 0);
    expect(counts.at(-1)).toBeGreaterThan(70);
  });

  test("it is deterministic: the same seed gives the same mesh", () => {
    expect(digest(model("idle"))).toBe(digest(model("idle")));
  });

  test("the centre is open: no vertex inside the inner ring, and faces are denser at the rim", () => {
    const mesh = balanced();
    expect(Math.min(...mesh.vertices.map((v) => v.r))).toBeGreaterThan(0.32 * 0.8);
    const inner = mesh.faces.filter((f) => f.ring <= 2).length;
    const outer = mesh.faces.filter((f) => f.ring >= 6 && f.ring < 8).length;
    expect(outer).toBeGreaterThan(inner * 3);
  });

  test("densities give increasing face counts", () => {
    const count = (d: keyof typeof DENSITIES) =>
      generateMesh({ ...DENSITIES[d], view: VIEW_IDLE, goldToward: [1, 1] }).faces.length;
    expect(count("airy")).toBeLessThan(count("balanced"));
    expect(count("balanced")).toBeLessThan(count("dense"));
  });

  test("the gold face is a front face with r_c in [0.5, 0.74], towards the upper right", () => {
    const mesh = balanced();
    const gold = mesh.faces[mesh.gold];
    expect(gold?.rc).toBeGreaterThanOrEqual(0.5);
    expect(gold?.rc).toBeLessThanOrEqual(0.74);
    const thinking = generateMesh({
      ...DENSITIES.balanced,
      view: LOOKS.thinking.view,
      goldToward: [-1, 1],
    });
    expect(thinking.gold).not.toBe(mesh.gold);
  });

  test("every state draws a different frame of the same mesh", () => {
    const digests = ERIS_STATES.map((s) => digest(model(s)));
    expect(new Set(digests).size).toBe(ERIS_STATES.length);
  });

  test("heads-up outlines the gold face where it was", () => {
    expect(model("heads-up").goldOutline).toBeDefined();
    expect(model("idle").goldOutline).toBeUndefined();
  });

  test("her body is opaque: the ground fills the disc first and follows the rim in", () => {
    const look = LOOKS.idle;
    const mesh = balanced();
    const at = (rim: number) =>
      frameModel({
        mesh,
        look,
        geometry: BODY,
        spin: 0,
        disp: [...flat.slice(0, 8), rim],
        glow: flat,
        goldMoves: false,
      });
    expect(at(0).ground).toEqual({ x: BODY.cx, y: BODY.cy, r: BODY.R });
    expect(at(-0.05).ground.r).toBeCloseTo(BODY.R * 0.95);
    expect(at(0.05).ground.r).toBe(BODY.R);

    // The first fill is the ground, fully opaque, before any translucent frost.
    const fills: { style: unknown; alpha: number }[] = [];
    const ctx = new Proxy(
      { globalAlpha: 1, fillStyle: "" as unknown },
      {
        get(target, key) {
          if (key === "fill")
            return () => fills.push({ style: target.fillStyle, alpha: target.globalAlpha });
          if (key === "createLinearGradient") return () => ({ addColorStop: () => {} });
          if (key in target) return target[key as keyof typeof target];
          return () => {};
        },
        set(target, key, value) {
          (target as Record<string | symbol, unknown>)[key] = value;
          return true;
        },
      },
    ) as unknown as CanvasRenderingContext2D;
    const palette = { frost: "#e9edf4", ground: "#141416", gold: "#e8c98a" } as Palette;
    paint(ctx, at(0), look, palette, BODY);
    expect(fills[0]).toEqual({ style: "#141416", alpha: 1 });
    const firstFrost = fills.findIndex((f) => f.style === "#e9edf4");
    expect(firstFrost).toBeGreaterThan(0);
    expect(fills.slice(0, firstFrost).every((f) => f.style === "#141416" && f.alpha === 1)).toBe(
      true,
    );
  });
});
