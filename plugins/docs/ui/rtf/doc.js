// The RTF document being read: its font, colour and style tables, page setup per section, the
// body flow, notes, annotations and the text runs written with the properties in force.
import { fromHex, pictureUrl } from "../bytes.js";
import { color, documentOf, LETTER, section, twips } from "../model.js";
import { safeLink } from "../ooxml/inline.js";
import { Flow } from "./flow.js";

/**
 * @typedef {import("./index.js").State} State
 * @typedef {import("./index.js").Pict} Pict
 * @typedef {import("./flow.js").RtfPara} RtfPara
 * @typedef {{ width: number, height: number, top: number, bottom: number, left: number, right: number, header: number, footer: number }} Page
 */

export function createDoc() {
  const body = new Flow();
  /** @type {Map<number, { name: string, cp?: number }>} */
  const fonts = new Map();
  /** @type {Array<string | undefined>} */
  const colors = [];
  let parts = { red: 0, green: 0, blue: 0, any: false };
  /** @type {Map<number, { name: string, level?: number }>} */
  const styles = new Map();
  let styleId = 0;
  /** @type {number | undefined} */
  let styleLevel;
  /** @type {import("../model.js").Section[]} */
  const sections = [];
  /** @type {Page} */
  const page = {
    width: LETTER.width * 20,
    height: LETTER.height * 20,
    top: 1440,
    bottom: 1440,
    left: 1800,
    right: 1800,
    header: 720,
    footer: 720,
  };
  let current = { ...page };
  /** @type {Record<"header" | "footer", import("../model.js").Block[]>} */
  let headers = { header: [], footer: [] };
  /** @type {import("../model.js").Note[]} */
  const notes = [];
  /** @type {import("../model.js").Comment[]} */
  const comments = [];
  /** @type {Set<string>} */
  const ranges = new Set();
  let title = "";

  const closeSection = (/** @type {RtfPara} */ props) => {
    const blocks = body.finish(props);
    body.blocks = [];
    sections.push(
      section({
        width: twips(current.width),
        height: twips(current.height),
        margins: {
          top: twips(current.top),
          right: twips(current.right),
          bottom: twips(current.bottom),
          left: twips(current.left),
          header: twips(current.header),
          footer: twips(current.footer),
        },
        header: headers.header,
        footer: headers.footer,
        blocks,
      }),
    );
  };

  return {
    body,
    fonts,
    styles,
    codepage: 1252,
    /** @type {number | undefined} \deffN: the font of text that names none. */
    defaultFont: undefined,
    /** The row definition (\trowd ... \cellxN) in force, and the cell being defined. */
    /** @type {import("./flow.js").CellDef[]} */
    rowDefs: [],
    /** @type {import("./flow.js").CellDef} */
    cellDef: { right: 0 },
    /** The \\sn of the shape property being read (\\sp{\\sn pib}{\\sv {\\pict ...}}). */
    shapeProperty: "",
    /** A colour table entry. */
    color: (/** @type {number} */ i) => colors[i],
    /** Font table text: the name ends at ";". */
    fontText(/** @type {State} */ state, /** @type {string} */ text) {
      const font = state.font;
      if (!font) return;
      const end = text.indexOf(";");
      font.name.push(end < 0 ? text : text.slice(0, end));
      if (end < 0) return;
      const name = font.name.join("").trim();
      if (name) fonts.set(font.id, { name, cp: font.cp });
      state.font = undefined;
    },
    /** The document's page setup (\paperw, \margl...), copied into each new section. */
    page,
    /** The page setup of the section being written (\pgwsxn, \marglsxn...). */
    current: () => current,
    notes,
    comments,
    ranges,
    annotation: { author: "", date: "", ref: "" },
    setTitle: (/** @type {string} */ t) => {
      title = t.trim();
    },
    /** @param {"header" | "footer"} which @param {import("../model.js").Block[]} blocks */
    setPart: (which, blocks) => {
      headers = { ...headers, [which]: blocks };
    },
    /** \sect: the section ends and the next starts with the document's page setup. */
    newSection(/** @type {RtfPara} */ props) {
      closeSection(props);
      current = { ...page };
    },
    resetSection() {
      current = { ...page };
    },
    /** @param {State} state @param {string} text */
    text(state, text) {
      const { run } = state;
      /** @type {import("../model.js").TextRun} */
      const item = { type: "text", text: "" };
      if (run.bold) item.bold = true;
      if (run.italic) item.italic = true;
      if (run.underline) item.underline = true;
      if (run.strike) item.strike = true;
      if (run.size) item.size = run.size;
      const fg = run.color ? colors[run.color] : undefined;
      if (fg) item.color = fg;
      const bg = run.highlight ? colors[run.highlight] : undefined;
      if (bg) item.highlight = bg;
      const id = run.font ?? this.defaultFont;
      const font = id === undefined ? undefined : fonts.get(id)?.name;
      if (font) item.font = font;
      if (run.script) item.script = run.script;
      if (run.caps) item.caps = true;
      const link = safeLink(state.link);
      if (link) item.link = link;
      if (ranges.size) item.comments = [...ranges].map((r) => `r${r}`);
      text.split("\t").forEach((part, i) => {
        if (i > 0) state.flow.add({ type: "tab" });
        if (part) state.flow.add({ ...item, text: part });
      });
    },
    colorText(/** @type {string} */ text) {
      for (const ch of text) {
        if (ch !== ";") continue;
        const { red, green, blue, any } = parts;
        const hex = [red, green, blue].map((v) => v.toString(16).padStart(2, "0")).join("");
        colors.push(any ? color(hex) : undefined);
        parts = { red: 0, green: 0, blue: 0, any: false };
      }
    },
    /** @param {"red" | "green" | "blue"} which @param {number} value */
    colorPart(which, value) {
      parts[which] = Math.max(0, Math.min(255, value));
      parts.any = true;
    },
    styleStart(/** @type {number} */ id) {
      styleId = id;
      styleLevel = undefined;
    },
    styleLevel(/** @type {number} */ level) {
      styleLevel = level;
    },
    styleText(/** @type {string} */ text) {
      const name = text.replace(/;[\s\S]*$/, "").trim();
      if (!name) return;
      const heading = /^heading ([1-6])$/i.exec(name);
      const level =
        styleLevel !== undefined ? styleLevel + 1 : heading ? Number(heading[1]) : undefined;
      styles.set(styleId, level !== undefined && level <= 6 ? { name, level } : { name });
    },
    /** @param {Pict} pict @param {State} state */
    picture(pict, state) {
      const data = pict.bin ?? fromHex(pict.hex.join(""));
      const shown = pict.kind === "png" || pict.kind === "jpeg";
      const src = shown ? pictureUrl(data) : null;
      const width = twips(((pict.goalw || pict.w * 15) * pict.sx) / 100) || undefined;
      const height = twips(((pict.goalh || pict.h * 15) * pict.sy) / 100) || undefined;
      const alt = src ? "Picture" : `Picture (${pict.kind.toUpperCase()}, not shown)`;
      state.flow.add({ type: "image", src, width, height, alt });
    },
    finish(/** @type {RtfPara} */ props) {
      closeSection(props);
      return documentOf({
        format: "rtf",
        formatName: "Rich Text Format",
        title,
        sections,
        notes,
        comments,
      });
    },
  };
}

/** @typedef {ReturnType<typeof createDoc>} RtfDoc */
