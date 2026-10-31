import { describe, expect, it } from "vitest";
import type { Element } from "../ui/deck.js";
import { openFile } from "../ui/open.js";
import { cfb } from "./cfb";
import { powerPointDeck } from "./fixtures/ppt/styled";
import { bodyText, deckOf, fixture, flat, shapes } from "./model";

const shapeAt = (elements: Element[] | undefined, i: number) => {
  const e = elements?.[i];
  if (e?.type !== "shape") throw new Error(`element ${i} is a ${e?.type}`);
  return e;
};

describe("PowerPoint 97-2003", () => {
  it("LibreOffice's .ppt is no longer text only: shapes, pictures, a table, numbering, notes", async () => {
    const deck = await deckOf(fixture("sample.ppt"), "sample.ppt");
    expect(deck.textOnly).toBe(false);
    expect(deck.size).toEqual({ width: 960, height: 540 });
    expect(deck.slides.map((s) => s.title)).toEqual([
      "Quarterly review",
      "Agenda",
      "Shapes",
      "A picture",
      "A table",
      "Numbered steps",
      "Backup slide",
    ]);
    const body = shapes(deck.slides[1]).find((s) => bodyText(s.text).startsWith("Results"));
    expect(body?.text?.paragraphs.map((p) => p.level)).toEqual([0, 1, 1, 0]);
    expect(body?.text?.paragraphs[1]?.bullet?.text).toBe("–");
    expect(shapes(deck.slides[2]).map((s) => s.geometry.name)).toContain("chevron");
    expect(flat(deck.slides[4]?.elements).some((e) => e.type === "table")).toBe(true);
    const numbered = shapes(deck.slides[5]).find((s) => bodyText(s.text).startsWith("First"));
    expect(numbered?.text?.paragraphs.map((p) => p.bullet?.text)).toEqual(["1.", "2.", "3."]);
    expect(deck.slides.map((s) => s.hidden).at(-1)).toBe(true);
    expect(deck.slides[0]?.notes).toBe("Welcome. This deck is a test fixture.");
    const picture = flat(deck.slides[3]?.elements).find((e) => e.type === "picture");
    expect(picture?.type === "picture" && (await deck.image(picture.image ?? ""))).toMatch(
      /^data:image\/png;base64,iVBOR/,
    );
  });

  it(".pps and .pot open as decks under their own names", async () => {
    for (const [name, format] of [
      ["show.pps", "PowerPoint 97-2003 slide show"],
      ["template.pot", "PowerPoint 97-2003 template"],
    ]) {
      const opened = await openFile(fixture("ppt/deck.ppt"), name ?? "");
      expect(opened).toMatchObject({ kind: "deck", format, deck: { textOnly: false } });
    }
  });

  it("placeholders take the master's styles and boxes, text comes from the outline", async () => {
    const deck = await deckOf(powerPointDeck(), "styled.ppt");
    const [first] = deck.slides;
    expect(first?.title).toBe("Hello");
    // The master's ellipse and its slide number come first; its title and body placeholders do not.
    const [logo, number, title] = first?.elements ?? [];
    expect(logo).toMatchObject({ geometry: { name: "ellipse" }, fill: { color: "#c00000" } });
    expect(number?.type === "shape" && bodyText(number.text)).toBe("1");
    expect(title).toMatchObject({ placeholder: "title", box: { x: 36, y: 18, w: 648, h: 72 } });
    const heading = shapeAt(first?.elements, 2).text;
    expect(heading?.anchor).toBe("middle");
    expect(heading?.paragraphs[0]?.align).toBe("center");
    expect(heading?.paragraphs[0]?.runs[0]).toMatchObject({
      text: "Hello",
      size: 40,
      bold: true,
      font: "Georgia",
      color: "#1f3864",
    });
    const body = shapeAt(first?.elements, 3).text?.paragraphs;
    expect(
      body?.map((p) => [
        p.runs[0]?.text,
        p.level,
        p.bullet?.text,
        p.runs[0]?.size,
        p.marginLeft,
        p.indent,
      ]),
    ).toEqual([
      ["One", 0, "•", 28, 27, -27],
      ["Two", 1, "–", 24, 54, -27],
    ]);
  });

  it("gradients with a focus, colours of the shape's own, links, numbering and groups", async () => {
    const deck = await deckOf(powerPointDeck(), "styled.ppt");
    const elements = deck.slides[0]?.elements;
    const gradient = shapeAt(elements, 4);
    expect(gradient.fill).toEqual({
      type: "gradient",
      shape: "linear",
      angle: 180,
      stops: [
        { pos: 0, color: "#0000ff" },
        { pos: 0.5, color: "#ff0000" },
        { pos: 1, color: "#0000ff" },
      ],
    });
    expect(gradient.line).toMatchObject({ color: "#800000", width: 2 });
    const list = shapeAt(elements, 5).text?.paragraphs;
    expect(list?.map((p) => p.bullet?.text)).toEqual(["1.", "2."]);
    expect(list?.[0]?.runs[0]).toMatchObject({ text: "First", color: "#0563c1", underline: true });
    expect(list?.[1]?.runs[0]).toMatchObject({
      text: "Second",
      color: "#202020",
      underline: false,
    });
    const g = elements?.[6];
    expect(g?.type).toBe("group");
    if (g?.type !== "group") return;
    expect(g.box).toMatchObject({ x: 450, y: 126, w: 144, h: 72 });
    expect(g.children[0]).toMatchObject({
      box: { x: 0, y: 0, w: 72, h: 72, rot: 30 },
      fill: { type: "solid", color: "#00ff00" },
    });
    expect(deck.slides[0]?.notes).toBe("Speak.\nSmile.");
    expect(deck.slides[0]?.background).toEqual({ type: "solid", color: "#ffffff" });
  });

  it("a slide's own scheme and background, without the master's shapes; metafiles are labelled", async () => {
    const deck = await deckOf(powerPointDeck(), "styled.ppt");
    const slide = deck.slides[1];
    expect(slide?.hidden).toBe(true);
    expect(slide?.background).toEqual({ type: "solid", color: "#ffffcc" });
    const [plain, wmf, png] = slide?.elements ?? [];
    expect(plain?.type === "shape" && plain.text?.paragraphs[0]?.runs[0]?.color).toBe("#336699");
    expect(wmf).toMatchObject({ type: "picture", image: null, label: "Windows Metafile picture" });
    expect(png?.type === "picture" && (await deck.image(png.image ?? ""))).toMatch(
      /^data:image\/png;base64,iVBOR/,
    );
  });

  it("an encrypted .ppt opens as the details view", async () => {
    const user = new Uint8Array(32);
    const view = new DataView(user.buffer);
    view.setUint16(2, 0x0ff6, true);
    view.setUint32(4, 24, true);
    view.setUint32(8, 20, true);
    view.setUint32(12, 0xf3d1c4df, true);
    const bytes = cfb({ "Current User": user, "PowerPoint Document": new Uint8Array(64) });
    const opened = await openFile(bytes, "locked.ppt");
    expect(opened).toMatchObject({ kind: "details", reason: "This presentation is encrypted." });
  });
});
