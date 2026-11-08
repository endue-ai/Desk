// The RTF control words that open or shape a group: pictures and shapes, fields, footnotes,
// annotations, headers and footers, list text, and the page setup of the document and sections.
import { Flow } from "./flow.js";

/**
 * @typedef {import("./index.js").State} State
 * @typedef {import("./doc.js").RtfDoc} RtfDoc
 */

/** Groups whose text is never shown. */
export const SKIPPED = new Set([
  "listtable",
  "listoverridetable",
  "revtbl",
  "rsidtbl",
  "generator",
  "xmlnstbl",
  "mmathPr",
  "pgdsctbl",
  "themedata",
  "colorschememapping",
  "latentstyles",
  "datastore",
  "defchp",
  "defpap",
  "filetbl",
  "pnseclvl",
  "pntxta",
  "pntxtb",
  "template",
  "userprops",
  "docvar",
  "nonshppict",
  "objdata",
  "objclass",
  "wgrffmtfilter",
  "fchars",
  "lchars",
  "shprslt",
  "bkmkstart",
  "bkmkend",
  "atnid",
  "author",
  "operator",
  "company",
  "keywords",
  "comment",
  "doccomm",
  "subject",
  "category",
  "manager",
  "hlinkbase",
  "creatim",
  "revtim",
  "printim",
  "buptim",
  "headerl",
  "headerf",
  "footerl",
  "footerf",
  "ftnsep",
  "ftnsepc",
  "ftncn",
  "aftnsep",
  "aftnsepc",
  "aftncn",
  "xe",
  "tc",
  "txe",
  "rxe",
  "factoidname",
  "passwordhash",
  "panose",
  "falt",
  "expandedcolortbl",
  "listpicture",
  "blipuid",
  "pgptbl",
  "oldcprops",
  "oldpprops",
  "oldsprops",
  "oldtprops",
  "protusertbl",
  "background",
  "fldtype",
  "formfield",
  "datafield",
]);

/** The \* destinations Docs reads; any other starred group is skipped. */
export const DESTINATIONS = new Set([
  "fldinst",
  "atnauthor",
  "annotation",
  "atrfstart",
  "atrfend",
  "atnref",
  "atndate",
  "shppict",
  "ud",
  "shpinst",
  "shptxt",
  "pict",
  "footnote",
  "listtext",
  "pntext",
  "title",
  "sv",
  "sn",
]);

/** A Word date-time (DTTM) as an ISO string. */
const dttm = (/** @type {number} */ v) => {
  const pad = (/** @type {number} */ n) => String(n).padStart(2, "0");
  const year = ((v >>> 20) & 0x1ff) + 1900;
  const month = (v >>> 16) & 0xf;
  const day = (v >>> 11) & 0x1f;
  if (!month || !day) return "";
  return `${year}-${pad(month)}-${pad(day)}T${pad((v >>> 6) & 0x1f)}:${pad(v & 0x3f)}:00`;
};

/**
 * @param {RtfDoc} doc
 * @param {State} state
 * @param {string} word
 * @param {number | undefined} p
 * @returns {boolean} whether the word was one of these
 */
export function applyGroupWord(doc, state, word, p) {
  const capture = (/** @type {(text: string) => void} */ done) => {
    const text = /** @type {string[]} */ ([]);
    state.text = text;
    state.dest = "text";
    state.close = () => done(text.join(""));
  };
  /** A new flow (note, annotation, header) written inside this group. */
  const nested = (/** @type {(blocks: import("../model.js").Block[]) => void} */ done) => {
    const flow = new Flow();
    state.flow = flow;
    state.dest = "body";
    state.para = {};
    state.run = {};
    state.link = undefined;
    state.close = () => done(flow.finish({}));
  };
  switch (word) {
    case "pict":
      state.dest = "pict";
      state.pict = { kind: "unknown", goalw: 0, goalh: 0, w: 0, h: 0, sx: 100, sy: 100, hex: [] };
      {
        const pict = state.pict;
        state.close = () => doc.picture(pict, state);
      }
      break;
    case "pngblip":
    case "jpegblip":
    case "emfblip":
    case "wmetafile":
    case "macpict":
    case "dibitmap":
    case "wbitmap":
      if (state.pict) state.pict.kind = word.replace(/blip$/, "").replace("wmetafile", "wmf");
      break;
    case "picw":
    case "pich":
    case "picwgoal":
    case "pichgoal":
    case "picscalex":
    case "picscaley":
      if (state.pict) {
        const key = /** @type {const} */ ({
          picw: "w",
          pich: "h",
          picwgoal: "goalw",
          pichgoal: "goalh",
          picscalex: "sx",
          picscaley: "sy",
        })[word];
        state.pict[key] = p ?? 0;
      }
      break;
    case "sn":
      capture((t) => (doc.shapeProperty = t.trim()));
      break;
    case "sv":
      // A shape's picture is its "pib" property; fills and other values are not shown.
      state.dest = doc.shapeProperty === "pib" ? "shape" : "skip";
      break;
    case "shpinst":
    case "upr":
      state.dest = "shape";
      break;
    case "ud":
    case "shptxt":
    case "shppict":
      state.dest = "body";
      break;
    case "field":
      state.field = [];
      break;
    case "fldinst": {
      const instr = state.field ?? [];
      state.text = instr;
      state.dest = "text";
      break;
    }
    case "fldrslt": {
      state.dest = "body";
      const instr = (state.field ?? []).join("");
      const link = /HYPERLINK\s+"([^"]+)"/i.exec(instr)?.[1];
      if (link) state.link = link;
      const field = /^\s*(PAGE|NUMPAGES)\b/i.exec(instr)?.[1]?.toUpperCase();
      if (field) {
        state.flow.add({ type: "field", field: field === "PAGE" ? "page" : "pages", text: "" });
        state.dest = "skip";
      }
      break;
    }
    case "footnote": {
      const outer = state.flow;
      /** @type {import("../model.js").NoteRef} */
      const ref = { type: "noteref", note: `n${doc.notes.length + 1}`, label: "" };
      const note = { kind: /** @type {"footnote" | "endnote"} */ ("footnote") };
      state.note = note;
      outer.add(ref);
      nested((blocks) => {
        const count = doc.notes.filter((n) => n.kind === note.kind).length + 1;
        ref.label =
          note.kind === "endnote"
            ? (["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x"][count - 1] ??
              String(count))
            : String(count);
        doc.notes.push({ id: ref.note, kind: note.kind, label: ref.label, blocks });
      });
      break;
    }
    case "ftnalt":
      if (state.note) state.note.kind = "endnote";
      break;
    case "atnauthor":
      capture((t) => (doc.annotation.author = t.trim()));
      break;
    case "atndate":
      capture((t) => (doc.annotation.date = dttm(Number(t.trim()))));
      break;
    case "atnref":
      capture((t) => (doc.annotation.ref = t.trim()));
      break;
    case "atrfstart":
      capture((t) => doc.ranges.add(t.trim()));
      break;
    case "atrfend":
      capture((t) => doc.ranges.delete(t.trim()));
      break;
    case "annotation": {
      const outer = state.flow;
      nested((blocks) => {
        const { author, date, ref } = doc.annotation;
        const id = ref ? `r${ref}` : `p${doc.comments.length + 1}`;
        doc.comments.push({ id, author, date, blocks });
        if (!ref) outer.add({ type: "anchor", comments: [id] });
        doc.annotation = { author: "", date: "", ref: "" };
      });
      break;
    }
    case "header":
    case "headerr":
      nested((blocks) => doc.setPart("header", blocks));
      break;
    case "footer":
    case "footerr":
      nested((blocks) => doc.setPart("footer", blocks));
      break;
    case "listtext":
    case "pntext": {
      const flow = state.flow;
      capture((t) => (flow.marker = t.replace(/\s+$/, "")));
      break;
    }
    case "paperw":
    case "paperh":
    case "margl":
    case "margr":
    case "margt":
    case "margb": {
      const key = /** @type {const} */ ({
        paperw: "width",
        paperh: "height",
        margl: "left",
        margr: "right",
        margt: "top",
        margb: "bottom",
      })[word];
      doc.page[key] = p ?? doc.page[key];
      doc.current()[key] = p ?? doc.current()[key];
      break;
    }
    case "pgwsxn":
    case "pghsxn":
    case "marglsxn":
    case "margrsxn":
    case "margtsxn":
    case "margbsxn":
    case "headery":
    case "footery": {
      const key = /** @type {const} */ ({
        pgwsxn: "width",
        pghsxn: "height",
        marglsxn: "left",
        margrsxn: "right",
        margtsxn: "top",
        margbsxn: "bottom",
        headery: "header",
        footery: "footer",
      })[word];
      doc.current()[key] = p ?? doc.current()[key];
      break;
    }
    default:
      return false;
  }
  return true;
}
