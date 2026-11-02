// @vitest-environment jsdom
// A slide's links: a hyperlinked run or a shape's click action opens with shell.open under one
// shell:open grant; javascript: and file: open nothing; a jump to another slide stays in the deck.
import { describe, expect, it, vi } from "vitest";
import type { Deck } from "../ui/deck.js";
import { openFile } from "../ui/open.js";
import { createView } from "../ui/view.js";
import { disk, mount } from "./harness";
import { odp, page } from "./odp";
import { loadPage } from "./page";
import { pptx, title, xfrm } from "./pptx";

const SCOPE = { permission: "shell:open", schemes: ["http", "https", "mailto"] };
const PKG = "http://schemas.openxmlformats.org/package/2006/relationships";
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

const run = (text: string, click = "") =>
  `<a:r><a:rPr lang="en-US">${click}</a:rPr><a:t>${text}</a:t></a:r>`;
const body = (name: string, paragraphs: string, click = "") =>
  `<p:sp><p:nvSpPr><p:cNvPr id="7" name="${name}">${click}</p:cNvPr><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(838200, 1825625, 10515600, 2000000)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr/>${paragraphs}</p:txBody></p:sp>`;

/** Two slides; the first has a web link, a script link, a file link, a jump and a linked shape. */
function linkedDeck() {
  const slide1 = [
    title("Links"),
    body(
      "Text 1",
      `<a:p>${run("Visit ")}${run("the report", '<a:hlinkClick r:id="rIdWeb"/>')}${run(".")}</a:p>` +
        `<a:p>${run("script", '<a:hlinkClick r:id="rIdScript"/>')}${run(" and ")}${run("hosts", '<a:hlinkClick r:id="rIdFile"/>')}</a:p>` +
        `<a:p>${run("Next", '<a:hlinkClick r:id="" action="ppaction://hlinkshowjump?jump=nextslide"/>')}</a:p>`,
    ),
    body("Mail 2", `<a:p>${run("Write to us")}</a:p>`, '<a:hlinkClick r:id="rIdMail"/>'),
  ].join("");
  const rels = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${PKG}">
<Relationship Id="rId1" Type="${REL}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
<Relationship Id="rIdWeb" Type="${REL}/hyperlink" Target="https://example.com/report" TargetMode="External"/>
<Relationship Id="rIdScript" Type="${REL}/hyperlink" Target="javascript:alert(1)" TargetMode="External"/>
<Relationship Id="rIdFile" Type="${REL}/hyperlink" Target="file:///etc/hosts" TargetMode="External"/>
<Relationship Id="rIdMail" Type="${REL}/hyperlink" Target="mailto:team@example.com" TargetMode="External"/>
</Relationships>`;
  return pptx([{ shapes: slide1 }, { shapes: title("Second") }], {
    "ppt/slides/_rels/slide1.xml.rels": rels,
  });
}

async function deckOf(bytes: Uint8Array, name: string): Promise<Deck> {
  const opened = await openFile(bytes, name);
  if (opened.kind !== "deck") throw new Error(`not a deck: ${JSON.stringify(opened)}`);
  return opened.deck;
}
type Linked = { text?: string; name?: string; link?: string };
const runsOf = (deck: Deck, slide: number) =>
  deck.slides[slide]?.elements.flatMap((el) =>
    el.type === "shape" ? (el.text?.paragraphs.flatMap((p) => p.runs) ?? []) : [],
  ) as Linked[];

describe("links in a presentation", () => {
  it("a PowerPoint run or shape gets its URL or slide; javascript: and file: get none", async () => {
    const deck = await deckOf(linkedDeck(), "links.pptx");
    const runs = runsOf(deck, 0);
    const link = (text: string) => runs.find((r) => r.text === text)?.link;
    expect(link("the report")).toBe("https://example.com/report");
    expect(link("Next")).toBe("#slide-2");
    expect(link("Visit ")).toBeUndefined();
    expect(link("script")).toBeUndefined();
    expect(link("hosts")).toBeUndefined();
    const mail = deck.slides[0]?.elements.find((el) => el.name === "Mail 2") as Linked;
    expect(mail.link).toBe("mailto:team@example.com");
  });

  it("an OpenDocument text:a gets its URL", async () => {
    const frame = (inner: string) =>
      `<draw:frame presentation:class="outline" svg:x="2cm" svg:y="5cm" svg:width="20cm" svg:height="8cm"><draw:text-box>${inner}</draw:text-box></draw:frame>`;
    const bytes = odp(
      page(
        "One",
        frame(
          '<text:p>See <text:a xlink:href="https://example.com/odp">the site</text:a> or <text:a xlink:href="javascript:alert(1)">this</text:a>.</text:p>',
        ),
      ),
    );
    const runs = runsOf(await deckOf(bytes, "links.odp"), 0);
    expect(runs.find((r) => r.text === "the site")?.link).toBe("https://example.com/odp");
    expect(runs.find((r) => r.text === "this")?.link).toBeUndefined();
  });
});

describe("following a link on screen", () => {
  async function shown() {
    loadPage();
    const external = vi.fn();
    const view = createView(document, { external });
    const opened = {
      kind: "deck" as const,
      format: "PowerPoint",
      deck: await deckOf(linkedDeck(), "l.pptx"),
    };
    view.show({ buffer: "b", path: "~/l.pptx", name: "l.pptx", size: 1, opened });
    const frame = document.getElementById("slide-frame") as HTMLElement;
    const at = (text: string) =>
      Array.from(frame.querySelectorAll<HTMLElement>("[data-link]")).find((el) =>
        el.textContent?.includes(text),
      ) as HTMLElement;
    return { view, external, frame, at };
  }

  it("a click hands the URL over; the links on the slide are named and in the tab order", async () => {
    const { external, frame, at } = await shown();
    const links = Array.from(frame.querySelectorAll<HTMLElement>("[data-link]"));
    expect(links.map((el) => [el.getAttribute("role"), el.tabIndex, el.title])).toEqual([
      ["link", 0, "https://example.com/report"],
      ["link", 0, "Slide 2"],
      ["link", 0, "mailto:team@example.com"],
    ]);
    at("the report").click();
    at("Write to us").click();
    expect(external.mock.calls).toEqual([
      ["https://example.com/report"],
      ["mailto:team@example.com"],
    ]);
    const thumbs = document.querySelectorAll<HTMLElement>("#rail [data-link]");
    for (const thumb of thumbs) expect(thumb.tabIndex).toBe(-1);
  });

  it("Enter on a jump goes to its slide and opens nothing", async () => {
    const { external, at } = await shown();
    const next = at("Next");
    next.focus();
    next.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
    expect(document.getElementById("stage")?.getAttribute("aria-label")).toBe("Slide 2 of 2");
    expect(external).not.toHaveBeenCalled();
  });

  it("in play mode a link is followed instead of going on to the next slide", async () => {
    const { external } = await shown();
    document.getElementById("play")?.click();
    const stage = document.getElementById("player-stage") as HTMLElement;
    const report = Array.from(stage.querySelectorAll<HTMLElement>("[data-link]")).find((el) =>
      el.textContent?.includes("the report"),
    );
    report?.click();
    expect(external).toHaveBeenCalledWith("https://example.com/report");
    expect(document.getElementById("player-counter")?.textContent).toBe("1 / 2");
  });
});

describe("opening a link", () => {
  it("runs shell.open with the URL and the shell:open scope; one grant covers every link", async () => {
    const prompt = vi.fn(() => true);
    const { app, params, host } = await mount({ handlers: disk({}), prompt });
    await app.external("https://example.com/report");
    await app.external("mailto:team@example.com");
    expect(params("shell.open")).toEqual([
      { target: "https://example.com/report", scope: SCOPE },
      { target: "mailto:team@example.com", scope: SCOPE },
    ]);
    expect(prompt).toHaveBeenCalledOnce();
    expect(host.calls.some((c) => c.method === "perm.request")).toBe(false);
  });

  it("javascript: and file: open nothing", async () => {
    const { app, params } = await mount({ handlers: disk({}) });
    for (const url of ["javascript:alert(1)", "file:///etc/hosts", "#slide-2", "ftp://x.test/"])
      await app.external(url);
    expect(params("shell.open")).toEqual([]);
  });

  it("a refusal is said on the status line, with no second ask and no retry", async () => {
    const { app, params, view } = await mount({ handlers: disk({}), prompt: () => false });
    await app.external("https://example.com/report");
    expect(params("shell.open")).toHaveLength(1);
    expect(params("perm.request")).toEqual([]);
    expect(view.statuses.at(-1)).toBe("Could not open https://example.com/report: not allowed.");
  });
});
