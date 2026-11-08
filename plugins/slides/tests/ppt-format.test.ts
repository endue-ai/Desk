// @vitest-environment jsdom
// The PowerPoint 97-2003 reader against the PresentationML one: fixtures/ppt/make.sh builds
// deck.pptx with python-pptx and LibreOffice converts it to deck.ppt. Both must give the same
// deck: positions within a point, fills, lines, text runs and notes. Where LibreOffice's
// conversion itself drops something, the comparison says so and checks what is left.
import { describe, expect, it } from "vitest";
import type { Deck, Element, Fill, Line, Paragraph, TextBody } from "../ui/deck.js";
import { deckOf, fixture } from "./model";

const decks = Promise.all([
  deckOf(fixture("ppt/deck.pptx"), "deck.pptx"),
  deckOf(fixture("ppt/deck.ppt"), "deck.ppt"),
]);

/** Colours within 4 of 255 per channel: LibreOffice rounds theme tints and shades its own way. */
function sameColor(a: string, b: string, where: string) {
  const rgb = (c: string) => [1, 3, 5].map((i) => Number.parseInt(c.slice(i, i + 2), 16));
  const [x, y] = [rgb(a), rgb(b)];
  const off = Math.max(...x.map((v, i) => Math.abs(v - (y[i] ?? 0))));
  expect(off, `${where}: ${a} and ${b}`).toBeLessThanOrEqual(4);
}

function sameFill(a: Fill, b: Fill, where: string) {
  expect(b.type, where).toBe(a.type);
  if (a.type === "solid" && b.type === "solid") sameColor(a.color, b.color, where);
  if (a.type === "gradient" && b.type === "gradient") {
    expect(b.shape, where).toBe(a.shape);
    expect(b.angle, where).toBeCloseTo(a.angle, 0);
    // LibreOffice writes two colours: the first and the last of the stops.
    sameColor(a.stops[0]?.color ?? "", b.stops[0]?.color ?? "", `${where} first stop`);
    sameColor(a.stops.at(-1)?.color ?? "", b.stops.at(-1)?.color ?? "", `${where} last stop`);
  }
}

function sameLine(a: Line | null, b: Line | null, where: string) {
  expect(Boolean(b), `${where} line`).toBe(Boolean(a));
  if (!a || !b) return;
  sameColor(a.color, b.color, `${where} line`);
  expect(Math.abs(a.width - b.width), `${where} line width`).toBeLessThanOrEqual(0.5);
  expect([b.dash, b.head, b.tail], where).toEqual([a.dash, a.head, a.tail]);
}

/** A paragraph's text with its runs' looks, adjacent runs that look alike joined. */
function runsOf(p: Paragraph, bold = true) {
  const out: Array<{
    text: string;
    size: number;
    bold: boolean;
    italic: boolean;
    underline: boolean;
    color: string;
    font: string;
  }> = [];
  for (const r of p.runs) {
    const look = {
      size: r.size,
      bold: bold && r.bold,
      italic: r.italic,
      underline: r.underline,
      color: r.color,
      font: r.font,
    };
    const last = out.at(-1);
    if (last && JSON.stringify({ ...last, text: "" }) === JSON.stringify({ ...look, text: "" }))
      last.text += r.text;
    else out.push({ text: r.text, ...look });
  }
  return out.filter((r) => r.text !== "");
}

function sameText(a: TextBody | null, b: TextBody | null, where: string, bold = true) {
  const paragraphs = (t: TextBody | null) =>
    (t?.paragraphs ?? []).filter((p) => p.runs.some((r) => r.text !== ""));
  const [pa, pb] = [paragraphs(a), paragraphs(b)];
  expect(pb.length, `${where} paragraphs`).toBe(pa.length);
  for (const [i, p] of pa.entries()) {
    const q = pb[i];
    if (!q) continue;
    const at = `${where} paragraph ${i + 1}`;
    expect([q.level, q.align, q.bullet?.text ?? null], at).toEqual([
      p.level,
      p.align,
      p.bullet?.text ?? null,
    ]);
    expect(Math.abs(q.marginLeft - p.marginLeft), `${at} margin`).toBeLessThanOrEqual(1);
    expect(Math.abs(q.indent - p.indent), `${at} indent`).toBeLessThanOrEqual(1);
    const [ra, rb] = [runsOf(p, bold), runsOf(q, bold)];
    expect(
      rb.map(({ color, ...r }) => r),
      at,
    ).toEqual(ra.map(({ color, ...r }) => r));
    for (const [j, r] of ra.entries()) sameColor(r.color, rb[j]?.color ?? "", `${at} run ${j + 1}`);
  }
  if (a && b && pa.length) expect(b.anchor, `${where} anchor`).toBe(a.anchor);
}

const near = (a: number, b: number, where: string) =>
  expect(Math.abs(a - b), `${where}: ${a} and ${b}`).toBeLessThanOrEqual(1);

function sameElement(a: Element, b: Element, where: string): void {
  expect(b.type, where).toBe(a.type);
  for (const k of ["x", "y", "w", "h"] as const) near(a.box[k], b.box[k], `${where} ${k}`);
  expect([b.box.flipH, b.box.flipV], where).toEqual([a.box.flipH, a.box.flipV]);
  expect(b.box.rot, where).toBeCloseTo(a.box.rot, 1);
  if (a.type === "shape" && b.type === "shape") {
    // Adjust values are not compared: LibreOffice scales DrawingML's into 21600ths, which is not
    // what they mean in the binary format (a right arrow comes back with a shaft of zero).
    expect(b.geometry.name, where).toBe(a.geometry.name);
    sameFill(a.fill, b.fill, where);
    sameLine(a.line, b.line, where);
    sameText(a.text, b.text, where);
  } else if (a.type === "picture" && b.type === "picture") {
    for (const k of ["left", "top", "right", "bottom"] as const)
      expect(b.crop[k], `${where} crop ${k}`).toBeCloseTo(a.crop[k], 2);
  } else if (a.type === "group" && b.type === "group") {
    expect(b.children.length, where).toBe(a.children.length);
    for (const [i, c] of a.children.entries()) {
      const d = b.children[i];
      if (d) sameElement(c, d, `${where} child ${i + 1}`);
    }
  } else if (a.type === "table" && b.type === "table") {
    expect(b.columns.length, where).toBe(a.columns.length);
    for (const [i, w] of a.columns.entries())
      near(w, b.columns[i] ?? 0, `${where} column ${i + 1}`);
    for (const [r, row] of a.rows.entries()) {
      near(row.height, b.rows[r]?.height ?? 0, `${where} row ${r + 1}`);
      for (const [c, cell] of row.cells.entries()) {
        const other = b.rows[r]?.cells[c];
        if (!other) throw new Error(`${where} has no cell ${r + 1},${c + 1}`);
        sameFill(cell.fill, other.fill, `${where} cell ${r + 1},${c + 1}`);
        // LibreOffice drops the table style's bold header row.
        sameText(cell.text, other.text, `${where} cell ${r + 1},${c + 1}`, false);
      }
    }
  }
}

describe("PowerPoint 97-2003 against PresentationML", () => {
  it("the same slides: titles, hidden marks, notes and backgrounds", async () => {
    const [pptx, ppt] = await decks;
    expect(ppt.textOnly).toBe(false);
    expect(ppt.size).toEqual(pptx.size);
    const summary = (d: Deck) => d.slides.map((s) => [s.title, s.hidden, s.notes]);
    expect(summary(ppt)).toEqual(summary(pptx));
    for (const [i, s] of pptx.slides.entries())
      sameFill(
        s.background,
        ppt.slides[i]?.background ?? { type: "none" },
        `slide ${i + 1} background`,
      );
  });

  it("the same elements: boxes, geometry, fills, lines and text runs", async () => {
    const [pptx, ppt] = await decks;
    for (const [i, slide] of pptx.slides.entries()) {
      const other = ppt.slides[i]?.elements ?? [];
      expect(other.length, `slide ${i + 1}`).toBe(slide.elements.length);
      for (const [j, e] of slide.elements.entries()) {
        const f = other[j];
        if (f) sameElement(e, f, `slide ${i + 1} element ${j + 1} (${e.name})`);
      }
    }
  });

  it("the same pictures, decoded from the Pictures stream", async () => {
    const [pptx, ppt] = await decks;
    const pictures = (d: Deck) =>
      d.slides.flatMap((s) => s.elements).filter((e) => e.type === "picture");
    const [a, b] = [pictures(pptx), pictures(ppt)];
    expect(b.length).toBe(2);
    for (const [i, p] of a.entries()) {
      const q = b[i];
      if (p.type !== "picture" || q?.type !== "picture") continue;
      expect(await ppt.image(q.image ?? "")).toBe(await pptx.image(p.image ?? ""));
    }
  });
});
