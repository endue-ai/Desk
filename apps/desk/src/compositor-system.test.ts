// @vitest-environment jsdom
// The parts of the desk's system surface (ADR 0160): the page reports each one's box under the id
// the compositor knows (`crates/desk-web/src/sender/system.rs`), in that file's order.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PARTS, systemParts } from "./compositor-system";

const RUST = join(import.meta.dirname, "../../../crates/desk-web/src/sender/system.rs");

/** An element of `className` at a box, as a browser lays it out (jsdom lays nothing out). */
function at(className: string, box: [number, number, number, number], into = document.body) {
  const el = document.createElement("div");
  el.className = className;
  const [x, y, width, height] = box;
  el.getBoundingClientRect = () => ({ x, y, width, height }) as DOMRect;
  into.append(el);
  return el;
}

afterEach(() => document.body.replaceChildren());

describe("the desk's system parts", () => {
  it("are the ones the compositor names, in its order", () => {
    const rust = [...readFileSync(RUST, "utf8").matchAll(/id: "(desk\.[a-z]+)"/g)].map((m) => m[1]);
    expect(PARTS.map(([id]) => id)).toEqual(rust);
  });

  it("report each part the page shows, and none hidden or of no size", () => {
    const system = document.createElement("div");
    system.dataset.layer = "system";
    document.body.append(system);
    at("sidebar", [24, 300, 56, 200], system);
    at("rail", [1200, 60, 56, 300]).hidden = true;
    at("desk-status", [400, 8, 0, 24]);
    at("eris", [656, 40, 128, 138]);
    expect(systemParts(document)).toEqual([
      { id: "desk.agents", x: 24, y: 300, width: 56, height: 200 },
      { id: "desk.eris", x: 656, y: 40, width: 128, height: 138 },
    ]);
  });

  it("report each control the page draws over the dock and the windows, each with its own box", () => {
    // The bottom edge lays its controls out on their own: the footer itself has no height.
    const bottom = document.createElement("footer");
    bottom.className = "bottom";
    bottom.getBoundingClientRect = () => ({ x: 0, y: 800, width: 1280, height: 0 }) as DOMRect;
    document.body.append(bottom);
    at("drawer", [92, 736, 40, 40], bottom);
    at("composer talk-pill", [548, 732, 184, 48], bottom);
    at("running", [760, 744, 0, 0], bottom);
    at("arrange-strip float-bar", [1224, 590, 40, 160]);
    at("canvas-reset icon-button", [148, 744, 32, 32]);
    const system = document.createElement("div");
    system.dataset.layer = "system";
    document.body.append(system);
    at("safe-badge", [552, 24, 175, 35], system);
    expect(systemParts(document)).toEqual([
      { id: "desk.arrange", x: 1224, y: 590, width: 40, height: 160 },
      { id: "desk.bottom", x: 92, y: 736, width: 40, height: 40 },
      { id: "desk.bottom", x: 548, y: 732, width: 184, height: 48 },
      { id: "desk.canvas", x: 148, y: 744, width: 32, height: 32 },
      { id: "desk.safe", x: 552, y: 24, width: 175, height: 35 },
    ]);
  });

  it("report every overlay the page has open, each with its own box", () => {
    at("popover rail-popover", [900, 300, 280, 180.4]);
    at("tooltip", [40.5, 640, 120, 24]);
    at("popover drawer-panel", [80, 500, 300, 200]).hidden = true;
    expect(systemParts(document)).toEqual([
      { id: "desk.overlays", x: 900, y: 300, width: 280, height: 181 },
      { id: "desk.overlays", x: 40, y: 640, width: 121, height: 24 },
    ]);
  });
});
