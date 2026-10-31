import { afterEach, describe, expect, it, vi } from "vitest";
import { openBook } from "../ui/book.js";
import { disk, file, fixture, mount } from "./harness";

const utf8 = (text: string) => new TextEncoder().encode(text);
const SHORTCUT = JSON.stringify({
  url: "https://docs.google.com/spreadsheets/d/1AbCdEf/edit?usp=drivesdk",
  doc_id: "1AbCdEf",
  resource_id: "spreadsheet:1AbCdEf",
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("files that open as the details view", () => {
  it("a damaged workbook says so, and the parser stays quiet", () => {
    const errors = vi.spyOn(console, "error");
    const truncated = fixture("budget.xlsx").subarray(0, 3000);
    expect(openBook(truncated, { name: "budget.xlsx" })).toMatchObject({
      kind: "details",
      format: "Excel workbook",
      detected: "ZIP archive",
      reason: "This file is damaged or is not an Excel workbook.",
    });
    expect(errors).not.toHaveBeenCalled();
  });

  it("an encrypted workbook", () => {
    expect(openBook(fixture("encrypted.xlsx"), { name: "secret.xlsx" })).toMatchObject({
      kind: "details",
      format: "Excel workbook",
      detected: "OLE compound file",
      reason: "This workbook is encrypted.",
    });
  });

  it("text with a workbook's name, an empty file, and a ZIP without a workbook", () => {
    expect(openBook(utf8("just some words"), { name: "notes.ods" })).toMatchObject({
      kind: "details",
      detected: "Text",
      reason: "This file is damaged or is not an OpenDocument spreadsheet.",
    });
    // Bytes that no spreadsheet program writes: the parser would read them as text.
    const noise = Uint8Array.from({ length: 512 }, (_, i) => (i * 37 + 11) % 256);
    expect(openBook(noise, { name: "old.qpw" })).toMatchObject({
      kind: "details",
      detected: "Binary data",
      reason: "This file is damaged or is not a Quattro Pro notebook.",
    });
    expect(openBook(new Uint8Array(0), { name: "empty.xlsx" })).toMatchObject({
      kind: "details",
      detected: "Empty",
      reason: "The file is empty.",
    });
    // A ZIP archive with one stored file, "a.txt" holding "hi" (Python's zipfile wrote it).
    const zip = new Uint8Array([
      80, 75, 3, 4, 20, 0, 0, 0, 0, 0, 0, 0, 33, 0, 172, 42, 147, 216, 2, 0, 0, 0, 2, 0, 0, 0, 5, 0,
      0, 0, 97, 46, 116, 120, 116, 104, 105, 80, 75, 1, 2, 20, 3, 20, 0, 0, 0, 0, 0, 0, 0, 33, 0,
      172, 42, 147, 216, 2, 0, 0, 0, 2, 0, 0, 0, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 128, 1, 0, 0,
      0, 0, 97, 46, 116, 120, 116, 80, 75, 5, 6, 0, 0, 0, 0, 1, 0, 1, 0, 51, 0, 0, 0, 37, 0, 0, 0,
      0, 0,
    ]);
    expect(openBook(zip, { name: "archive.xlsx" })).toMatchObject({
      kind: "details",
      detected: "ZIP archive",
      reason: "This ZIP archive holds no workbook.",
    });
  });

  it("a Google Sheets shortcut is a card with the document's address", () => {
    expect(openBook(utf8(SHORTCUT), { name: "Plan.gsheet" })).toEqual({
      kind: "link",
      format: "Google Sheets shortcut",
      url: "https://docs.google.com/spreadsheets/d/1AbCdEf/edit?usp=drivesdk",
    });
    expect(openBook(utf8("{not json"), { name: "Plan.gsheet" })).toMatchObject({
      kind: "details",
      reason: "This shortcut holds no address of a Google Sheets document.",
    });
  });
});

describe("the details view through the desk's requests", () => {
  const BROKEN = file("~/Documents/broken.xlsx");
  const LOCKED = file("~/Documents/locked.xlsx");
  const SHORT = file("~/Drive/Plan.gsheet");

  it("damaged and encrypted files open with no uncaught error", async () => {
    const { host, view } = await mount({
      handlers: disk({
        [BROKEN.path]: fixture("budget.xlsx").subarray(0, 3000),
        [LOCKED.path]: fixture("encrypted.xlsx"),
      }),
    });
    await expect(host.command("desk.files.visit", BROKEN)).resolves.toBeUndefined();
    expect(view.shown.at(-1)).toMatchObject({
      ...BROKEN,
      name: "broken.xlsx",
      size: 3000,
      book: { kind: "details", reason: "This file is damaged or is not an Excel workbook." },
    });
    expect(view.statuses.at(-1)).toBe("This file is damaged or is not an Excel workbook.");

    await expect(host.command("desk.files.visit", LOCKED)).resolves.toBeUndefined();
    expect(view.shown.at(-1)?.book).toMatchObject({ reason: "This workbook is encrypted." });
    expect(view.statuses.at(-1)).toBe("This workbook is encrypted.");
  });

  it("a parser that throws still ends in the details view", async () => {
    const { host, view } = await mount({
      handlers: disk({ [BROKEN.path]: "x" }),
      open: () => {
        throw new TypeError("cannot read properties of undefined");
      },
    });
    await expect(host.command("desk.files.visit", BROKEN)).resolves.toBeUndefined();
    expect(view.shown.at(-1)?.book).toMatchObject({
      kind: "details",
      reason: "This file is damaged or is not an Excel workbook.",
    });
  });

  it("a shortcut opens as the card", async () => {
    const { host, view } = await mount({ handlers: disk({ [SHORT.path]: SHORTCUT }) });
    await host.command("desk.files.visit", SHORT);
    expect(view.shown.at(-1)?.book).toMatchObject({ kind: "link" });
    expect(view.statuses.at(-1)).toBe("Plan.gsheet is a Google Sheets shortcut.");
  });
});
