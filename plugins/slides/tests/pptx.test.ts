// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { bodyText, deckOf, fixture, flat, shapes, slideText } from "./model";
import { EMU, LAYOUT_TITLE, pptx, shape, title, xfrm } from "./pptx";

const pt = (emu: number) => emu / EMU;

describe("PresentationML", () => {
  it("a title placeholder takes its box from the layout and its font from the master", async () => {
    const deck = await deckOf(pptx([{ shapes: title("Hello") }]), "a.pptx");
    expect(deck.size).toEqual({ width: 960, height: 540 });
    const [slide] = deck.slides;
    const heading = shapes(slide).find((s) => s.placeholder === "title");
    expect(heading?.box).toMatchObject({
      x: pt(LAYOUT_TITLE.x),
      y: pt(LAYOUT_TITLE.y),
      w: pt(LAYOUT_TITLE.w),
      h: pt(LAYOUT_TITLE.h),
    });
    const run = heading?.text?.paragraphs[0]?.runs[0];
    expect(run).toMatchObject({
      text: "Hello",
      size: 44,
      bold: true,
      font: "Georgia",
      color: "#000000",
    });
    // The master's bodyPr anchors the title at the bottom; the layout and slide do not say otherwise.
    expect(heading?.text?.anchor).toBe("bottom");
    expect(slide?.title).toBe("Hello");
    expect(slide?.background).toEqual({ type: "solid", color: "#fafafa" });
  });

  it("a theme colour with lumMod resolves to RGB", async () => {
    const fill = `<a:solidFill><a:schemeClr val="accent1"><a:lumMod val="75000"/></a:schemeClr></a:solidFill>`;
    const line = `<a:ln w="25400"><a:solidFill><a:schemeClr val="accent2"><a:lumMod val="60000"/><a:lumOff val="40000"/></a:schemeClr></a:solidFill><a:prstDash val="dash"/></a:ln>`;
    const deck = await deckOf(
      pptx([{ shapes: shape("rect", [0, 0, 914400, 914400], fill + line) }]),
      "a.pptx",
    );
    const [rect] = shapes(deck.slides[0]);
    expect(rect?.fill).toEqual({ type: "solid", color: "#2f5597" });
    expect(rect?.line).toMatchObject({ color: "#f4b183", width: 2, dash: "dash" });
  });

  it("a roundRect, an ellipse and an arrow keep their geometry", async () => {
    const adj = `<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 25000"/></a:avLst></a:prstGeom>`;
    const round = `<p:sp><p:nvSpPr><p:cNvPr id="7" name="Round"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(0, 0, 1270000, 635000)}${adj}</p:spPr></p:sp>`;
    const deck = await deckOf(
      pptx([
        {
          shapes:
            round +
            shape("ellipse", [1270000, 0, 1270000, 1270000]) +
            shape("rightArrow", [2540000, 0, 2540000, 1270000], "", "Next") +
            shape("cloud", [0, 2540000, 1270000, 1270000]),
        },
      ]),
      "a.pptx",
    );
    const [r, e, a, c] = shapes(deck.slides[0]);
    expect(r?.geometry).toEqual({ name: "roundRect", adjust: { adj: 25000 } });
    expect(r?.box).toMatchObject({ x: 0, y: 0, w: 100, h: 50 });
    expect(e?.geometry).toMatchObject({ name: "ellipse" });
    expect(e?.box).toMatchObject({ x: 100, w: 100, h: 100 });
    expect(a?.geometry).toMatchObject({ name: "rightArrow" });
    expect(bodyText(a?.text)).toBe("Next");
    // A preset it does not draw is its bounding rectangle.
    expect(c?.geometry).toMatchObject({ name: "rect" });
  });

  it("a line keeps its arrow head", async () => {
    const ln = `<a:ln w="38100"><a:solidFill><a:srgbClr val="333333"/></a:solidFill><a:tailEnd type="triangle"/></a:ln>`;
    const cxn = `<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="9" name="Connector"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr>${xfrm(0, 0, 2540000, 0)}<a:prstGeom prst="straightConnector1"><a:avLst/></a:prstGeom>${ln}</p:spPr></p:cxnSp>`;
    const deck = await deckOf(pptx([{ shapes: cxn }]), "a.pptx");
    const [line] = shapes(deck.slides[0]);
    expect(line?.geometry).toMatchObject({ name: "line" });
    expect(line?.line).toMatchObject({
      color: "#333333",
      width: 3,
      head: "none",
      tail: "triangle",
    });
  });

  it("a picture keeps its crop", async () => {
    const pic = `<p:pic><p:nvPicPr><p:cNvPr id="5" name="Picture 4" descr="A dot"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>
<p:blipFill><a:blip r:embed="rId9"/><a:srcRect l="10000" t="5000" r="20000"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>
<p:spPr>${xfrm(1270000, 1270000, 2540000, 1270000)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
    const deck = await deckOf(pptx([{ shapes: pic }]), "a.pptx");
    const [picture] = deck.slides[0]?.elements ?? [];
    expect(picture?.type).toBe("picture");
    if (picture?.type !== "picture") return;
    expect(picture.box).toMatchObject({ x: 100, y: 100, w: 200, h: 100 });
    expect(picture.crop).toEqual({ left: 0.1, top: 0.05, right: 0.2, bottom: 0 });
    expect(picture.label).toBe("A dot");
    expect(await deck.image(picture.image ?? "")).toMatch(/^data:image\/png;base64,iVBOR/);
  });

  it("a group transform moves and scales its children", async () => {
    const group = `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="20" name="Group"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm><a:off x="1270000" y="1270000"/><a:ext cx="2540000" cy="2540000"/><a:chOff x="0" y="0"/><a:chExt cx="5080000" cy="5080000"/></a:xfrm></p:grpSpPr>
${shape("rect", [2540000, 0, 2540000, 2540000])}${shape("ellipse", [0, 2540000, 2540000, 2540000])}</p:grpSp>`;
    const deck = await deckOf(pptx([{ shapes: group }]), "a.pptx");
    const [g] = deck.slides[0]?.elements ?? [];
    expect(g?.type).toBe("group");
    if (g?.type !== "group") return;
    expect(g.box).toMatchObject({ x: 100, y: 100, w: 200, h: 200 });
    // Children are placed in the group's box: the child frame of 400 points is drawn in 200.
    expect(g.children.map((c) => c.box)).toMatchObject([
      { x: 100, y: 0, w: 100, h: 100 },
      { x: 0, y: 100, w: 100, h: 100 },
    ]);
  });

  it("a table keeps its cell fills, borders and text", async () => {
    const cell = (text: string, fill: string) =>
      `<a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>${text}</a:t></a:r></a:p></a:txBody><a:tcPr><a:lnB w="12700"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a:lnB>${fill}</a:tcPr></a:tc>`;
    const solid = (hex: string) => `<a:solidFill><a:srgbClr val="${hex}"/></a:solidFill>`;
    const table = `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="30" name="Table"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>
<p:xfrm><a:off x="0" y="0"/><a:ext cx="2540000" cy="1270000"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">
<a:tbl><a:tblPr firstRow="1"/><a:tblGrid><a:gridCol w="1270000"/><a:gridCol w="1270000"/></a:tblGrid>
<a:tr h="635000">${cell("Region", solid("1F4E79"))}${cell("Q1", `<a:solidFill><a:schemeClr val="accent6"/></a:solidFill>`)}</a:tr>
<a:tr h="635000">${cell("North", solid("DDEBF7"))}${cell("10", "<a:noFill/>")}</a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
    const deck = await deckOf(pptx([{ shapes: table }]), "a.pptx");
    const [t] = deck.slides[0]?.elements ?? [];
    expect(t?.type).toBe("table");
    if (t?.type !== "table") return;
    expect(t.columns).toEqual([100, 100]);
    expect(t.rows.map((r) => r.height)).toEqual([50, 50]);
    expect(t.rows.map((r) => r.cells.map((c) => c.fill))).toEqual([
      [
        { type: "solid", color: "#1f4e79" },
        { type: "solid", color: "#70ad47" },
      ],
      [{ type: "solid", color: "#ddebf7" }, { type: "none" }],
    ]);
    expect(t.rows[0]?.cells[0]?.borders.bottom).toMatchObject({ color: "#ff0000", width: 1 });
    expect(bodyText(t.rows[1]?.cells[0]?.text)).toBe("North");
  });

  it("notes, hidden slides and gradient backgrounds are read", async () => {
    const bg = `<p:bg><p:bgPr><a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="FFFFFF"/></a:gs><a:gs pos="100000"><a:srgbClr val="000000"/></a:gs></a:gsLst><a:lin ang="5400000"/></a:gradFill></p:bgPr></p:bg>`;
    const deck = await deckOf(
      pptx([
        { shapes: title("One"), notes: "Say hello.\nThen go on." },
        { shapes: title("Two"), hidden: true, background: bg },
      ]),
      "a.pptx",
    );
    expect(deck.slides.map((s) => s.notes)).toEqual(["Say hello.\nThen go on.", ""]);
    expect(deck.slides.map((s) => s.hidden)).toEqual([false, true]);
    expect(deck.slides[1]?.background).toEqual({
      type: "gradient",
      shape: "linear",
      angle: 180,
      stops: [
        { pos: 0, color: "#ffffff" },
        { pos: 1, color: "#000000" },
      ],
    });
  });

  it("autofit scales the text and bullets come from the master", async () => {
    const body = `<p:sp><p:nvSpPr><p:cNvPr id="3" name="Body"/><p:cNvSpPr/><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:spPr/>
<p:txBody><a:bodyPr><a:normAutofit fontScale="50000"/></a:bodyPr><a:p><a:r><a:t>One</a:t></a:r></a:p><a:p><a:pPr lvl="1"/><a:r><a:t>Two</a:t></a:r></a:p>
<a:p><a:pPr><a:buAutoNum type="arabicPeriod"/></a:pPr><a:r><a:t>Three</a:t></a:r></a:p><a:p><a:pPr><a:buAutoNum type="arabicPeriod"/></a:pPr><a:r><a:t>Four</a:t></a:r></a:p></p:txBody></p:sp>`;
    const deck = await deckOf(pptx([{ shapes: body }]), "a.pptx");
    const [shapeBody] = shapes(deck.slides[0]);
    // Placed by the master's body placeholder, which the layout's idx 1 inherits.
    expect(shapeBody?.box).toMatchObject({ x: pt(838200), y: pt(1825625) });
    const paragraphs = shapeBody?.text?.paragraphs ?? [];
    expect(paragraphs.map((p) => [p.bullet?.text, p.runs[0]?.size, p.runs[0]?.font])).toEqual([
      ["•", 14, "Verdana"],
      ["–", 12, "Verdana"],
      ["1.", 14, "Verdana"],
      ["2.", 14, "Verdana"],
    ]);
    expect(paragraphs[1]?.marginLeft).toBe(pt(685800));
  });
});

describe("PresentationML drawings and templates", () => {
  const frame = (uri: string, inner: string) =>
    `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="40" name="Frame"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="1270000" y="0"/><a:ext cx="2540000" cy="1270000"/></p:xfrm><a:graphic><a:graphicData uri="${uri}">${inner}</a:graphicData></a:graphic></p:graphicFrame>`;
  const DGM = "http://schemas.openxmlformats.org/drawingml/2006/diagram";
  const CHART = "http://schemas.openxmlformats.org/drawingml/2006/chart";

  it("SmartArt shows its cached drawing; a chart without one is a labelled box", async () => {
    const smartArt = frame(
      DGM,
      `<dgm:relIds xmlns:dgm="${DGM}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:dm="rId20" r:lo="rId21" r:qs="rId22" r:cs="rId23"/>`,
    );
    const chart = frame(
      CHART,
      `<c:chart xmlns:c="${CHART}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId30"/>`,
    );
    const data = `<?xml version="1.0"?><dgm:dataModel xmlns:dgm="${DGM}" xmlns:dsp="http://schemas.microsoft.com/office/drawing/2008/diagram"><dgm:extLst><dgm:ext><dsp:dataModelExt relId="rId24"/></dgm:ext></dgm:extLst></dgm:dataModel>`;
    const drawing = `<?xml version="1.0"?><dsp:drawing xmlns:dsp="http://schemas.microsoft.com/office/drawing/2008/diagram" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><dsp:spTree><dsp:nvGrpSpPr><dsp:cNvPr id="0" name=""/><dsp:cNvGrpSpPr/></dsp:nvGrpSpPr><dsp:grpSpPr/>
<dsp:sp modelId="{1}"><dsp:nvSpPr><dsp:cNvPr id="0" name=""/><dsp:cNvSpPr/></dsp:nvSpPr><dsp:spPr>${xfrm(0, 0, 1270000, 635000)}<a:prstGeom prst="chevron"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="00AA00"/></a:solidFill></dsp:spPr><dsp:txBody><a:bodyPr/><a:p><a:r><a:t>Step</a:t></a:r></a:p></dsp:txBody></dsp:sp></dsp:spTree></dsp:drawing>`;
    const deck = await deckOf(
      pptx(
        [
          {
            shapes: smartArt + chart,
            rels: [
              ["rId20", "diagramData", "../diagrams/data1.xml"],
              ["rId24", "diagramDrawing", "../diagrams/drawing1.xml"],
              ["rId30", "chart", "../charts/chart1.xml"],
            ],
          },
        ],
        { "ppt/diagrams/data1.xml": data, "ppt/diagrams/drawing1.xml": drawing },
      ),
      "a.pptx",
    );
    const [art, box] = deck.slides[0]?.elements ?? [];
    expect(art).toMatchObject({ type: "group", box: { x: 100, y: 0, w: 200, h: 100 } });
    const step = art?.type === "group" ? art.children[0] : undefined;
    expect(step).toMatchObject({
      type: "shape",
      geometry: { name: "chevron" },
      fill: { color: "#00aa00" },
      box: { x: 0, y: 0, w: 100, h: 50 },
    });
    expect(box).toMatchObject({ type: "placeholder", label: "Chart" });
  });

  it("a template without slides shows its layouts", async () => {
    const deck = await deckOf(pptx([]), "a.potx");
    expect(deck.format).toBe("PowerPoint template");
    expect(deck.slides.map((s) => s.title)).toEqual(["Layout title"]);
    expect(shapes(deck.slides[0]).map((s) => bodyText(s.text))).toEqual([
      "Layout title",
      "Layout body",
    ]);
  });
});

describe("PresentationML files made by real tools", () => {
  it("python-pptx: titles, shapes, a cropped picture, a table, notes and a hidden slide", async () => {
    const deck = await deckOf(fixture("sample.pptx"), "sample.pptx");
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
    expect(deck.slides.map((s) => s.hidden)).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
      true,
    ]);
    expect(slideText(deck.slides[1])).toBe("Agenda\nResults\nRevenue grew\nCosts fell\nPlans");
    const geometry = shapes(deck.slides[2]).map((s) => s.geometry.name);
    expect(geometry).toEqual(
      expect.arrayContaining([
        "roundRect",
        "ellipse",
        "rightArrow",
        "triangle",
        "chevron",
        "line",
        "diamond",
        "hexagon",
      ]),
    );
    const gradient = shapes(deck.slides[2]).find((s) => bodyText(s.text) === "Gradient");
    expect(gradient?.fill.type).toBe("gradient");
    const picture = flat(deck.slides[3]?.elements).find((e) => e.type === "picture");
    expect(picture).toMatchObject({ crop: { left: 0.1, right: 0.1 } });
    const table = deck.slides[4]?.elements.find((e) => e.type === "table");
    expect(table?.type === "table" && table.rows[0]?.cells[0]?.fill.type).toBe("solid");
    expect(slideText(deck.slides[4])).toContain("Region\nQ1\nQ2\nNorth");
    const numbers = shapes(deck.slides[5])
      .flatMap((s) => s.text?.paragraphs ?? [])
      .map((p) => p.bullet?.text);
    expect(numbers).toEqual(expect.arrayContaining(["1.", "2.", "3."]));
    expect(deck.slides[0]?.notes).toBe("Welcome. This deck is a test fixture.");
    expect(deck.slides[1]?.notes).toBe("Keep it short.\nTwo lines of notes.");
  });

  it("LibreOffice: the same deck written again keeps titles and notes", async () => {
    const deck = await deckOf(fixture("sample-lo.pptx"), "sample-lo.pptx");
    expect(deck.slides).toHaveLength(7);
    expect(deck.slides.map((s) => s.title).slice(0, 3)).toEqual([
      "Quarterly review",
      "Agenda",
      "Shapes",
    ]);
    expect(deck.slides[0]?.notes).toBe("Welcome. This deck is a test fixture.");
    expect(flat(deck.slides[3]?.elements).some((e) => e.type === "picture")).toBe(true);
  });
});
