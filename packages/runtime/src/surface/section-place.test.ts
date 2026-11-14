// @vitest-environment jsdom
// A window's section (#270): at its window's place in the desk's page, filling its own page there
// (ADR 0201), whatever the window's place says, so a page laid out at one size never holds a section
// laid out for another.
import { describe, expect, it } from "vitest";
import { placeSection } from "./section-place";

const box = (el: HTMLElement) => [el.style.left, el.style.top, el.style.width, el.style.height];

describe("a window's section", () => {
  it("lies at its window's place in the desk's page", () => {
    const el = document.createElement("section");
    placeSection(el, { x: 120, y: 80.5, w: 640, h: 400 }, false);
    expect(box(el)).toEqual(["120px", "80.5px", "640px", "400px"]);
  });

  it("fills its own page from the top left, whatever size its place has", () => {
    const el = document.createElement("section");
    placeSection(el, { x: 120, y: 80, w: 640, h: 400 }, true);
    expect(box(el)).toEqual(["0px", "0px", "100vw", "100vh"]);
    placeSection(el, { x: 300, y: 10, w: 900, h: 120 }, true);
    expect(box(el)).toEqual(["0px", "0px", "100vw", "100vh"]);
  });

  it("in its own page, is not written again as its window moves and resizes", async () => {
    const el = document.createElement("section");
    document.body.append(el);
    placeSection(el, { x: 0, y: 0, w: 640, h: 400 }, true);
    const changes: MutationRecord[] = [];
    const watch = new MutationObserver((records) => changes.push(...records));
    watch.observe(el, { attributes: true });
    for (let i = 1; i <= 10; i++)
      placeSection(el, { x: i * 8, y: i * 5, w: 640 + i, h: 400 }, true);
    await Promise.resolve();
    watch.disconnect();
    expect(changes).toEqual([]);
    el.remove();
  });

  it("back in the desk's page (its own page closed), lies at its place again", () => {
    const el = document.createElement("section");
    placeSection(el, { x: 120, y: 80, w: 640, h: 400 }, true);
    placeSection(el, { x: 130, y: 90, w: 600, h: 380 }, false);
    expect(box(el)).toEqual(["130px", "90px", "600px", "380px"]);
  });
});
