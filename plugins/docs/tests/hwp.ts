// Builds HWP 5.0 files in code: a compound file with a FileHeader, a DocInfo (fonts, character and
// paragraph shapes, border fills, numberings, a bullet, styles, BinData items) and BodyText sections
// of records: paragraphs with runs, tables, pictures, headers, footnotes, hyperlink fields and line
// segments. Hancom's deflate is raw deflate plus a CRC and size. Also the HWPX package (OWPML).
import { makeCfb, utf16 } from "./cfb";
import { concat, crc32, deflateRaw, makeZip, PNG } from "./zip";

// Record tags: HWPTAG_BEGIN (16) plus their number in Hancom's tables.
const [ID_MAPPINGS, BIN_DATA, FACE_NAME, BORDER_FILL, CHAR_SHAPE] = [17, 18, 19, 20, 21];
const [NUMBERING, BULLET, PARA_SHAPE, STYLE, PARA_HEADER, PARA_TEXT] = [23, 24, 25, 26, 66, 67];
const [PARA_CHAR_SHAPE, PARA_LINE_SEG, CTRL_HEADER, LIST_HEADER, PAGE_DEF] = [68, 69, 71, 72, 73];
const [SHAPE_COMPONENT, TABLE, SHAPE_PICTURE] = [76, 77, 85];

const u8 = (...values: number[]) => Uint8Array.from(values);
function u16(...values: number[]) {
  const view = new DataView(new ArrayBuffer(values.length * 2));
  for (const [i, v] of values.entries()) view.setUint16(i * 2, v & 0xffff, true);
  return new Uint8Array(view.buffer);
}
function u32(...values: number[]) {
  const view = new DataView(new ArrayBuffer(values.length * 4));
  for (const [i, v] of values.entries()) view.setUint32(i * 4, v >>> 0, true);
  return new Uint8Array(view.buffer);
}
const wstr = (text: string) => concat([u16(text.length), utf16(text)]);
const fill7 = (value: number) => Array<number>(7).fill(value);
/** "#RRGGBB" as a COLORREF (0x00BBGGRR). */
const colorref = (hex: string) => {
  const n = Number.parseInt(hex.slice(1), 16);
  return ((n & 0xff) << 16) | (n & 0xff00) | ((n >> 16) & 0xff);
};

/** A record: the header (tag, level, size; 0xFFF and a DWORD for big ones), then the payload. */
function record(tag: number, level: number, ...parts: Uint8Array[]): Uint8Array {
  const payload = concat(parts);
  if (payload.length < 0xfff)
    return concat([u32(tag | (level << 10) | (payload.length << 20)), payload]);
  return concat([u32(tag | (level << 10) | (0xfff << 20)), u32(payload.length), payload]);
}

/** A control id as HWP stores it: four ASCII letters, first letter in the high byte. */
const ctrlId = (id: string) => [...id].reduce((n, c) => (n << 8) | c.charCodeAt(0), 0) >>> 0;
/** An eight-unit control character: the code, the id in the next two units, the code again. */
const control = (code: number, id = "") => {
  const n = id ? ctrlId(id) : 0;
  return [code, n & 0xffff, n >>> 16, 0, 0, 0, 0, code];
};

export type Run = { text: string; char?: number; link?: string };
export type Cell = { text: string; col: number; row: number; width: number } & {
  span?: number;
  rows?: number;
  fill?: number;
};
export type Part =
  | string
  | Run
  | { table: Cell[]; fill?: number }
  | { picture: number; width: number; height: number; inline?: boolean; alt?: string }
  | { footnote: string }
  | { header: string }
  | { tab: true };
export type Para = { parts: Part[]; para?: number; pageBreak?: boolean; lines?: number[] };
export type Section = { paras: Para[]; landscape?: boolean };

/** The shapes the fixtures use: body text, an outline heading, centred, numbered and bulleted. */
export const DEFAULTS = {
  fonts: ["함초롬바탕", "맑은 고딕"],
  chars: [
    { size: 10 },
    { size: 10, bold: true },
    { size: 16, bold: true, color: "#1F3864", font: 1 },
    { size: 10, color: "#C00000" },
  ] as Array<{ size: number; bold?: boolean; color?: string; font?: number }>,
  paras: [
    {},
    { align: 1, head: 1, numbering: 1 },
    { align: 3 },
    { align: 1, left: 20, indent: -10, head: 2, numbering: 2 },
    { head: 3, numbering: 1 },
    { align: 2, left: 30 },
  ] as Array<{ align?: number; left?: number; indent?: number; head?: number; numbering?: number }>,
  fills: [{ border: false }, { border: true }, { border: true, fill: "#FFF2CC" }] as Array<{
    border: boolean;
    fill?: string;
  }>,
  numberings: [
    ["^1.", "^2."],
    ["^1)", "(^2)"],
  ],
  bullets: ["●"],
  styles: [
    { name: "바탕글", para: 0, char: 0 },
    { name: "개요 1", para: 1, char: 2 },
  ],
};
export type Doc = Partial<typeof DEFAULTS> & {
  sections: Section[];
  bins?: Uint8Array[];
  password?: boolean;
  distribution?: boolean;
  preview?: Uint8Array;
};

function docInfo(doc: Doc): Uint8Array {
  const o = { ...DEFAULTS, ...doc };
  const bins = doc.bins ?? [];
  // A numbering's level: a 12-byte head (bits 5-8 the number shape: 8 is 가나다), its format.
  const head = (shape: number) => concat([u32(shape << 5), u16(0, 50), u32(0xffffffff)]);
  const levels = (texts: string[]) =>
    [...Array(7).keys()].map((i) => concat([head(i % 2 ? 8 : 0), wstr(texts[i] ?? "")]));
  const numbering = (texts: string[]) =>
    concat([...levels(texts), u16(1), u32(...fill7(1)), head(0), u16(0), head(0), u16(0)]);
  const counts = [o.fills, o.chars, [], o.numberings, o.bullets, o.paras, o.styles].map(
    (l) => l.length,
  );
  return concat([
    record(ID_MAPPINGS, 0, u32(bins.length, ...fill7(o.fonts.length), ...counts, 0, 0, 0)),
    ...bins.map((_, i) => record(BIN_DATA, 1, u16(0x21, i + 1), wstr("png"))),
    ...fill7(0).flatMap(() => o.fonts.map((f) => record(FACE_NAME, 1, u8(0), wstr(f)))),
    ...o.fills.map((f) => {
      const sides = fill7(0)
        .slice(0, 4)
        .map(() => concat([u8(f.border ? 1 : 0, 1), u32(0)]));
      const brush = f.fill ? u32(1, colorref(f.fill), 0, 0xffffffff) : u32(0);
      return record(BORDER_FILL, 1, u16(0), ...sides, u8(0, 0), u32(0), brush, u8(0), u32(0));
    }),
    ...o.chars.map((c) => {
      const scales = u8(...fill7(100), ...fill7(0), ...fill7(100), ...fill7(0));
      const colors = u32(colorref(c.color ?? "#000000"), 0, 0xffffffff, 0xb2b2b2);
      const props = u32(c.size * 100, c.bold ? 2 : 0);
      return record(
        CHAR_SHAPE,
        1,
        u16(...fill7(c.font ?? 0)),
        scales,
        props,
        u8(10, 10),
        colors,
        u16(0),
        u32(0),
      );
    }),
    ...o.numberings.map((n) => record(NUMBERING, 1, numbering(n))),
    ...o.bullets.map((b) =>
      record(BULLET, 1, head(0), u16(b.charCodeAt(0)), u32(0), u8(0, 0, 0, 0, 0), u16(0)),
    ),
    ...o.paras.map((p) => {
      const props = ((p.align ?? 0) << 2) | ((p.head ?? 0) << 23);
      const margins = u32((p.left ?? 0) * 200, 0, (p.indent ?? 0) * 200, 0, 0, 160);
      return record(
        PARA_SHAPE,
        1,
        u32(props),
        margins,
        u16(0, p.numbering ?? 0, 1, 0, 0, 0, 0),
        u32(0, 0, 160, 0),
      );
    }),
    ...o.styles.map((s) =>
      record(STYLE, 1, wstr(s.name), wstr(""), u8(0, 0), u16(0x412, s.para, s.char, 0)),
    ),
  ]);
}

/** The properties every object control starts with: treat-as-character, size, description. */
const common = (id: string, inline: boolean, width: number, height: number, alt = "") =>
  concat([
    u32(ctrlId(id), inline ? 1 : 0x040a6000, 0, 0, width * 100, height * 100, 0),
    u16(0, 0, 0, 0),
    u32(1, 0),
    wstr(alt),
  ]);

/** The records of a part's control, at the level of the paragraph's own records. */
function controlRecords(part: Exclude<Part, string | Run | { tab: true }>, level: number) {
  if ("table" in part) {
    const rows = Math.max(...part.table.map((c) => c.row + (c.rows ?? 1)));
    const cols = Math.max(...part.table.map((c) => c.col + (c.span ?? 1)));
    const perRow = [...Array(rows).keys()].map((r) => part.table.filter((c) => c.row === r).length);
    const width = part.table.filter((c) => c.row === 0).reduce((sum, c) => sum + c.width, 0);
    return [
      record(CTRL_HEADER, level, common("tbl ", false, width, 20 * rows)),
      record(
        TABLE,
        level + 1,
        u32(0),
        u16(rows, cols, 0, 510, 510, 141, 141, ...perRow, part.fill ?? 1, 0),
      ),
      ...part.table.flatMap((c) => [
        record(
          LIST_HEADER,
          level + 1,
          u16(1, 0),
          u32(0x20),
          u16(c.col, c.row, c.span ?? 1, c.rows ?? 1),
          u32(c.width * 100, 2000),
          u16(510, 510, 141, 141, c.fill ?? 2),
        ),
        paragraph({ parts: [c.text] }, level + 1),
      ]),
    ];
  }
  if ("picture" in part) {
    const pic = concat([
      u32(0, 0, 0),
      new Uint8Array(56),
      u8(0, 0, 0),
      u16(part.picture),
      u8(0),
      u32(0),
    ]);
    const size = u32(...fill7(part.width * 100).slice(0, 4));
    return [
      record(
        CTRL_HEADER,
        level,
        common("gso ", part.inline ?? true, part.width, part.height, part.alt),
      ),
      record(
        SHAPE_COMPONENT,
        level + 1,
        u32(ctrlId("$pic"), ctrlId("$pic"), 0, 0),
        u16(0, 1),
        size,
        new Uint8Array(14),
      ),
      record(SHAPE_PICTURE, level + 2, pic),
    ];
  }
  // A footnote (number 1, ")" after it) or a header on both pages, each with its paragraph list.
  const [id, data, text] =
    "footnote" in part
      ? ["fn  ", concat([u16(0, 0x29), u32(0, 0)]), part.footnote]
      : ["head", u32(0, 42520, 4252), part.header];
  return [
    record(CTRL_HEADER, level, u32(ctrlId(id), "footnote" in part ? 1 : 0), data),
    record(LIST_HEADER, level + 1, u16(1, 0), u32(0)),
    paragraph({ parts: [text] }, level + 1),
  ];
}

/** One paragraph at `level`: its header, text, runs, line segments, then its controls' records. */
function paragraph(p: Para, level: number, first: Uint8Array[] = []): Uint8Array {
  const units = first.length ? [...control(2, "secd"), ...control(2, "cold")] : [];
  const runs: number[] = [0, 0];
  const records = [...first];
  const char = (n: number) => runs.at(-1) !== n && runs.push(units.length, n);
  for (const part of p.parts) {
    if (typeof part === "string" || "text" in part) {
      const run = typeof part === "string" ? { text: part } : part;
      if (run.link) {
        units.push(...control(3, "%hlk"));
        const command = wstr(`${run.link.replace(":", "\\:")};1;0;0;`);
        records.push(
          record(CTRL_HEADER, level + 1, u32(ctrlId("%hlk"), 0), u8(0), command, u32(1)),
        );
      }
      char(run.char ?? 0);
      units.push(...[...run.text].map((c) => c.charCodeAt(0)));
      char(0);
      if (run.link) units.push(...control(4));
    } else if ("tab" in part) units.push(...control(9));
    else {
      const code = "table" in part || "picture" in part ? 11 : "footnote" in part ? 17 : 16;
      const id =
        "table" in part
          ? "tbl "
          : "picture" in part
            ? "gso "
            : "footnote" in part
              ? "fn  "
              : "head";
      units.push(...control(code, id));
      records.push(...controlRecords(part, level + 1));
    }
  }
  units.push(13);
  const lines = p.lines ?? [];
  const header = concat([
    u32(units.length, 0),
    u16(p.para ?? 0),
    u8(0, p.pageBreak ? 4 : 0),
    u16(runs.length / 2, 0, lines.length || 1),
    u32(0),
  ]);
  const segs = lines.map((vpos) => u32(0, vpos, 1000, 1000, 850, 600, 0, 42520, 0x60000));
  return concat([
    record(PARA_HEADER, level, header),
    record(PARA_TEXT, level + 1, u16(...units)),
    record(PARA_CHAR_SHAPE, level + 1, u32(...runs)),
    ...(segs.length ? [record(PARA_LINE_SEG, level + 1, ...segs)] : []),
    ...records,
  ]);
}

/** A section: its first paragraph defines the page (A4, portrait or turned) and one column. */
function section(s: Section): Uint8Array {
  const secd = [
    record(
      CTRL_HEADER,
      1,
      u32(ctrlId("secd"), 0),
      u16(1134, 0, 0),
      u32(8000),
      u16(1, 0, 0, 0, 0, 0),
    ),
    record(
      PAGE_DEF,
      2,
      u32(59528, 84188, 8504, 8504, 5668, 4252, 4252, 4252, 0, s.landscape ? 1 : 0),
    ),
    record(CTRL_HEADER, 1, u32(ctrlId("cold")), u16(0x1004, 0), new Uint8Array(6)),
  ];
  const [first = { parts: [] }, ...rest] = s.paras;
  return concat([paragraph(first, 0, secd), ...rest.map((p) => paragraph(p, 0))]);
}

/** Deflated as Hancom writes it: raw deflate, then a CRC and the size (which strict inflaters reject). */
const hancomDeflate = async (bytes: Uint8Array) =>
  concat([await deflateRaw(bytes), u32(crc32(bytes), bytes.length)]);

export async function buildHwp(doc: Doc): Promise<Uint8Array> {
  const header = new Uint8Array(256);
  header.set(new TextEncoder().encode("HWP Document File"));
  header.set(u32(0x05010000, 1 | (doc.password ? 2 : 0) | (doc.distribution ? 4 : 0)), 32);
  const streams: Record<string, Uint8Array> = {
    FileHeader: header,
    DocInfo: await hancomDeflate(docInfo(doc)),
  };
  const body = doc.distribution ? "ViewText" : "BodyText";
  for (const [i, s] of doc.sections.entries())
    streams[`${body}/Section${i}`] = await hancomDeflate(section(s));
  for (const [i, bin] of (doc.bins ?? []).entries())
    streams[`BinData/BIN${(i + 1).toString(16).toUpperCase().padStart(4, "0")}.png`] = bin;
  if (doc.preview) streams.PrvImage = doc.preview;
  return makeCfb(streams);
}

export type HwpBlock = { text: string; shape?: number } | { table: string[][] };

/** The small document most tests use: paragraphs (shape 1 an outline heading) and plain tables. */
export function makeHwp(
  blocks: HwpBlock[],
  options: { password?: boolean; distribution?: boolean; preview?: Uint8Array } = {},
) {
  const paras = blocks.map((block): Para => {
    if ("text" in block) return { parts: [block.text], para: block.shape ?? 0 };
    const cells = block.table.flatMap((row, r) =>
      row.map((text, col) => ({ text, col, row: r, width: 40 })),
    );
    return { parts: [{ table: cells }] };
  });
  return buildHwp({ sections: [{ paras }], ...options });
}

const HWPX_NS =
  'xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph" xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core"';

/** The same small document as HWPX: a heading, a bold run, a 2 by 2 table and an image. */
export function makeHwpx(): Promise<Uint8Array> {
  const header = `<?xml version="1.0" encoding="UTF-8"?><hh:head ${HWPX_NS} version="1.4" secCnt="1">
<hh:refList><hh:fontfaces itemCnt="1"><hh:fontface lang="HANGUL" fontCnt="1"><hh:font id="0" face="함초롬바탕" type="TTF"/></hh:fontface><hh:fontface lang="LATIN" fontCnt="1"><hh:font id="0" face="Times New Roman" type="TTF"/></hh:fontface></hh:fontfaces>
<hh:charProperties itemCnt="3">
<hh:charPr id="0" height="1000" textColor="#000000" shadeColor="none"><hh:fontRef hangul="0" latin="0"/><hh:underline type="NONE" shape="SOLID" color="#000000"/><hh:strikeout shape="NONE" color="#000000"/></hh:charPr>
<hh:charPr id="1" height="1000" textColor="#000000" shadeColor="none"><hh:fontRef hangul="0" latin="0"/><hh:bold/></hh:charPr>
<hh:charPr id="2" height="1600" textColor="#1F3864" shadeColor="none"><hh:fontRef hangul="0" latin="0"/></hh:charPr>
</hh:charProperties>
<hh:paraProperties itemCnt="2">
<hh:paraPr id="0"><hh:align horizontal="JUSTIFY" vertical="BASELINE"/><hh:heading type="NONE" idRef="0" level="0"/></hh:paraPr>
<hh:paraPr id="1"><hh:align horizontal="LEFT" vertical="BASELINE"/><hh:heading type="OUTLINE" idRef="1" level="0"/></hh:paraPr>
</hh:paraProperties>
<hh:styles itemCnt="2"><hh:style id="0" type="PARA" name="바탕글" engName="Normal" paraPrIDRef="0" charPrIDRef="0"/><hh:style id="1" type="PARA" name="개요 1" engName="Outline 1" paraPrIDRef="1" charPrIDRef="2"/></hh:styles>
</hh:refList></hh:head>`;
  const cell = (text: string, col: number, row: number) =>
    `<hp:tc><hp:subList><hp:p paraPrIDRef="0" styleIDRef="0"><hp:run charPrIDRef="0"><hp:t>${text}</hp:t></hp:run></hp:p></hp:subList><hp:cellAddr colAddr="${col}" rowAddr="${row}"/><hp:cellSpan colSpan="1" rowSpan="1"/><hp:cellSz width="20000" height="1000"/></hp:tc>`;
  const section = `<?xml version="1.0" encoding="UTF-8"?><hs:sec ${HWPX_NS}>
<hp:p paraPrIDRef="1" styleIDRef="1"><hp:run charPrIDRef="2"><hp:secPr><hp:pagePr landscape="WIDELY" width="59528" height="84188"><hp:margin header="4252" footer="4252" left="8504" right="8504" top="5668" bottom="4252"/></hp:pagePr></hp:secPr><hp:t>Annual report</hp:t></hp:run></hp:p>
<hp:p paraPrIDRef="0" styleIDRef="0"><hp:run charPrIDRef="0"><hp:t>Sales rose </hp:t></hp:run><hp:run charPrIDRef="1"><hp:t>sharply</hp:t></hp:run><hp:run charPrIDRef="0"><hp:t> this year.</hp:t></hp:run></hp:p>
<hp:p paraPrIDRef="0" styleIDRef="0"><hp:run charPrIDRef="0"><hp:tbl rowCnt="2" colCnt="2"><hp:tr>${cell("Region", 0, 0)}${cell("Total", 1, 0)}</hp:tr><hp:tr>${cell("North", 0, 1)}${cell("42", 1, 1)}</hp:tr></hp:tbl></hp:run></hp:p>
<hp:p paraPrIDRef="0" styleIDRef="0"><hp:run charPrIDRef="0"><hp:pic id="1"><hp:imgRect/><hc:img binaryItemIDRef="image1" bright="0" contrast="0" effect="REAL_PIC" alpha="0"/><hp:sz width="1440" height="1440"/></hp:pic></hp:run></hp:p>
</hs:sec>`;
  const hpf = `<?xml version="1.0" encoding="UTF-8"?><opf:package xmlns:opf="http://www.idpf.org/2007/opf/" version="" unique-identifier="" id=""><opf:metadata><opf:title>Annual report</opf:title></opf:metadata><opf:manifest><opf:item id="header" href="Contents/header.xml" media-type="application/xml"/><opf:item id="image1" href="BinData/image1.png" media-type="image/png" isEmbeded="1"/><opf:item id="section0" href="Contents/section0.xml" media-type="application/xml"/></opf:manifest><opf:spine><opf:itemref idref="header" linear="yes"/><opf:itemref idref="section0" linear="yes"/></opf:spine></opf:package>`;
  return makeZip({
    mimetype: "application/hwp+zip",
    "version.xml":
      '<?xml version="1.0"?><hv:HCFVersion xmlns:hv="http://www.hancom.co.kr/hwpml/2011/version" major="5" minor="1"/>',
    "META-INF/container.xml":
      '<?xml version="1.0"?><ocf:container xmlns:ocf="urn:oasis:names:tc:opendocument:xmlns:container"><ocf:rootfiles><ocf:rootfile full-path="Contents/content.hpf" media-type="application/hwpml-package+xml"/></ocf:rootfiles></ocf:container>',
    "Contents/content.hpf": hpf,
    "Contents/header.xml": header,
    "Contents/section0.xml": section,
    "BinData/image1.png": PNG,
  });
}
