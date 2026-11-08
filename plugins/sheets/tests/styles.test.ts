// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { openBook, type Sheet } from "../ui/book.js";
import { parseStyles, scanSheet } from "../ui/styles.js";
import { fixture } from "./harness";

const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';

/** The styles part as Excel writes it: theme and indexed colours, a tint, several fonts. */
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet ${NS}>
  <fonts count="3">
    <font><sz val="11"/><color theme="1"/><name val="Calibri"/></font>
    <font><b/><i/><strike/><sz val="11"/><color rgb="FF0070C0"/></font>
    <font><u val="double"/><color indexed="10"/></font>
  </fonts>
  <fills count="4">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor theme="4" tint="0.79998168889431442"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor indexed="13"/></patternFill></fill>
  </fills>
  <cellXfs count="4">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="0" applyFont="1" applyFill="1"/>
    <xf numFmtId="0" fontId="2" fillId="3" borderId="0" applyAlignment="1"><alignment horizontal="centerContinuous" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" applyAlignment="1"><alignment horizontal="right"/></xf>
  </cellXfs>
</styleSheet>`;

const THEME = `<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office Theme">
  <a:themeElements><a:clrScheme name="Office">
    <a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>
    <a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
    <a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2>
    <a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2>
  </a:clrScheme></a:themeElements></a:theme>`;

describe("the reader of xl/styles.xml", () => {
  it("turns each cell format into the style the grid draws", () => {
    const styles = parseStyles(STYLES, THEME);
    expect(styles).toHaveLength(4);
    // The default font in the theme's text colour is the grid's own text colour: no style at all.
    expect(styles[0]).toBeUndefined();
    expect(styles[1]).toEqual({
      bold: true,
      italic: true,
      strike: true,
      color: "#0070C0",
      fill: "#DAE3F3",
    });
    expect(styles[2]).toEqual({
      underline: true,
      color: "#FF0000",
      fill: "#FFFF00",
      align: "center",
      wrap: true,
    });
    expect(styles[3]).toEqual({ align: "right" });
  });

  it("finds each cell's format and the frozen panes in a sheet part", () => {
    const sheet = scanSheet(`<worksheet ${NS}><sheetViews><sheetView workbookViewId="0">
      <pane xSplit="2" ySplit="1" topLeftCell="C2" activePane="bottomRight" state="frozen"/>
      </sheetView></sheetViews><cols><col min="1" max="2" width="12" customWidth="1"/></cols>
      <sheetData><row r="1"><c r="A1" s="1" t="s"><v>0</v></c><c r="B1"><v>2</v></c></row>
      <row r="3"><c r="C3" s="3"/></row></sheetData></worksheet>`);
    expect(sheet.frozen).toEqual({ rows: 1, cols: 2 });
    expect(sheet.format(0, 0)).toBe(1);
    expect(sheet.format(0, 1)).toBeUndefined();
    expect(sheet.format(2, 2)).toBe(3);
    expect(sheet.format(5, 5)).toBeUndefined();
  });
});

describe("styles in an .xlsx that LibreOffice wrote", () => {
  const book = openBook(fixture("budget.xlsx"), { name: "budget.xlsx" });
  const budget = (book.kind === "sheets" ? book.sheets[0] : undefined) as Sheet;

  it("bold, fill and font colour and alignment reach the cells they belong to", () => {
    expect(budget.style(0, 0)).toMatchObject({
      bold: true,
      color: "#1F3864",
      fill: "#FFFF00",
      align: "center",
    });
    expect(budget.style(1, 1)).toMatchObject({ bold: true, fill: "#D9E1F2", align: "center" });
    expect(budget.style(5, 0)).toMatchObject({ bold: true, italic: true });
    expect(budget.style(5, 1)).toMatchObject({ bold: true, color: "#C00000" });
    expect(budget.style(7, 0)).toMatchObject({ underline: true, wrap: true, align: "right" });
    expect(budget.style(2, 1)?.bold).toBeUndefined();
    expect(budget.style(2, 0)).toBeUndefined();
  });

  it("other formats show values without styles", () => {
    const ods = openBook(fixture("budget.ods"), { name: "budget.ods" });
    const [sheet] = ods.kind === "sheets" ? ods.sheets : [];
    expect(sheet?.text(0, 0)).toBe("Quarterly budget");
    expect(sheet?.style(0, 0)).toBeUndefined();
  });
});
