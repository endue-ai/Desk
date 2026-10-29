import { describe, expect, test } from "vitest";
import { sampleEnvelope } from "../bridge/browser";
import erisReply from "../bridge/envelopes/eris-reply.json";
import userHello from "../bridge/envelopes/user-hello.json";
import { BAND_EDGES, bandsFromSpectrum, follow, MAX_DISPLACEMENT, Voice } from "./voice";

const silent = new Array(9).fill(0);
/** Innermost and outermost ring with a visible displacement. */
const front = (disp: number[]) => {
  const moving = disp.map((d, k) => (Math.abs(d) > 0.003 ? k : -1)).filter((k) => k >= 0);
  return { inner: Math.min(...moving), outer: Math.max(...moving) };
};

function run(source: "user" | "eris", until: number, speak?: number[]) {
  const voice = new Voice();
  if (speak) voice.speak(speak);
  const frames = new Map<number, number[]>();
  const env = source === "user" ? userHello : erisReply;
  for (let t = 0; t <= until; t += 10) {
    const bands = sampleEnvelope(env, t);
    const frame = voice.update(t, {
      user: source === "user" ? bands : silent,
      eris: source === "eris" ? bands : silent,
    });
    frames.set(t, frame.disp);
  }
  return frames;
}

describe("sound enters through the rings", () => {
  test("nine bands: 80–250 Hz, 250 Hz–2 kHz, 2–8 kHz split 3, 4, 2", () => {
    expect(BAND_EDGES).toHaveLength(10);
    expect(BAND_EDGES[0]).toBe(80);
    expect(BAND_EDGES[3]).toBeCloseTo(250);
    expect(BAND_EDGES[7]).toBeCloseTo(2000);
    expect(BAND_EDGES[9]).toBe(8000);
    const bins = new Array(128).fill(0).map((_, i) => (i < 3 ? 255 : 0));
    expect(bandsFromSpectrum(bins, 48000)[0]).toBeGreaterThan(0);
  });

  test("attack is faster than release", () => {
    expect(follow(0, 1, 30)).toBeCloseTo(1 - Math.exp(-1));
    expect(follow(1, 0, 30)).toBeGreaterThan(0.8);
  });

  test("the user's voice travels from the rim inwards, pulling the mesh in", () => {
    const frames = run("user", 600);
    const early = frames.get(60) ?? silent;
    const late = frames.get(500) ?? silent;
    expect(front(early).outer).toBe(8);
    expect(front(early).inner).toBeGreaterThan(front(late).inner);
    expect(Math.min(...late)).toBeLessThan(0);
    expect(Math.min(...late)).toBeGreaterThanOrEqual(-MAX_DISPLACEMENT);
  });

  test("it settles within 1.5 s after the user stops", () => {
    const frames = run("user", 1400 + 1500);
    expect(Math.max(...(frames.get(2900) ?? []).map(Math.abs))).toBeLessThan(
      0.3 * MAX_DISPLACEMENT,
    );
  });

  test("Eris's pulse leaves the core and reaches the rim 220 ms later", () => {
    const frames = run("eris", 400, [0]);
    expect(front(frames.get(40) ?? silent).outer).toBeLessThan(3);
    expect(Math.abs(frames.get(20)?.[8] ?? 1)).toBeLessThan(0.003);
    expect(frames.get(260)?.[8]).toBeGreaterThan(0.5 * MAX_DISPLACEMENT);
  });

  test("both voices at once cancel near ring 4 and read as an interruption", () => {
    const voice = new Voice();
    voice.speak([0, 100, 200, 300]);
    let interrupted = false;
    let disp: number[] = [];
    for (let t = 0; t <= 400; t += 10) {
      const f = voice.update(t, {
        user: sampleEnvelope(userHello, t),
        eris: sampleEnvelope(erisReply, t),
      });
      interrupted ||= f.interrupted;
      disp = f.disp;
    }
    expect(interrupted).toBe(true);
    expect(Math.abs(disp[4] ?? 1)).toBeLessThan(0.002);
  });

  test("reduced motion keeps brightness but moves nothing", () => {
    const voice = new Voice();
    voice.speak([0]);
    const f = voice.update(100, { user: silent, eris: silent }, true);
    expect(f.disp.every((d) => d === 0)).toBe(true);
    expect(Math.max(...f.glow)).toBeGreaterThan(0);
  });
});
