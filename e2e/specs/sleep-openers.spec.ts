// A file window that slept comes back with its file, its place and its unsaved edits (#162, ADR
// 0176), on the CEF desk with no window out of sight kept live (desk.surfaces.live 0): the opener's
// window goes to another desktop, sleeps there, and wakes when the person goes there
// (support/sleep.ts). Here the openers that edit a file, Notes, Sheets and Data: their unsaved edits
// come back still marked, with nothing written. Images and the Player are in sleep-media.spec.ts,
// Docs, Slides, Web and Archives in sleep-documents.spec.ts; the other openers join as they take
// keepFiles.
// Reader's case is in its unit tests for now: on the machine this was written on, a woken Reader
// page stopped answering chromedriver.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { $, browser, expect } from "@wdio/globals";
import { inFrame } from "../support/desk";
import {
  asleep,
  type Buffers,
  desktopsOfItsOwn,
  filesFolder,
  mark,
  marked,
  NOTES,
  show,
  sleepOn,
  startWithNoneLive,
  wakeOn,
} from "../support/sleep";
import { run, until } from "../support/windows";

/** A 114 KB note, as the QA pass edited one: its state no longer fit the desk's 64 KiB. */
const LONG = `# Long note\n\n${"the desk keeps what a person was doing while a window sleeps\n".repeat(1900)}`;

describe("file openers: an edited file that slept comes back with its unsaved edits (#162)", () => {
  let files = "";

  before(async function () {
    this.timeout(180_000);
    files = filesFolder();
    writeFileSync(join(files, "long.md"), LONG);
    writeFileSync(join(files, "small.md"), "# Small note\n");
    await startWithNoneLive();
  });

  it("Notes: a 114 KB note and a small one, both unsaved, come back with their text, still marked", async function () {
    this.timeout(120_000);
    const long = join(files, "long.md");
    const small = join(files, "small.md");
    // The desk names each buffer as the OS names its file (`~/files/long.md` under the home folder).
    const longId = await run("desk.files.open", { path: long });
    const smallId = await run("desk.files.open", { path: small });
    await show(NOTES);
    await inFrame(NOTES, () => browser.keys(" KEEP-SMALL".split("")));
    await run("desk.buffers.switch", { id: longId });
    await inFrame(NOTES, () => browser.keys(" UNSAVED-LONG".split("")));
    const text = () => inFrame(NOTES, () => $("textarea").getValue());
    await browser.waitUntil(async () => (await text()).includes("UNSAVED-LONG"), {
      timeoutMsg: "the typed text is not in the note",
    });
    const typed = await text();
    await mark(NOTES);

    await sleepOn(NOTES, 2);
    await run("desk.shell.desktop-2");
    await until((d) => !asleep(d, NOTES), "Notes awake on desktop 2", 20_000);
    await browser.waitUntil(async () => (await text().catch(() => "")) === typed, {
      timeoutMsg: "the long note did not come back with its unsaved text",
    });
    // A new page, not the old one kept: the text came back from what the sleep kept.
    expect(await marked(NOTES)).toBe(false);
    expect(await inFrame(NOTES, () => $("body").getText())).toContain("Unsaved changes");
    await run("desk.buffers.switch", { id: smallId });
    await browser.waitUntil(async () => (await text()).includes("KEEP-SMALL"), {
      timeoutMsg: "the small note did not come back with its unsaved text",
    });
    const listed = (await run("desk.buffers.list")) as Buffers;
    expect(listed.filter((b) => b.plugin === NOTES && b.modified).map((b) => b.id)).toEqual(
      expect.arrayContaining([longId, smallId]),
    );
    // Nothing reached the disk.
    expect(readFileSync(long, "utf8")).toBe(LONG);
  });

  it("Sheets: a CSV with a cell typed and not saved comes back on the cell it was left at, the edit still there and marked", async function () {
    this.timeout(120_000);
    const SHEETS = "endue.sheets";
    const PEOPLE = "name,city\nAda,Paris\nGrace,London\n";
    const csv = join(files, "people.csv");
    writeFileSync(csv, PEOPLE);
    const own = await desktopsOfItsOwn();
    const id = await run("desk.files.open", { path: csv });
    await show(SHEETS);
    /** The cell in use, B2's text and the unsaved mark, read from the page's words. */
    const now = () =>
      inFrame(SHEETS, () =>
        browser.execute(() => ({
          address: document.getElementById("cell-address")?.textContent ?? "",
          b2: document.querySelector('[aria-rowindex="3"] [aria-colindex="3"]')?.textContent ?? "",
          unsaved: document.getElementById("book-mark")?.hidden === false,
        })),
      );
    // B2 typed over, then Enter: the cell below is the one in use.
    await inFrame(SHEETS, () =>
      browser.keys(["ArrowDown", "ArrowRight", ..."Lyon".split(""), "Enter"]),
    );
    const typed = { address: "B3", b2: "Lyon", unsaved: true };
    await browser.waitUntil(async () => JSON.stringify(await now()) === JSON.stringify(typed), {
      timeoutMsg: "the typed cell is not in the sheet",
    });
    await mark(SHEETS);

    await sleepOn(SHEETS, own);
    await wakeOn(SHEETS, own);
    await browser.waitUntil(
      async () => JSON.stringify(await now().catch(() => undefined)) === JSON.stringify(typed),
      { timeoutMsg: `Sheets did not come back as ${JSON.stringify(typed)}` },
    );
    // A new page, not the old one kept: the file, the cell and the edit came back from the sleep.
    expect(await marked(SHEETS)).toBe(false);
    const listed = (await run("desk.buffers.list")) as Buffers;
    expect(listed.find((b) => b.id === id)).toMatchObject({ plugin: SHEETS, modified: true });
    // Nothing reached the disk.
    expect(readFileSync(csv, "utf8")).toBe(PEOPLE);
  });

  it("Data: a JSON with a value edited and not saved comes back on the node it was left at, the edit still there and marked", async function () {
    this.timeout(120_000);
    const DATA = "endue.data";
    const CONFIG = '{\n  "name": "desk",\n  "version": 3,\n  "tls": false\n}\n';
    const json = join(files, "config.json");
    writeFileSync(json, CONFIG);
    const own = await desktopsOfItsOwn();
    const id = await run("desk.files.open", { path: json });
    await show(DATA);
    /** The selected row's words, whatever a narrow window cuts from view. */
    const row = () =>
      inFrame(DATA, () =>
        browser.execute(
          () => document.querySelector("#tree [aria-selected='true']")?.textContent ?? "",
        ),
      );
    // The root is selected; two rows down is version, which F2 opens in its row.
    await inFrame(DATA, () => browser.keys(["ArrowDown", "ArrowDown", "F2"]));
    await inFrame(DATA, () => $("#tree input").waitForExist());
    await inFrame(DATA, () => browser.keys(["4", "Enter"]));
    await browser.waitUntil(async () => /version.*4/.test(await row()), {
      timeoutMsg: "the edited value is not in the tree",
    });
    await mark(DATA);

    await sleepOn(DATA, own);
    await wakeOn(DATA, own);
    await browser.waitUntil(async () => /version.*4/.test(await row().catch(() => "")), {
      timeoutMsg: "the file did not come back on its edited value",
    });
    // A new page, not the old one kept: the file, the node and the value came back from the sleep.
    expect(await marked(DATA)).toBe(false);
    const listed = (await run("desk.buffers.list")) as Buffers;
    expect(listed.find((b) => b.id === id)).toMatchObject({ plugin: DATA, modified: true });
    // Nothing reached the disk.
    expect(readFileSync(json, "utf8")).toBe(CONFIG);
  });
});
