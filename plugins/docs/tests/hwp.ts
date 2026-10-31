// Builds HWP 5.0 files in code (the compound file, its FileHeader, a DocInfo with paragraph shapes
// and deflated BodyText sections of records), and the HWPX package (OWPML) for the same document.
import { makeCfb, utf16 } from "./cfb";
import { concat, crc32, deflateRaw, makeZip, PNG } from "./zip";

const TAG = { PARA_SHAPE: 25, PARA_HEADER: 66, PARA_TEXT: 67, CTRL_HEADER: 71 } as const;
const LIST_HEADER = 72;
const TABLE = 77;
const PAGE_DEF = 73;

function u32(...values: number[]) {
  const view = new DataView(new ArrayBuffer(values.length * 4));
  for (const [i, v] of values.entries()) view.setUint32(i * 4, v >>> 0, true);
  return new Uint8Array(view.buffer);
}
function u16(...values: number[]) {
  const view = new DataView(new ArrayBuffer(values.length * 2));
  for (const [i, v] of values.entries()) view.setUint16(i * 2, v, true);
  return new Uint8Array(view.buffer);
}

function record(tag: number, level: number, payload: Uint8Array): Uint8Array {
  if (payload.length < 0xfff)
    return concat([u32(tag | (level << 10) | (payload.length << 20)), payload]);
  return concat([u32(tag | (level << 10) | (0xfff << 20)), u32(payload.length), payload]);
}

/** A control id as HWP stores it: four ASCII letters, first letter in the high byte. */
const ctrlId = (id: string) =>
  ((id.charCodeAt(0) << 24) |
    (id.charCodeAt(1) << 16) |
    (id.charCodeAt(2) << 8) |
    id.charCodeAt(3)) >>>
  0;

/** An extended control in paragraph text: 8 code units, the id in the 2nd and 3rd. */
const extended = (code: number, id: string) => {
  const n = ctrlId(id);
  return String.fromCharCode(code, n & 0xffff, n >>> 16, 0, 0, 0, 0, code);
};

export type HwpBlock = { text: string; shape?: number } | { table: string[][] };

function paragraph(text: string, level: number, shape = 0, controls: Uint8Array[] = []) {
  const chars = `${text}\r`;
  const header = concat([
    u32(chars.length, 0),
    u16(shape),
    new Uint8Array([0, 0]),
    u16(1, 0, 1),
    u32(0),
  ]);
  return concat([
    record(TAG.PARA_HEADER, level, header),
    record(TAG.PARA_TEXT, level + 1, utf16(chars)),
    ...controls,
  ]);
}

function table(rows: string[][], level: number): Uint8Array {
  const cols = Math.max(...rows.map((r) => r.length));
  const parts = [
    record(TAG.CTRL_HEADER, level + 1, u32(ctrlId("tbl "), 0)),
    record(TABLE, level + 2, concat([u32(0), u16(rows.length, cols, 0, 0, 0, 0, 0)])),
  ];
  rows.forEach((row, r) => {
    row.forEach((text, c) => {
      const cell = concat([
        u16(1, 0),
        u32(0),
        u16(c, r, 1, 1),
        u32(4000, 1000),
        u16(0, 0, 0, 0, 1),
      ]);
      parts.push(record(LIST_HEADER, level + 2, cell), paragraph(text, level + 2));
    });
  });
  return concat([paragraph(extended(11, "tbl "), level, 0, parts)]);
}

/** Paragraph shapes: 0 is body text, 1 an outline heading at level 1. */
const PARA_SHAPES = [record(TAG.PARA_SHAPE, 1, u32(0)), record(TAG.PARA_SHAPE, 1, u32(1 << 23))];

/** Deflated as Hancom writes it: raw deflate, then a CRC and the size (which strict inflaters reject). */
const hancomDeflate = async (bytes: Uint8Array) =>
  concat([await deflateRaw(bytes), u32(crc32(bytes), bytes.length)]);

export async function makeHwp(
  blocks: HwpBlock[],
  options: { password?: boolean; distribution?: boolean } = {},
) {
  const secd = concat([
    record(TAG.CTRL_HEADER, 1, u32(ctrlId("secd"))),
    record(PAGE_DEF, 2, u32(59528, 84188, 8504, 8504, 5668, 4252, 4252, 4252, 0, 0)),
  ]);
  const body = blocks.map((block, i) => {
    if ("table" in block) return table(block.table, 0);
    const text = i === 0 ? `${extended(2, "secd")}${block.text}` : block.text;
    return paragraph(text, 0, block.shape ?? 0, i === 0 ? [secd] : []);
  });
  const header = new Uint8Array(256);
  header.set(new TextEncoder().encode("HWP Document File"));
  const flags = 1 | (options.password ? 2 : 0) | (options.distribution ? 4 : 0);
  header.set(u32(0x05000300, flags), 32);
  const docInfo = await hancomDeflate(concat([record(16, 0, new Uint8Array(26)), ...PARA_SHAPES]));
  return makeCfb({
    FileHeader: header,
    DocInfo: docInfo,
    "BodyText/Section0": await hancomDeflate(concat(body)),
  });
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
