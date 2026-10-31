// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { scaleToFit } from "../ui/fit.js";
import { createView } from "../ui/view.js";
import { deck, key, loadPage } from "./page";

const shown = (d = deck()) => ({
  buffer: "file:~/a.pptx",
  path: "~/a.pptx",
  name: "a.pptx",
  size: 2048,
  opened: { kind: "deck" as const, format: d.format, deck: d },
});

const rail = () => [...document.querySelectorAll<HTMLButtonElement>("#rail button")];
const current = () => rail().findIndex((b) => b.getAttribute("aria-current") === "true") + 1;
const text = (selector: string) => document.querySelector(selector)?.textContent ?? "";
const player = () => document.querySelector<HTMLElement>("#player");

describe("the slides view", () => {
  beforeEach(() => {
    loadPage();
  });

  it("the rail lists every slide with its number and the notes follow the slide", () => {
    const view = createView(document);
    view.show(shown());
    expect(text("#deck-name")).toBe("a.pptx");
    expect(rail()).toHaveLength(3);
    expect(rail().map((b) => b.getAttribute("aria-label"))).toEqual([
      "Slide 1: Slide 1 title",
      "Slide 2: Slide 2 title",
      "Slide 3: Slide 3 title",
    ]);
    expect(rail().map((b) => b.querySelector(".number")?.textContent)).toEqual(["1", "2", "3"]);
    expect(current()).toBe(1);
    expect(text("#notes-text")).toBe("First notes");
    expect(document.querySelector("#stage .slide")?.textContent).toContain("Slide 1 title");

    rail()[1]?.click();
    expect(current()).toBe(2);
    expect(text("#notes-text")).toBe("Second notes");
    expect(document.querySelector("#stage")?.getAttribute("aria-label")).toBe("Slide 2 of 3");
  });

  it("arrows, Page Up/Down, Home and End move between slides; chords are left alone", () => {
    const view = createView(document);
    view.show(shown());
    expect(key("ArrowRight").defaultPrevented).toBe(true);
    expect(current()).toBe(2);
    key("ArrowDown");
    expect(current()).toBe(3);
    key("ArrowDown");
    expect(current()).toBe(3);
    key("PageUp");
    expect(current()).toBe(2);
    key("Home");
    expect(current()).toBe(1);
    key("End");
    expect(current()).toBe(3);
    key("ArrowLeft");
    expect(current()).toBe(2);
    expect(text("#notes-text")).toBe("Second notes");
    for (const chord of ["s", "o", "w", "k"])
      expect(key(chord, { metaKey: true }).defaultPrevented).toBe(false);
    expect(key("ArrowRight", { metaKey: true }).defaultPrevented).toBe(false);
    expect(current()).toBe(2);
  });

  it("play mode advances, jumps by number and leaves on Escape", () => {
    const view = createView(document);
    view.show(shown());
    key("ArrowRight");
    expect(player()?.hidden).toBe(true);
    document.querySelector<HTMLButtonElement>("#play")?.click();
    expect(player()?.hidden).toBe(false);
    expect(text("#player-counter")).toBe("2 / 3");
    expect(player()?.querySelector(".slide")?.textContent).toContain("Slide 2 title");
    key(" ");
    expect(text("#player-counter")).toBe("3 / 3");
    key("PageUp");
    expect(text("#player-counter")).toBe("2 / 3");
    key("ArrowLeft");
    expect(text("#player-counter")).toBe("1 / 3");
    key("PageDown");
    key("ArrowRight");
    expect(text("#player-counter")).toBe("3 / 3");
    key("1");
    key("Enter");
    expect(text("#player-counter")).toBe("1 / 3");
    expect(player()?.querySelector(".slide")?.textContent).toContain("Slide 1 title");
    const leave = key("Escape");
    expect(leave.defaultPrevented).toBe(true);
    expect(player()?.hidden).toBe(true);
    // Leaving play mode shows the slide it ended on.
    expect(current()).toBe(1);
    // F5 inside the surface plays too; outside play mode Escape is the desk's.
    key("F5");
    expect(player()?.hidden).toBe(false);
    key("Escape");
    expect(key("Escape").defaultPrevented).toBe(false);
  });

  it("play mode skips hidden slides", () => {
    const view = createView(document);
    view.show(shown(deck(true)));
    key("F5");
    key(" ");
    key(" ");
    expect(text("#player-counter")).toBe("2 / 3");
    expect(rail()[2]?.getAttribute("aria-label")).toBe("Slide 3: Slide 3 title, hidden");
  });

  it("the slide box keeps the slide's aspect ratio", () => {
    const view = createView(document);
    view.show(shown());
    const slide = document.querySelector<HTMLElement>("#stage .slide");
    expect(slide?.style.width).toBe("960px");
    expect(slide?.style.height).toBe("540px");
    expect(scaleToFit({ width: 800, height: 800 }, { width: 960, height: 540 })).toEqual({
      scale: 800 / 960,
      width: 800,
      height: 450,
    });
    expect(scaleToFit({ width: 1000, height: 300 }, { width: 960, height: 540 })).toEqual({
      scale: 300 / 540,
      width: (960 * 300) / 540,
      height: 300,
    });
    expect(scaleToFit({ width: 0, height: 0 }, { width: 960, height: 540 }).scale).toBeGreaterThan(
      0,
    );
  });

  it("show(null) says no presentation is open", () => {
    const view = createView(document);
    view.show(shown());
    view.show(null);
    expect(text("#deck-name")).toBe("No presentation open");
    expect(rail()).toHaveLength(0);
  });
});
