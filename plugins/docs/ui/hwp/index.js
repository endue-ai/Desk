// Hangul HWP 5.0 (.hwp): the compound file's FileHeader (version, compression, password,
// distribution), DocInfo's ID mappings, the pictures in BinData, and each BodyText section's
// paragraphs with their shapes, tables, pictures, headers, footers and notes.
// 본 제품은 한글과컴퓨터의 글 문서 파일(.hwp) 공개 문서를 참고하여 개발하였습니다.
// (This reader was developed with reference to Hancom's published HWP document file format.)
import { inflate, pictureKind, pictureType, pictureUrl, Reader, startsWithText } from "../bytes.js";
import { formatName } from "../formats.js";
import { DocError, documentOf, ENCRYPTED, paragraph, pt, section, text } from "../model.js";
import { readDocInfo } from "./docinfo.js";
import { counters } from "./numbering.js";
import { paragraphBlocks } from "./paragraph.js";
import { TAG, tree } from "./records.js";

/**
 * @typedef {import("./paragraph.js").Ctx} Ctx
 * @typedef {import("../model.js").Block} Block
 */

const DISTRIBUTION = "This Hangul document is a distribution copy, whose text is encrypted.";
const DRM = "This Hangul document is protected by DRM, which Docs cannot open.";

/**
 * @param {import("../cfb.js").Cfb} cfb
 * @returns {Promise<import("../model.js").Opened>}
 */
export async function readHwp(cfb) {
  const header = cfb.read("FileHeader");
  if (!header || !startsWithText(header, "HWP Document File"))
    throw new DocError("This file is damaged: its HWP file header is missing.");
  const hr = new Reader(header);
  if (hr.u8(35) !== 5)
    throw new DocError(`HWP ${hr.u8(35)}.x documents are not read in this version.`);
  const props = hr.u32(36);
  if (props & 2) return refuse(cfb, ENCRYPTED);
  if (props & 4) return refuse(cfb, DISTRIBUTION);
  if (props & ((1 << 4) | (1 << 8) | (1 << 10))) return refuse(cfb, DRM);
  const compressed = (props & 1) !== 0;
  const docInfo = cfb.read("DocInfo");
  const info = readDocInfo(docInfo ? await unpack(docInfo, compressed) : new Uint8Array(0));
  const paths = cfb
    .list()
    .filter((p) => /^BodyText\/Section\d+$/i.test(p))
    .sort((a, b) => Number(/\d+$/.exec(a)?.[0]) - Number(/\d+$/.exec(b)?.[0]));
  if (paths.length === 0) throw new DocError("This file is damaged: it has no BodyText sections.");
  /** @type {Ctx} */
  const ctx = {
    info,
    number: counters(info.numberings),
    pictures: await pictures(cfb, info, compressed),
    notes: [],
    headers: { header: [], footer: [] },
    page: undefined,
    pageNumber: undefined,
    outline: 0,
    columns: 1,
    link: undefined,
    inNote: false,
    vpos: -1,
  };
  /** @type {import("../model.js").Section[]} */
  const sections = [];
  for (const path of paths) {
    const bytes = cfb.read(path);
    if (!bytes) continue;
    const root = tree(await unpack(bytes, compressed));
    ctx.vpos = -1;
    ctx.link = undefined;
    /** @type {Block[]} */
    const blocks = [];
    for (const para of root.kids)
      if (para.tag === TAG.PARA_HEADER) blocks.push(...paragraphBlocks(para, ctx, true));
    if (blocks[0]?.type === "pagebreak") blocks.shift();
    sections.push(sectionOf(ctx, blocks));
  }
  return documentOf({
    format: "hwp",
    formatName: formatName("hwp"),
    textOnly: false,
    sections,
    notes: ctx.notes,
  });
}

/** Hancom ends a deflated stream with a gzip-style trailer a strict inflater calls junk. */
async function unpack(/** @type {Uint8Array} */ bytes, /** @type {boolean} */ compressed) {
  if (!compressed) return bytes;
  return inflate(bytes)
    .catch(() => inflate(bytes.subarray(0, Math.max(0, bytes.length - 8))))
    .catch(() => {
      throw new DocError("This file is damaged: a section does not decompress.");
    });
}

/** The details view for a file whose body cannot be read, with the first-page preview it keeps. */
function refuse(/** @type {import("../cfb.js").Cfb} */ cfb, /** @type {string} */ reason) {
  const image = cfb.read("PrvImage");
  const src = image ? pictureUrl(image) : null;
  return {
    kind: /** @type {const} */ ("details"),
    format: "hwp",
    formatName: formatName("hwp"),
    reason,
    ...(src ? { preview: { src, alt: "Preview of the first page" } } : {}),
  };
}

/**
 * Every embedded picture as a data: URL (or null, with its kind for the label), by BinData id.
 * @param {import("../cfb.js").Cfb} cfb
 * @param {import("./docinfo.js").Info} info
 * @param {boolean} compressed
 */
async function pictures(cfb, info, compressed) {
  /** @type {Ctx["pictures"]} */
  const out = new Map();
  for (const [index, bin] of info.bins.entries()) {
    if (bin.kind !== 1) {
      out.set(index + 1, { src: null, kind: bin.kind === 0 ? "linked" : "OLE" });
      continue;
    }
    const name = `BIN${bin.id.toString(16).toUpperCase().padStart(4, "0")}.${bin.ext}`;
    const raw = cfb.read(`BinData/${name}`);
    if (!raw) {
      out.set(index + 1, { src: null, kind: "missing" });
      continue;
    }
    let bytes = raw;
    // Stored as the document says, unless the bytes already are a picture.
    if (!pictureType(raw) && bin.compress !== 2 && (compressed || bin.compress === 1))
      bytes = await inflate(raw).catch(() => raw);
    out.set(index + 1, { src: pictureUrl(bytes), kind: pictureKind(bytes, name) });
  }
  return out;
}

/** The page a section's PAGE_DEF gives; Hangul puts the header area below the top margin. */
function sectionOf(/** @type {Ctx} */ ctx, /** @type {Block[]} */ blocks) {
  const { header, footer } = withPageNumber(ctx);
  if (!ctx.page) return section({ blocks, header, footer });
  const r = new Reader(ctx.page);
  const v = (/** @type {number} */ i) => pt(r.u32(i * 4) / 100);
  let [width, height] = [v(0), v(1)];
  // Bit 0 turns the paper: Hangul keeps its portrait size and the orientation beside it.
  if (r.u32(36) & 1 && width < height) [width, height] = [height, width];
  return section({
    width,
    height,
    margins: {
      left: v(2),
      right: v(3),
      top: pt(v(4) + v(6)),
      bottom: pt(v(5) + v(7)),
      header: v(4),
      footer: v(5),
    },
    header,
    footer,
    blocks,
  });
}

/** A page number position adds the number to the header or footer, aligned where Hangul puts it. */
function withPageNumber(/** @type {Ctx} */ ctx) {
  const { header, footer } = ctx.headers;
  const at = ctx.pageNumber;
  if (!at) return { header, footer };
  const number = paragraph(
    [
      ...(at.prefix ? [text(`${at.prefix} `)] : []),
      { type: "field", field: "page", text: "" },
      ...(at.suffix ? [text(` ${at.suffix}`)] : []),
    ],
    { align: at.align },
  );
  return at.top ? { header: [...header, number], footer } : { header, footer: [...footer, number] };
}
