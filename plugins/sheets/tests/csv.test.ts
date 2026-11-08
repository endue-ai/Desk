import { describe, expect, it } from "vitest";
import { openBook } from "../ui/book.js";
import { decode, delimiterOf, parseCsv } from "../ui/csv.js";
import { fixture } from "./harness";

const utf8 = (text: string) => new TextEncoder().encode(text);
const utf16 = (text: string, littleEndian: boolean) => {
  const bytes = new Uint8Array(2 + text.length * 2);
  bytes.set(littleEndian ? [0xff, 0xfe] : [0xfe, 0xff]);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < text.length; i++) view.setUint16(2 + i * 2, text.charCodeAt(i), littleEndian);
  return bytes;
};
/** "이름,가격\n사과,3\n" in EUC-KR (code page 949). */
const EUC_KR = new Uint8Array([
  0xc0, 0xcc, 0xb8, 0xa7, 0x2c, 0xb0, 0xa1, 0xb0, 0xdd, 0x0a, 0xbb, 0xe7, 0xb0, 0xfa, 0x2c, 0x33,
  0x0a,
]);

describe("the delimiter", () => {
  it.each([
    ["comma", "a,b,c\n1,2,3\n", ","],
    ["semicolon, with decimal commas", "a;b;c\n1,5;2,5;3\n4,5;5;6\n", ";"],
    ["tab", "a\tb, c\tc\n1\t2\t3\n", "\t"],
    ["pipe", "a|b|c\n1|2|3\n", "|"],
    ["comma, with semicolons inside quotes", 'a,"b;c;d",e\n1,"x;y",3\n', ","],
    ["one column", "alpha\nbeta\n", ","],
  ])("%s", (_, text, delimiter) => {
    expect(delimiterOf(text)).toBe(delimiter);
  });
});

describe("the encoding", () => {
  it("UTF-8 with a byte order mark loses the mark", () => {
    expect(decode(new Uint8Array([0xef, 0xbb, 0xbf, ...utf8("é,ü\n")]))).toEqual({
      text: "é,ü\n",
      encoding: "UTF-8",
    });
  });

  it("UTF-8 without a mark", () => {
    expect(decode(utf8("가격,価格\n"))).toEqual({ text: "가격,価格\n", encoding: "UTF-8" });
  });

  it("UTF-16 with a mark, either byte order", () => {
    expect(decode(utf16("가,b\n", true))).toEqual({ text: "가,b\n", encoding: "UTF-16LE" });
    expect(decode(utf16("가,b\n", false))).toEqual({ text: "가,b\n", encoding: "UTF-16BE" });
  });

  it("bytes that are not UTF-8 are EUC-KR", () => {
    expect(decode(EUC_KR)).toEqual({ text: "이름,가격\n사과,3\n", encoding: "EUC-KR" });
  });

  it("the setting overrides the guess", () => {
    // "価格" in Shift_JIS.
    const sjis = new Uint8Array([0x89, 0xbf, 0x8a, 0x69]);
    expect(decode(sjis, "shift_jis")).toEqual({ text: "価格", encoding: "Shift_JIS" });
    expect(decode(new Uint8Array([0x63, 0x61, 0x66, 0xe9]), "windows-1252").text).toBe("café");
    expect(decode(utf8("가"), "utf-8").encoding).toBe("UTF-8");
  });
});

describe("fields", () => {
  it("quoted fields keep delimiters, doubled quotes and new lines", () => {
    const text = 'name,note\r\n"Smith, J.","said ""hi""\nthen left"\r\nlast,\n';
    expect(parseCsv(text, ",")).toEqual([
      ["name", "note"],
      ["Smith, J.", 'said "hi"\nthen left'],
      ["last", ""],
    ]);
  });

  it("a file without a final new line keeps its last row", () => {
    expect(parseCsv("a,b\n1,2", ",")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("a CSV or TSV workbook", () => {
  it("numbers are values, the text stays as written", () => {
    const book = openBook(utf8('item,amount,share\nrent,"1,200.50",12.5%\nfee,$30,-3\n'), {
      name: "money.csv",
    });
    if (book.kind !== "sheets") throw new Error(book.kind);
    const [sheet] = book.sheets;
    expect(sheet?.name).toBe("money");
    expect(sheet?.cell(1, 1)).toMatchObject({ t: "n", v: 1200.5, w: "1,200.50" });
    expect(sheet?.cell(1, 2)).toMatchObject({ t: "n", v: 0.125, w: "12.5%" });
    expect(sheet?.cell(2, 1)).toMatchObject({ t: "n", v: 30, w: "$30" });
    expect(sheet?.cell(2, 2)).toMatchObject({ t: "n", v: -3 });
    expect(sheet?.cell(0, 0)).toMatchObject({ t: "s", v: "item" });
  });

  it("a TSV file and an EUC-KR CSV that Calc wrote", () => {
    const tsv = openBook(utf8("a\tb\n1\t2\n"), { name: "t.tsv" });
    expect(tsv).toMatchObject({ format: "Tab-separated values", detail: "UTF-8, tab" });
    const korean = openBook(fixture("notes-euc-kr.csv"), { name: "notes-euc-kr.csv" });
    expect(korean).toMatchObject({ detail: "EUC-KR, comma" });
    if (korean.kind !== "sheets") throw new Error(korean.kind);
    expect(korean.sheets[0]?.text(1, 1)).toBe("가격");
    expect(korean.sheets[0]?.text(3, 1)).toBe("合計");
  });

  it("the encoding setting reaches the reader", () => {
    const book = openBook(EUC_KR, { name: "k.csv", encoding: "windows-1252" });
    expect(book).toMatchObject({ detail: "Windows-1252, comma" });
  });
});
