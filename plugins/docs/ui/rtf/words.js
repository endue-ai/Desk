// What each RTF control word does to the state of its group, the document's tables and the flow
// being written. Unknown words are ignored, as the format asks of readers.
import { applyGroupWord } from "./groups.js";
import { charsetCodepage } from "./tokens.js";

/**
 * @typedef {import("./index.js").State} State
 * @typedef {import("./doc.js").RtfDoc} RtfDoc
 */

const CHARS = /** @type {Record<string, string>} */ ({
  emdash: "—",
  endash: "–",
  bullet: "•",
  lquote: "‘",
  rquote: "’",
  ldblquote: "“",
  rdblquote: "”",
  emspace: " ",
  enspace: " ",
  qmspace: " ",
});

const UNDERLINES = new Set([
  "ul",
  "uld",
  "uldb",
  "ulw",
  "uldash",
  "uldashd",
  "uldashdd",
  "ulhwave",
  "ulldash",
  "ulth",
  "ulthd",
  "ulthdash",
  "ulthdashd",
  "ulthdashdd",
  "ulthldash",
  "ululdbwave",
  "ulwave",
]);

/**
 * @param {RtfDoc} doc
 * @param {State} state
 * @param {string} word
 * @param {number | undefined} p
 */
export function applyWord(doc, state, word, p) {
  const on = p === undefined || p !== 0;
  const { run, para } = state;
  const body = state.dest === "body";
  const capture = (/** @type {(text: string) => void} */ done) => {
    const text = /** @type {string[]} */ ([]);
    state.text = text;
    state.dest = "text";
    state.close = () => done(text.join(""));
  };
  if (applyGroupWord(doc, state, word, p)) return;
  if (UNDERLINES.has(word)) {
    run.underline = on;
    return;
  }
  if (CHARS[word]) {
    if (body) doc.text(state, CHARS[word] ?? "");
    return;
  }
  switch (word) {
    case "ansicpg":
      doc.codepage = p ?? 1252;
      break;
    case "mac":
      doc.codepage = 10000;
      break;
    case "deff":
      doc.defaultFont = p;
      break;
    case "fonttbl":
    case "colortbl":
    case "stylesheet":
    case "info":
      state.dest = word;
      break;
    case "title":
      capture((t) => doc.setTitle(t));
      break;
    case "f":
      if (state.dest === "fonttbl") state.font = { id: p ?? 0, name: [] };
      else run.font = p;
      break;
    case "fcharset":
      if (state.font) state.font.cp = charsetCodepage(p ?? 0);
      break;
    case "cpg":
      if (state.font) state.font.cp = p;
      break;
    case "red":
    case "green":
    case "blue":
      if (state.dest === "colortbl") doc.colorPart(word, p ?? 0);
      break;
    case "s":
      if (state.dest === "stylesheet") doc.styleStart(p ?? 0);
      else {
        // The style's own properties first; the words after \sN override them.
        const style = doc.styles.get(p ?? 0);
        for (const layer of doc.styleChain(p ?? 0)) {
          Object.assign(run, layer.run);
          Object.assign(para, layer.para);
        }
        para.style = style?.name;
        para.level = style?.level;
      }
      break;
    case "sbasedon":
      if (state.dest === "stylesheet") doc.styleBasedOn(p ?? 0);
      break;
    case "outlinelevel":
      if (state.dest === "stylesheet") doc.styleLevel(p ?? 0);
      else para.level = p !== undefined && p < 6 ? p + 1 : undefined;
      break;
    case "pard":
      state.para = {};
      break;
    case "plain":
      state.run = {};
      break;
    case "par":
      if (body) state.flow.par(para);
      break;
    case "line":
      if (body) state.flow.add({ type: "linebreak" });
      break;
    case "tab":
      if (body) state.flow.add({ type: "tab" });
      break;
    case "page":
      if (body) state.flow.pageBreak();
      break;
    case "sect":
      if (body && state.flow === doc.body) doc.newSection(para);
      break;
    case "sectd":
      doc.resetSection();
      break;
    case "intbl":
      para.intbl = true;
      break;
    case "cell":
    case "nestcell":
      if (body) state.flow.endCell(para);
      break;
    case "row":
    case "nestrow":
      if (body) state.flow.endRow(doc.rowDefs);
      break;
    case "trowd":
      doc.rowDefs = [];
      doc.cellDef = { right: 0 };
      break;
    case "cellx":
      doc.rowDefs.push({ ...doc.cellDef, right: p ?? 0 });
      doc.cellDef = { right: 0 };
      break;
    case "clmgf":
      doc.cellDef.hmerge = "first";
      break;
    case "clmrg":
      doc.cellDef.hmerge = "next";
      break;
    case "clvmgf":
      doc.cellDef.vmerge = "first";
      break;
    case "clvmrg":
      doc.cellDef.vmerge = "next";
      break;
    case "clcbpat":
      doc.cellDef.fill = doc.color(p ?? 0);
      break;
    case "ql":
      para.align = "left";
      break;
    case "qc":
      para.align = "center";
      break;
    case "qr":
      para.align = "right";
      break;
    case "qj":
    case "qd":
      para.align = "justify";
      break;
    case "li":
    case "lin":
      para.left = p;
      break;
    case "ri":
    case "rin":
      para.right = p;
      break;
    case "fi":
      para.first = p;
      break;
    case "sb":
      para.before = p;
      break;
    case "sa":
      para.after = p;
      break;
    case "sl":
      para.line = p ? Math.abs(p) : undefined;
      para.exact = true;
      break;
    case "slmult":
      if (p === 1) para.exact = false;
      break;
    case "pagebb":
      para.pagebb = true;
      break;
    case "rtlpar":
      para.rtl = true;
      break;
    case "b":
      run.bold = on;
      break;
    case "i":
      run.italic = on;
      break;
    case "ulnone":
      run.underline = false;
      break;
    case "strike":
    case "striked":
      run.strike = on;
      break;
    case "fs":
      run.size = p ? p / 2 : undefined;
      break;
    case "cf":
      run.color = p;
      break;
    case "highlight":
    case "cb":
    case "chcbpat":
      run.highlight = p;
      break;
    case "super":
      run.script = "super";
      break;
    case "sub":
      run.script = "sub";
      break;
    case "nosupersub":
      run.script = undefined;
      break;
    case "caps":
    case "scaps":
      run.caps = on;
      break;
    case "v":
      run.hidden = on;
      break;
    case "chpgn":
      if (body) state.flow.add({ type: "field", field: "page", text: "" });
      break;
  }
}
