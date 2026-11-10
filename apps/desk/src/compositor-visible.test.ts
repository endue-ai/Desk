// @vitest-environment jsdom
// Compositor mode (#52): the parts of a plugin frame nothing in the shell page covers, where the
// compositor draws its surface over the page.
import { afterEach, describe, expect, it } from "vitest";
import {
  type Box,
  type Geometry,
  paintsIn,
  screenHits,
  subtract,
  visiblePieces,
} from "./compositor-visible";

function box(x: number, y: number, width: number, height: number): Box {
  return { x, y, width, height };
}

const byY = (a: Box, b: Box) => a.y - b.y;

/** A page where `stack(x, y)` names what is there, `boxes` where each element shows, `clear` what paints nothing. */
function page(stack: Geometry["stack"], boxes: Map<Element, Box>, clear: Element[] = []): Geometry {
  return {
    stack,
    box: (element) => boxes.get(element) ?? box(0, 0, 0, 0),
    paints: (element) => !clear.includes(element),
  };
}

describe("visible parts of a frame", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("cuts one box out of another in up to four parts", () => {
    expect(subtract(box(0, 0, 10, 10), box(20, 20, 5, 5))).toEqual([box(0, 0, 10, 10)]);
    expect(subtract(box(0, 0, 10, 10), box(0, 0, 10, 10))).toEqual([]);
    expect(subtract(box(0, 0, 10, 10), box(5, 0, 10, 10))).toEqual([box(0, 0, 5, 10)]);
    expect(subtract(box(0, 0, 30, 30), box(10, 10, 10, 10))).toEqual([
      box(0, 0, 30, 10),
      box(0, 20, 30, 10),
      box(0, 10, 10, 10),
      box(20, 10, 10, 10),
    ]);
  });

  it("leaves out what a window above covers, and keeps what the frame or its own window shows", () => {
    const own = document.createElement("div");
    const frame = document.createElement("iframe");
    own.append(frame);
    const title = document.createElement("span");
    const content = document.createElement("iframe");
    document.body.append(own, title, content);
    // The window above covers the frame's right half: its title along the top, its frame below.
    const stack = (x: number, y: number) =>
      x >= 50 ? [y < 20 ? title : content, frame] : x < 5 ? [own] : [frame];
    const boxes = new Map<Element, Box>([
      [title, box(50, 0, 100, 20)],
      [content, box(50, 20, 100, 80)],
    ]);
    const pieces = visiblePieces(frame, box(0, 0, 100, 100), page(stack, boxes));
    expect(pieces.sort(byY)).toEqual([box(0, 0, 50, 20), box(0, 20, 50, 80)]);
  });

  it("finds a bar across a frame between the frame's own samples through the page's grid", () => {
    const frame = document.createElement("iframe");
    const dock = document.createElement("iframe");
    document.body.append(frame, dock);
    const geometry = page(
      (_x, y) => (y >= 701 && y < 759 ? [dock, frame] : [frame]),
      new Map([[dock, box(0, 701, 1280, 58)]]),
    );
    const clip = box(137, 580, 388, 220);
    expect(visiblePieces(frame, clip, geometry)).toEqual([clip]);
    const hits = screenHits(1280, 800, 24, geometry);
    expect(visiblePieces(frame, clip, geometry, hits).sort(byY)).toEqual([
      box(137, 580, 388, 121),
      box(137, 759, 388, 41),
    ]);
  });

  it("looks through what paints nothing (a window's resize grips) to what is under it", () => {
    const frame = document.createElement("iframe");
    const grip = document.createElement("span");
    const above = document.createElement("div");
    document.body.append(frame, grip, above);
    const boxes = new Map<Element, Box>([
      [grip, box(0, 90, 100, 10)],
      [above, box(80, 0, 20, 100)],
    ]);
    // The frame's own grip lies over its bottom edge; a window above covers its right edge.
    const stack = (x: number, y: number) => [
      ...(y >= 90 ? [grip] : []),
      ...(x >= 80 ? [above] : []),
      frame,
    ];
    const pieces = visiblePieces(frame, box(0, 0, 100, 100), page(stack, boxes, [grip]));
    expect(pieces).toEqual([box(0, 0, 80, 100)]);
  });

  it("cuts nothing where the frame is not at all, as in its own window's rounded corner", () => {
    const frame = document.createElement("iframe");
    const behind = document.createElement("span");
    document.body.append(frame, behind);
    // In the bottom-left corner the frame's window is rounded off: the window below shows there.
    const stack = (x: number, y: number) =>
      x < 10 && y > 90 ? [behind, document.body] : [frame, document.body];
    const geometry = page(stack, new Map([[behind, box(0, 85, 60, 20)]]));
    expect(visiblePieces(frame, box(0, 0, 100, 100), geometry)).toEqual([box(0, 0, 100, 100)]);
  });

  it("cuts out the element that paints, not the container it overflows", () => {
    const frame = document.createElement("iframe");
    const layer = document.createElement("main");
    const overlay = document.createElement("iframe");
    layer.append(overlay);
    document.body.append(frame, layer);
    const boxes = new Map<Element, Box>([
      [overlay, box(0, 0, 100, 800)],
      [layer, box(0, 0, 100, 700)],
    ]);
    expect(
      visiblePieces(
        frame,
        box(0, 700, 100, 60),
        page(() => [overlay, layer, frame], boxes),
      ),
    ).toEqual([]);
  });

  it("knows what covers: a background, a border, text, replaced content; not a clear or faint box", () => {
    const empty = document.createElement("span");
    const filled = document.createElement("div");
    filled.style.backgroundColor = "rgb(1, 2, 3)";
    const bordered = document.createElement("div");
    bordered.style.border = "1px solid red";
    const text = document.createElement("b");
    text.textContent = "hi";
    const canvas = document.createElement("canvas");
    const tint = document.createElement("div");
    tint.style.backgroundColor = "rgba(255, 255, 255, 0.1)";
    const grip = document.createElement("span");
    grip.style.backgroundImage = "linear-gradient(135deg, transparent 50%, red 50%)";
    const all = [empty, filled, bordered, text, canvas, tint, grip];
    document.body.append(...all);
    expect(all.map((e) => paintsIn(window, e))).toEqual([
      false,
      true,
      true,
      true,
      true,
      false,
      false,
    ]);
  });
});
