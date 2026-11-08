// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { bodyText, deckOf, fixture, shapes, slideText } from "./model";
import { odp, page } from "./odp";

const cm = (n: number) => (n * 72) / 2.54;
const near = (n: number) => expect.closeTo(n, 3);

const TITLE = `<draw:frame presentation:style-name="pr1" presentation:class="title" svg:x="2cm" svg:y="1cm" svg:width="24cm" svg:height="3cm"><draw:text-box><text:p>Hello <text:span text:style-name="T1">ODP</text:span></text:p></draw:text-box></draw:frame>`;
const OUTLINE = `<draw:frame presentation:style-name="pr2" presentation:class="outline" svg:x="2cm" svg:y="4.5cm" svg:width="24cm" svg:height="9cm"><draw:text-box>
<text:list text:style-name="L1"><text:list-item><text:p>First point</text:p><text:list><text:list-item><text:p>A detail</text:p></text:list-item></text:list></text:list-item></text:list>
<text:p text:style-name="P1">Right<text:s text:c="2"/>aligned</text:p></draw:text-box></draw:frame>`;
const IMAGE = `<draw:frame draw:name="Dot" svg:x="20cm" svg:y="5cm" svg:width="4cm" svg:height="2cm"><draw:image xlink:href="Pictures/dot.png"/><svg:desc>A dot</svg:desc></draw:frame>`;
const SHAPES = `<draw:custom-shape draw:style-name="gr1" svg:x="1cm" svg:y="10cm" svg:width="5cm" svg:height="3cm"><text:p>Box</text:p><draw:enhanced-geometry draw:type="rectangle"/></draw:custom-shape>
<draw:custom-shape draw:style-name="gr1" svg:x="7cm" svg:y="10cm" svg:width="3cm" svg:height="3cm"><draw:enhanced-geometry draw:type="ellipse"/></draw:custom-shape>
<draw:custom-shape draw:style-name="gr1" svg:x="11cm" svg:y="10cm" svg:width="3cm" svg:height="3cm"><draw:enhanced-geometry draw:type="mso-spt100"/></draw:custom-shape>`;

describe("ODF presentations", () => {
  it("frames, text, an image, custom shapes and the master background", async () => {
    const deck = await deckOf(
      odp(page("One", TITLE + OUTLINE + IMAGE + SHAPES, "Speak slowly.\nSmile.")),
      "a.odp",
    );
    expect(deck.size.width).toBeCloseTo(cm(28), 3);
    expect(deck.size.height).toBeCloseTo(cm(15.75), 3);
    const [slide] = deck.slides;
    expect(slide?.background).toEqual({ type: "solid", color: "#123456" });
    expect(slide?.title).toBe("Hello ODP");
    expect(slide?.notes).toBe("Speak slowly.\nSmile.");

    const all = shapes(slide);
    const title = all.find((s) => s.placeholder === "title");
    expect(title?.box).toMatchObject({
      x: near(cm(2)),
      y: near(cm(1)),
      w: near(cm(24)),
      h: near(cm(3)),
    });
    expect(title?.text?.anchor).toBe("middle");
    const [hello, odpRun] = title?.text?.paragraphs[0]?.runs ?? [];
    expect(hello).toMatchObject({
      text: "Hello ",
      size: 44,
      font: "Georgia",
      color: "#1f1f1f",
      bold: false,
    });
    expect(odpRun).toMatchObject({ text: "ODP", size: 44, bold: true, color: "#cc0000" });
    expect(title?.text?.paragraphs[0]?.align).toBe("center");

    const outline = all.find((s) => s.placeholder === "outline");
    const paragraphs = outline?.text?.paragraphs ?? [];
    expect(
      paragraphs.map((p) => [p.runs.map((r) => r.text).join(""), p.level, p.bullet?.text ?? null]),
    ).toEqual([
      ["First point", 0, "●"],
      ["A detail", 1, "–"],
      ["Right  aligned", 0, null],
    ]);
    expect(paragraphs[1]?.runs[0]?.size).toBe(28);
    expect(paragraphs[2]?.align).toBe("right");

    const picture = slide?.elements.find((e) => e.type === "picture");
    expect(picture?.type).toBe("picture");
    if (picture?.type !== "picture") return;
    expect(picture.box).toMatchObject({
      x: near(cm(20)),
      y: near(cm(5)),
      w: near(cm(4)),
      h: near(cm(2)),
    });
    expect(picture.label).toBe("A dot");
    expect(await deck.image(picture.image ?? "")).toMatch(/^data:image\/png;base64,/);

    const box = all.find((s) => bodyText(s.text) === "Box");
    expect(box).toMatchObject({
      geometry: { name: "rect" },
      fill: { type: "solid", color: "#3366cc" },
    });
    expect(box?.line).toMatchObject({ color: "#000000", width: near(cm(0.1)) });
    const geometry = all
      .filter((s) => s.box.y > cm(9) && s.box.y < cm(11))
      .map((s) => s.geometry.name);
    // A custom shape it cannot draw is its bounding rectangle.
    expect(geometry).toEqual(["rect", "ellipse", "rect"]);

    // The master page's own shapes are drawn under the slide's; its placeholders are not.
    const logo = all.find((s) => s.fill.type === "solid" && s.fill.color === "#ff9900");
    expect(logo?.geometry.name).toBe("ellipse");
    expect(all.filter((s) => s.placeholder === "title")).toHaveLength(1);
  });

  it("hidden pages are marked", async () => {
    const deck = await deckOf(
      odp(page("One", TITLE) + page("Two", TITLE, "", ' draw:style-name="dp2"')),
      "a.odp",
    );
    expect(deck.slides.map((s) => s.hidden)).toEqual([false, true]);
  });

  it("a flat .fodp with an embedded image reads the same way", async () => {
    const png =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const bytes = odp(page("One", TITLE), "");
    const { zipText } = await import("./unzip");
    const content = await zipText(bytes, "content.xml");
    const styles = await zipText(bytes, "styles.xml");
    const inner = (xml: string, tag: string) =>
      xml.slice(xml.indexOf(`<${tag}>`) + tag.length + 2, xml.indexOf(`</${tag}>`));
    const flat = content
      .replace("<office:document-content", "<office:document")
      .replace("</office:document-content>", "</office:document>")
      .replace(
        "<office:automatic-styles>",
        `<office:styles>${inner(styles, "office:styles")}</office:styles><office:automatic-styles>${inner(styles, "office:automatic-styles")}`,
      )
      .replace(
        "<office:body>",
        `<office:master-styles>${inner(styles, "office:master-styles")}</office:master-styles><office:body>`,
      )
      .replace(
        "</draw:page>",
        `<draw:frame svg:x="1cm" svg:y="5cm" svg:width="2cm" svg:height="2cm"><draw:image><office:binary-data>${png}</office:binary-data></draw:image></draw:frame></draw:page>`,
      );
    const deck = await deckOf(new TextEncoder().encode(flat), "a.fodp");
    expect(deck.slides[0]?.title).toBe("Hello ODP");
    expect(deck.slides[0]?.background).toEqual({ type: "solid", color: "#123456" });
    const picture = deck.slides[0]?.elements.find((e) => e.type === "picture");
    expect(picture?.type === "picture" && (await deck.image(picture.image ?? ""))).toMatch(
      /^data:image\/png;base64,iVBOR/,
    );
  });

  it("LibreOffice: a deck converted from PowerPoint keeps its titles, text and notes", async () => {
    const deck = await deckOf(fixture("sample.odp"), "sample.odp");
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
    expect(slideText(deck.slides[1])).toContain("Revenue grew");
    expect(slideText(deck.slides[4])).toContain("North");
    expect(deck.slides[3]?.elements.some((e) => e.type === "picture")).toBe(true);
    expect(deck.slides[0]?.notes).toBe("Welcome. This deck is a test fixture.");
  });
});
