// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ManualClock } from "../clock";
import { Store, sampleState } from "../shell/state";
import { Ticker } from "../shell/ticker";
import {
  GLOW_IN_MS,
  GLOW_OUT_MS,
  LOOK,
  mountVisiting,
  USE,
  VISITING,
  visitingOf,
} from "./visiting";

describe("the windows Eris is at", () => {
  let clock: ManualClock;
  let store: Store;
  let reduced = false;
  let section: HTMLElement;
  const ctx = () => ({ store, ticker: new Ticker(clock), reduced: () => reduced });
  /** Let the promises of a finished fade run. */
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  const glows = () => store.get().erisWindows;

  beforeEach(() => {
    clock = new ManualClock();
    store = new Store(sampleState("en", 0));
    reduced = false;
    section = document.createElement("section");
    section.className = "surface";
    section.dataset.surface = "endue.mail";
    document.body.append(section);
  });

  afterEach(() => section.remove());

  it("a window she uses comes up in tenths, stays lit, and goes dark once she leaves it", async () => {
    const visiting = mountVisiting(ctx());
    const leave = visiting.enter("endue.mail");
    expect(glows(), "dark as she turns to it").toEqual([]);
    const seen: number[] = [];
    const off = store.watch(
      (s) => s.erisWindows,
      (w) => seen.push(w[0]?.glow ?? 0),
    );
    for (let at = 0; at < GLOW_IN_MS; at += 16) clock.advance(16);
    await settle();
    expect(glows()).toEqual([{ id: "endue.mail", glow: USE }]);
    // A fade is a few reports, never one a frame: each a tenth, and each brighter than the last.
    expect(seen.length).toBeLessThanOrEqual(10);
    expect(seen.every((g) => Math.round(g * 10) === g * 10)).toBe(true);
    expect([...seen].sort((a, b) => a - b)).toEqual(seen);
    clock.advance(1000);
    expect(glows(), "lit as long as she is at it").toEqual([{ id: "endue.mail", glow: 1 }]);

    leave();
    clock.advance(GLOW_OUT_MS / 2);
    const half = glows()[0]?.glow ?? 0;
    expect(half).toBeGreaterThan(0);
    expect(half).toBeLessThan(1);
    clock.advance(GLOW_OUT_MS);
    await settle();
    expect(glows()).toEqual([]);
    off();
  });

  it("looked at and used at once, a window takes the brightest, and falls back to the look", async () => {
    const visiting = mountVisiting(ctx());
    const look = visiting.enter("endue.mail", LOOK);
    clock.advance(GLOW_IN_MS);
    clock.advance(16);
    expect(glows()).toEqual([{ id: "endue.mail", glow: LOOK }]);
    const use = visiting.enter("endue.mail", USE);
    clock.advance(GLOW_IN_MS);
    clock.advance(16);
    expect(glows()).toEqual([{ id: "endue.mail", glow: USE }]);
    use();
    clock.advance(GLOW_OUT_MS);
    clock.advance(16);
    await settle();
    expect(glows(), "she still looks at it").toEqual([{ id: "endue.mail", glow: LOOK }]);
    look();
    look();
    clock.advance(GLOW_OUT_MS);
    clock.advance(16);
    await settle();
    expect(glows()).toEqual([]);
  });

  it("lights several windows at once, each on its own", async () => {
    const visiting = mountVisiting(ctx());
    const mail = visiting.enter("endue.mail");
    visiting.enter("endue.notes", LOOK);
    clock.advance(GLOW_IN_MS);
    clock.advance(16);
    expect(glows()).toEqual([
      { id: "endue.mail", glow: USE },
      { id: "endue.notes", glow: LOOK },
    ]);
    mail();
    clock.advance(GLOW_OUT_MS);
    clock.advance(16);
    await settle();
    expect(glows()).toEqual([{ id: "endue.notes", glow: LOOK }]);
  });

  it("marks the window's section with how brightly it glows, and clears it after", async () => {
    const visiting = mountVisiting(ctx());
    const leave = visiting.enter("endue.mail", LOOK);
    clock.advance(GLOW_IN_MS);
    clock.advance(16);
    expect(section.classList.contains(VISITING)).toBe(true);
    expect(section.style.getPropertyValue("--eris-glow")).toBe(String(LOOK));
    leave();
    clock.advance(GLOW_OUT_MS);
    clock.advance(16);
    await settle();
    expect(section.classList.contains(VISITING)).toBe(false);
    expect(section.style.getPropertyValue("--eris-glow")).toBe("");
  });

  it("nothing fades with reduced motion: lit at once and dark at once", async () => {
    reduced = true;
    const visiting = mountVisiting(ctx());
    const leave = visiting.enter("endue.mail");
    expect(glows()).toEqual([{ id: "endue.mail", glow: 1 }]);
    leave();
    await settle();
    expect(glows()).toEqual([]);
  });

  it("a window she turns to again while it goes dark comes back up", async () => {
    const visiting = mountVisiting(ctx());
    visiting.enter("endue.mail")();
    clock.advance(16);
    visiting.enter("endue.mail");
    clock.advance(GLOW_OUT_MS);
    clock.advance(GLOW_OUT_MS);
    await settle();
    expect(glows()).toEqual([{ id: "endue.mail", glow: 1 }]);
  });

  it("a desk has one account of them", () => {
    const one = ctx();
    expect(visitingOf(one)).toBe(visitingOf({ ...one }));
    expect(visitingOf({ ...one, store: new Store(sampleState("en", 0)) })).not.toBe(
      visitingOf(one),
    );
  });
});
