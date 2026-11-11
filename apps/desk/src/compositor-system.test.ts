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
    // Eris's proposal, the description's panel and the keys' hint are cards over the desk too.
    at("proposal", [360, 72, 560, 300]);
    at("desk-which-key", [360, 600, 560, 120]);
    expect(systemParts(document)).toEqual([
      { id: "desk.overlays", x: 900, y: 300, width: 280, height: 181 },
      { id: "desk.overlays", x: 40, y: 640, width: 121, height: 24 },
      { id: "desk.overlays", x: 360, y: 72, width: 560, height: 300 },
      { id: "desk.overlays", x: 360, y: 600, width: 560, height: 120 },
    ]);
  });

  it("report each modal's scrim, which the compositor dims, and its dialog above it", () => {
    // A dialog's scrim over the whole app: the compositor draws it, over every window (#158).
    const scrim = at("scrim desktops-dialog", [0, 0, 1280, 800]);
    at("dialog", [420, 304, 440, 192], scrim);
    // The theme studio docked to the side while it edits dims nothing.
    at("scrim theme-studio-scrim is-editing", [0, 0, 1280, 800]);
    // The description's scrim and its panel.
    at("desk-describe", [0, 0, 1280, 800]).append(at("desk-describe-panel", [320, 200, 640, 300]));
    expect(systemParts(document)).toEqual([
      { id: "desk.scrim", x: 0, y: 0, width: 1280, height: 800 },
      { id: "desk.scrim", x: 0, y: 0, width: 1280, height: 800 },
      { id: "desk.overlays", x: 420, y: 304, width: 440, height: 192 },
      { id: "desk.overlays", x: 320, y: 200, width: 640, height: 300 },
    ]);
  });

  it("report the backdrop of a modal dialog over the whole app, and the dialog's own box", () => {
    const settings = document.createElement("dialog");
    settings.className = "desk-settings";
    settings.getBoundingClientRect = () => ({ x: 190, y: 65, width: 900, height: 670 }) as DOMRect;
    document.body.append(settings);
    expect(systemParts(document)).toEqual([]);
    // Open as `show()` opens it: no backdrop.
    settings.setAttribute("open", "");
    const box = { id: "desk.settings", x: 190, y: 65, width: 900, height: 670 };
    expect(systemParts(document)).toEqual([box]);
    // Modal, as `showModal()` opens it (jsdom has no top layer): its backdrop over the whole app.
    const matches = settings.matches.bind(settings);
    Object.defineProperty(settings, "matches", {
      value: (selector: string) => selector === ":modal" || matches(selector),
    });
    expect(systemParts(document)).toEqual([
      { id: "desk.scrim", x: 0, y: 0, width: window.innerWidth, height: window.innerHeight },
      box,
    ]);
  });
});
