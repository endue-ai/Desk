import { describe, expect, it } from "vitest";
import { openFile } from "../ui/open.js";
import { cfb } from "./cfb";
import { bodyText, deckOf, fixture, flat, shapes } from "./model";

describe("PowerPoint 97-2003", () => {
  it("each slide's title and body text, laid out as a title over the body, marked text-only", async () => {
    const deck = await deckOf(fixture("sample.ppt"), "sample.ppt");
    expect(deck.textOnly).toBe(true);
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
    const [heading, body] = shapes(deck.slides[1]);
    expect(heading?.placeholder).toBe("title");
    expect(body?.placeholder).toBe("body");
    expect(bodyText(heading?.text)).toBe("Agenda");
    expect(bodyText(body?.text)).toBe("Results\nRevenue grew\nCosts fell\nPlans");
    expect(body?.text?.paragraphs.map((p) => p.level)).toEqual([0, 1, 1, 0]);
    // The title sits over the body.
    expect((heading?.box.y ?? 0) + (heading?.box.h ?? 0)).toBeLessThanOrEqual(body?.box.y ?? 0);
    expect(bodyText(shapes(deck.slides[0])[1]?.text)).toBe("Slides fixture deck");
    expect(deck.slides.map((s) => s.hidden)).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
      true,
    ]);
    expect(deck.slides[0]?.notes).toBe("Welcome. This deck is a test fixture.");
    expect(deck.slides[1]?.notes).toBe("Keep it short.\nTwo lines of notes.");
  });

  it("pictures come from the Pictures stream", async () => {
    const deck = await deckOf(fixture("sample.ppt"), "sample.ppt");
    const picture = flat(deck.slides[3]?.elements).find((e) => e.type === "picture");
    expect(picture?.type).toBe("picture");
    if (picture?.type !== "picture") return;
    expect(picture.box).toMatchObject({ x: 240, y: 144, w: 480, h: 300 });
    expect(await deck.image(picture.image ?? "")).toMatch(/^data:image\/png;base64,iVBOR/);
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
