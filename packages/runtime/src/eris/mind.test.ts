// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { ManualClock } from "../clock";
import { Ticker } from "../shell/ticker";
import { mindOf, setMind, TAKE_MS, takeIn } from "./mind";

// Her ring while she works a line (ADR 0275): what it is made of, what says it shows, and the ring
// that closes into her as a line or an answer reaches her.
describe("Eris's ring", () => {
  let clock: ManualClock;
  let ticker: Ticker;
  let reduced = false;
  let host: HTMLElement;
  let eris: HTMLElement;
  const ctx = () => ({ ticker, reduced: () => reduced });

  beforeEach(() => {
    reduced = false;
    clock = new ManualClock();
    ticker = new Ticker(clock);
    host = document.createElement("div");
    eris = document.createElement("div");
    eris.className = "eris";
    eris.append(mindOf(document));
    host.append(eris);
  });

  it("is three turning arcs with a mote at each head, an inner pair, and a ring to close in", () => {
    const ring = eris.querySelector("svg.eris-mind");
    expect(ring?.getAttribute("aria-hidden")).toBe("true");
    expect(ring?.getAttribute("viewBox")).toBe("0 0 148 148");
    expect(ring?.querySelectorAll(".eris-mind-turn")).toHaveLength(2);
    expect(ring?.querySelectorAll(".eris-mind-mote")).toHaveLength(3);
    // Three arcs of 48 round a ring of 66: each with its gap is a third of the way round.
    const outer = ring?.querySelector(".eris-mind-arc:not(.eris-mind-arc--inner)");
    const [arc = 0, gap = 0] = (outer?.getAttribute("stroke-dasharray") ?? "")
      .split(" ")
      .map(Number);
    expect(arc).toBe(48);
    expect(arc + gap).toBeCloseTo((2 * Math.PI * 66) / 3, 1);
    // Every mote lies on the ring.
    for (const mote of ring?.querySelectorAll(".eris-mind-mote") ?? []) {
      const dx = Number(mote.getAttribute("cx")) - 74;
      const dy = Number(mote.getAttribute("cy")) - 74;
      expect(Math.hypot(dx, dy)).toBeCloseTo(66, 1);
    }
    expect(ring?.querySelector(".eris-intake")?.getAttribute("r")).toBe("66");
  });

  it("says on her what she is at, and nothing once she is at no line", () => {
    setMind(host, "reading");
    expect(eris.dataset.mind).toBe("reading");
    setMind(host, "waiting");
    expect(eris.dataset.mind).toBe("waiting");
    setMind(host, null);
    expect(eris.dataset.mind).toBeUndefined();
    // A desk without her says nothing.
    expect(() => setMind(document.createElement("div"), "reading")).not.toThrow();
  });

  it("closes a ring into her core as something reaches her, there and gone", async () => {
    const ring = eris.querySelector<SVGCircleElement>(".eris-intake") as SVGCircleElement;
    const taken = takeIn(host, ctx());
    clock.advance(16);
    const early = Number(ring.style.transform.match(/scale\(([\d.]+)\)/)?.[1]);
    expect(early).toBeGreaterThan(1);
    expect(Number(ring.style.opacity)).toBeGreaterThan(0);
    for (let at = 16; at <= TAKE_MS; at += 16) clock.advance(16);
    await taken;
    expect(ring.style.transform).toBe("scale(0.350)");
    expect(Number(ring.style.opacity)).toBeCloseTo(0, 3);
  });

  it("opens a ring out of her core as a request leaves her", async () => {
    const ring = eris.querySelector<SVGCircleElement>(".eris-intake") as SVGCircleElement;
    const sent = takeIn(host, ctx(), "out");
    clock.advance(16);
    expect(Number(ring.style.transform.match(/scale\(([\d.]+)\)/)?.[1])).toBeLessThan(0.5);
    for (let at = 16; at <= TAKE_MS; at += 16) clock.advance(16);
    await sent;
    expect(ring.style.transform).toBe("scale(1.300)");
    expect(ring.dataset.way).toBe("out");
  });

  it("with reduced motion, or no ring to close, nothing moves", async () => {
    reduced = true;
    await takeIn(host, ctx());
    expect(eris.querySelector<SVGElement>(".eris-intake")?.style.transform).toBe("");
    reduced = false;
    await expect(takeIn(document.createElement("div"), ctx())).resolves.toBeUndefined();
  });
});
