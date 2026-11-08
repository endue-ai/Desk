import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Cfb } from "../ui/cfb.js";
import { openDocument } from "../ui/open.js";
import { asDocument, runs, tableTexts, texts } from "./model";

const fixture = (name: string) =>
  new Uint8Array(readFileSync(join(import.meta.dirname, "fixtures", name)));

/** A copy of a .doc with bytes of its FIB (the start of the WordDocument stream) changed. */
function patched(bytes: Uint8Array, change: (fib: DataView) => void) {
  const out = bytes.slice();
  const entry = new Cfb(out).paths.get("worddocument");
  const at = ((entry?.start ?? 0) + 1) * 512;
  change(new DataView(out.buffer, at, 512));
  return out;
}

const details = async (bytes: Uint8Array) => {
  const opened = await openDocument(bytes, "~/Documents/old.doc");
  if (opened.kind !== "details") throw new Error("not the details view");
  return opened;
};

describe("Word 97-2003 (.doc)", () => {
  it("is no longer text only: the paragraphs, the bold run and the table", async () => {
    const doc = asDocument(await openDocument(fixture("report.doc"), "~/Documents/report.doc"));
    expect(doc).toMatchObject({ format: "doc", textOnly: false });
    expect(texts(doc)).toEqual([
      "Annual report",
      "Sales rose sharply this year.",
      "Region",
      "Total",
      "North",
      "42",
      "연간 보고서의 한글 문단.",
    ]);
    expect(tableTexts(doc)).toEqual([
      [
        ["Region", "Total"],
        ["North", "42"],
      ],
    ]);
    expect(runs(doc).find((r) => r.text === "sharply")).toMatchObject({ bold: true });
  });

  it("a .dot template is not text only either", async () => {
    const doc = asDocument(await openDocument(fixture("report.doc"), "~/Documents/report.dot"));
    expect(doc).toMatchObject({ format: "dot", textOnly: false });
  });

  it("Word 6 and Word 95 files open as the details view", async () => {
    const doc = fixture("doc/format.doc");
    const word95 = patched(doc, (fib) => fib.setUint16(2, 0x68, true));
    const word6 = patched(doc, (fib) => {
      fib.setUint16(0, 0xa5dc, true);
      fib.setUint16(2, 0x65, true);
    });
    for (const old of [word95, word6])
      expect(await details(old)).toMatchObject({
        format: "doc",
        reason: "Word 6 and Word 95 documents are not read in this version.",
      });
  });

  it("an encrypted file and a damaged piece table open as the details view", async () => {
    const doc = fixture("doc/format.doc");
    const encrypted = patched(doc, (fib) =>
      fib.setUint16(0x0a, fib.getUint16(0x0a, true) | 0x0100, true),
    );
    expect((await details(encrypted)).reason).toBe("This document is encrypted.");
    // fcClx is the 34th (fc, lcb) pair after the 154-byte head of the FIB.
    const damaged = patched(doc, (fib) => fib.setUint32(0x9a + 33 * 8, 0x7ffffff0, true));
    expect((await details(damaged)).reason).toBe(
      "This file is damaged: its piece table is missing.",
    );
  });
});
