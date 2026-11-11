// A document that slept comes back where the person was, and can be switched to (#162, ADR 0176), on
// the CEF desk with no window out of sight kept live (desk.surfaces.live 0): the opener's window
// goes to a desktop of the case's own, sleeps there, and wakes when the person goes there
// (support/sleep.ts). Docs, Slides, Web and Archives. The editors are in sleep-openers.spec.ts,
// images and video in sleep-media.spec.ts.
import { copyFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { browser, expect } from "@wdio/globals";
import { inFrame, press } from "../support/desk";
import {
  desktopsOfItsOwn,
  filesFolder,
  mark,
  marked,
  show,
  sleepOn,
  startWithNoneLive,
  wakeOn,
} from "../support/sleep";
import { run } from "../support/windows";

const DOCS = "endue.docs";
const SLIDES = "endue.slides";
const WEB = "endue.web";
const root = fileURLToPath(new URL("../..", import.meta.url));

/** A saved page long enough to scroll. */
const LONG_PAGE = `<!doctype html><title>Long page</title>${Array.from(
  { length: 200 },
  (_, i) => `<p id="p${i}">Paragraph ${i} of a page the person reads down.</p>`,
).join("")}`;

describe("document openers: a document that slept comes back where it was (#162)", () => {
  let files = "";

  before(async function () {
    this.timeout(180_000);
    files = filesFolder();
    await startWithNoneLive();
  });

  it("Docs: a document comes back on its page, at the zoom the person chose, and can be switched to", async function () {
    this.timeout(120_000);
    const rich = join(files, "rich.docx");
    copyFileSync(join(root, "plugins/docs/tests/fixtures/rich.docx"), rich);
    const own = await desktopsOfItsOwn();
    const id = await run("desk.files.open", { path: rich });
    await show(DOCS);
    const now = () =>
      inFrame(DOCS, () =>
        browser.execute(() => {
          const desk = document.getElementById("desk");
          return {
            name: document.getElementById("doc-name")?.textContent ?? "",
            zoom: document.getElementById("zoom-level")?.textContent ?? "",
            top: desk?.scrollTop ?? 0,
            pages: document.querySelectorAll(".page").length,
          };
        }),
      );
    await browser.waitUntil(async () => (await now()).pages >= 2, {
      timeoutMsg: "Docs did not draw rich.docx",
    });
    // The person zooms in twice and scrolls down into the document.
    await inFrame(DOCS, async () => {
      await press("#zoom-in");
      await press("#zoom-in");
      await browser.execute(() => {
        const desk = document.getElementById("desk");
        if (desk) desk.scrollTop = Math.round(desk.scrollHeight / 2);
      });
    });
    const before = await now();
    expect(before.top).toBeGreaterThan(0);
    await mark(DOCS);

    await sleepOn(DOCS, own);
    await wakeOn(DOCS, own);
    await browser.waitUntil(
      async () => {
        const back = await now().catch(() => undefined);
        return (
          back?.name === "rich.docx" &&
          back.zoom === before.zoom &&
          Math.abs(back.top - before.top) < 24
        );
      },
      { timeoutMsg: `Docs did not come back as ${JSON.stringify(before)}` },
    );
    // A new page, not the old one kept: the place came back from what the sleep kept.
    expect(await marked(DOCS)).toBe(false);
    // The desk still lists the document, and a switch to it reaches it ("No document" before).
    await run("desk.buffers.switch", { id });
    expect((await now()).name).toBe("rich.docx");
  });

  it("Slides: a presentation comes back on the slide the person was on, and can be switched to", async function () {
    this.timeout(120_000);
    const deck = join(files, "sample.pptx");
    copyFileSync(join(root, "plugins/slides/tests/fixtures/sample.pptx"), deck);
    const own = await desktopsOfItsOwn();
    const id = await run("desk.files.open", { path: deck });
    await show(SLIDES);
    const slide = () =>
      inFrame(SLIDES, () =>
        browser.execute(() => ({
          name: document.getElementById("deck-name")?.textContent ?? "",
          at: document.getElementById("stage")?.getAttribute("aria-label") ?? "",
        })),
      );
    await browser.waitUntil(async () => (await slide()).name === "sample.pptx", {
      timeoutMsg: "Slides did not open sample.pptx",
    });
    // The person picks the fourth slide in the rail.
    await inFrame(SLIDES, () => press("#rail li:nth-child(4) button"));
    await browser.waitUntil(async () => (await slide()).at.startsWith("Slide 4 of"), {
      timeoutMsg: "the rail did not go to slide 4",
    });
    const before = await slide();
    await mark(SLIDES);

    await sleepOn(SLIDES, own);
    await wakeOn(SLIDES, own);
    await browser.waitUntil(
      async () => {
        const back = await slide().catch(() => undefined);
        return back?.name === before.name && back.at === before.at;
      },
      { timeoutMsg: `Slides did not come back as ${JSON.stringify(before)}` },
    );
    // A new page, not the old one kept: the slide came back from what the sleep kept.
    expect(await marked(SLIDES)).toBe(false);
    // The desk still lists the presentation, and a switch to it reaches it ("No presentation" before).
    await run("desk.buffers.switch", { id });
    expect((await slide()).name).toBe("sample.pptx");
  });

  it("Web: a saved page comes back as far down as the person read, and can be switched to", async function () {
    this.timeout(120_000);
    const html = join(files, "long.html");
    writeFileSync(html, LONG_PAGE);
    const own = await desktopsOfItsOwn();
    const id = await run("desk.files.open", { path: html });
    await show(WEB);
    const now = () =>
      inFrame(WEB, () =>
        browser.execute(() => {
          const page = document.getElementById("page");
          return {
            name: document.getElementById("file-name")?.textContent ?? "",
            down: page && page.scrollHeight > 0 ? page.scrollTop / page.scrollHeight : 0,
            tall: page ? page.scrollHeight > page.clientHeight * 2 : false,
          };
        }),
      );
    await browser.waitUntil(async () => (await now()).tall, {
      timeoutMsg: "Web did not draw long.html",
    });
    // The person reads half way down the page.
    await inFrame(WEB, () =>
      browser.execute(() => {
        const page = document.getElementById("page");
        if (page) page.scrollTop = Math.round(page.scrollHeight / 2);
      }),
    );
    const before = await now();
    expect(before.down).toBeGreaterThan(0.3);
    await mark(WEB);

    await sleepOn(WEB, own);
    await wakeOn(WEB, own);
    await browser.waitUntil(
      async () => {
        const back = await now().catch(() => undefined);
        return back?.name === "long.html" && Math.abs(back.down - before.down) < 0.02;
      },
      { timeoutMsg: `Web did not come back as ${JSON.stringify(before)}` },
    );
    expect(await marked(WEB)).toBe(false);
    // The desk still lists the page, and a switch to it reaches it ("No file" before).
    await run("desk.buffers.switch", { id });
    expect((await now()).name).toBe("long.html");
  });

  it("Archives: an archive comes back on its open folder and selected entry, and can be switched to", async function () {
    this.timeout(120_000);
    const ARCHIVES = "endue.archives";
    const zip = join(files, "tree.zip");
    copyFileSync(join(root, "plugins/archives/tests/fixtures/tree.zip"), zip);
    const own = await desktopsOfItsOwn();
    const id = await run("desk.files.open", { path: zip });
    await show(ARCHIVES);
    /** The archive's name, the folders open in its tree and the selected entry, from the page. */
    const now = () =>
      inFrame(ARCHIVES, () =>
        browser.execute(() => ({
          name: document.getElementById("archive-name")?.textContent ?? "",
          open: [...document.querySelectorAll<HTMLElement>("#tree [aria-expanded='true']")].map(
            (row) => row.dataset.id ?? "",
          ),
          selected:
            document.querySelector<HTMLElement>("#tree [aria-selected='true']")?.dataset.id ?? "",
        })),
      );
    await browser.waitUntil(async () => (await now()).name === "tree.zip", {
      timeoutMsg: "Archives did not open tree.zip",
    });
    // The first row, docs, is selected; the person opens it and goes down to its second entry.
    await inFrame(ARCHIVES, () => browser.keys(["ArrowRight", "ArrowDown", "ArrowDown"]));
    const left = { name: "tree.zip", open: ["docs"], selected: "docs/한글.txt" };
    await browser.waitUntil(async () => JSON.stringify(await now()) === JSON.stringify(left), {
      timeoutMsg: "the tree is not on docs/한글.txt",
    });
    await mark(ARCHIVES);

    await sleepOn(ARCHIVES, own);
    await wakeOn(ARCHIVES, own);
    await browser.waitUntil(
      async () => JSON.stringify(await now().catch(() => undefined)) === JSON.stringify(left),
      { timeoutMsg: `Archives did not come back as ${JSON.stringify(left)}` },
    );
    // A new page, not the old one kept: the folder and the entry came back from the sleep.
    expect(await marked(ARCHIVES)).toBe(false);
    // The desk still lists the archive, and a switch to it reaches it ("No archive" before).
    await run("desk.buffers.switch", { id });
    expect((await now()).name).toBe("tree.zip");
  });
});
