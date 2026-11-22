// An export's text as bytes (PG-61, ui/export/bytes.js): UTF-8 with and without a byte order mark,
// UTF-16 LE and BE with one, each read back by TextDecoder to the same text; plain UTF-8 goes to
// fs.write as text, anything else as base64.
import { describe, expect, it } from "vitest";
import { bytesOf, encodeText } from "../ui/export/bytes.js";

const text = "id,name\r\n1,Zoë 😀 漢字\r\n";
const decoded = (content: string) => Uint8Array.from(atob(content), (c) => c.charCodeAt(0));

describe("encodings", () => {
  it("writes plain UTF-8 as text, with its byte count", () => {
    expect(encodeText(text, { encoding: "utf-8", bom: false })).toEqual({
      content: text,
      encoding: "utf8",
      bytes: new TextEncoder().encode(text).length,
    });
  });

  it("writes UTF-8 with a mark and UTF-16 LE and BE as base64 that decodes to the text", () => {
    for (const [encoding, label, mark] of [
      ["utf-8", "utf-8", [0xef, 0xbb, 0xbf]],
      ["utf-16le", "utf-16le", [0xff, 0xfe]],
      ["utf-16be", "utf-16be", [0xfe, 0xff]],
    ] as const) {
      const file = encodeText(text, { encoding, bom: true });
      expect(file.encoding).toBe("base64");
      const bytes = decoded(file.content);
      expect(file.bytes).toBe(bytes.length);
      expect([...bytes.subarray(0, mark.length)]).toEqual(mark);
      // TextDecoder drops the mark it reads, so the text is the same.
      expect(new TextDecoder(label).decode(bytes)).toBe(text);
    }
  });

  it("writes UTF-16 without a mark when asked", () => {
    const bytes = bytesOf("é", "utf-16be", false);
    expect([...bytes]).toEqual([0x00, 0xe9]);
    expect(new TextDecoder("utf-16le").decode(bytesOf(text, "utf-16le", false))).toBe(text);
  });
});
