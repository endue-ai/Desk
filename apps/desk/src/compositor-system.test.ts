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
});
