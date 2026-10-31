// RTF: the font, colour and style tables, character and paragraph properties per group, \uN with
// its \ucN fallback, \'hh bytes in the font's or the document's code page (949, 932, 1252...),
// tables, pictures (\pngblip, \jpegblip), fields, footnotes, annotations and headers.
import { decode } from "../bytes.js";
import { createDoc } from "./doc.js";
import { Flow } from "./flow.js";
import { DESTINATIONS, SKIPPED } from "./groups.js";
import { codepageLabel, DOUBLE_BYTE, tokens } from "./tokens.js";
import { applyWord } from "./words.js";

/**
 * @typedef {import("./flow.js").RtfPara} RtfPara
 * @typedef {{ bold?: boolean, italic?: boolean, underline?: boolean, strike?: boolean, size?: number, color?: number, highlight?: number, font?: number, script?: "super" | "sub", caps?: boolean, hidden?: boolean }} RtfRun
 * @typedef {{ kind: string, goalw: number, goalh: number, w: number, h: number, sx: number, sy: number, hex: string[], bin?: Uint8Array }} Pict
 * @typedef {{
 *   dest: string, run: RtfRun, para: RtfPara, uc: number, flow: Flow, link?: string,
 *   starred?: boolean, close?: () => void, pict?: Pict, text?: string[], field?: string[],
 *   font?: { id: number, name: string[], cp?: number }, note?: { kind: "footnote" | "endnote" },
 * }} State
 */

/** @param {Uint8Array} bytes */
export function readRtf(bytes) {
  const doc = createDoc();
  /** @type {State} */
  let state = { dest: "body", run: {}, para: {}, uc: 1, flow: doc.body };
  /** @type {State[]} */
  const stack = [];
  /** @type {number[]} */
  let pending = [];
  let skip = 0;

  const codepage = () => {
    const id = state.run.font ?? doc.defaultFont;
    const font = id === undefined ? undefined : doc.fonts.get(id);
    return font?.cp ?? doc.codepage;
  };
  /** Text in the current destination. */
  const write = (/** @type {string} */ text) => {
    if (!text) return;
    if (state.dest === "body") {
      if (!state.run.hidden) doc.text(state, text);
    } else if (state.text) state.text.push(text);
    else if (state.dest === "fonttbl") doc.fontText(state, text);
    else if (state.dest === "colortbl") doc.colorText(text);
    else if (state.dest === "stylesheet") doc.styleText(text, state);
  };
  const flush = () => {
    if (pending.length === 0) return;
    const text = decode(Uint8Array.from(pending), codepageLabel(codepage()));
    pending = [];
    write(text);
  };

  for (const token of tokens(bytes)) {
    if (token.t !== "byte" && !(token.t === "text" && pending.length % 2 === 1)) flush();
    if (skip > 0 && token.t !== "open" && token.t !== "close") {
      if (token.t === "text") {
        const cut = Math.min(skip, token.text.length);
        skip -= cut;
        if (cut < token.text.length) write(token.text.slice(cut));
      } else skip--;
      continue;
    }
    switch (token.t) {
      case "open":
        skip = 0;
        stack.push(state);
        state = {
          ...state,
          run: { ...state.run },
          para: { ...state.para },
          starred: false,
          close: undefined,
        };
        if (state.dest === "stylesheet") doc.styleStart(0);
        break;
      case "close":
        skip = 0;
        flush();
        state.close?.();
        state = stack.pop() ?? state;
        break;
      case "byte":
        if (state.dest === "pict") state.pict?.hex.push(token.value.toString(16).padStart(2, "0"));
        else if (state.dest !== "skip") pending.push(token.value);
        break;
      case "bin":
        if (state.dest === "pict" && state.pict) state.pict.bin = token.bytes;
        break;
      case "text": {
        if (state.dest === "skip") break;
        if (state.dest === "pict") {
          state.pict?.hex.push(token.text);
          break;
        }
        let text = token.text;
        if (pending.length % 2 === 1) {
          // A double-byte character whose trail byte is a plain ASCII letter.
          if (DOUBLE_BYTE.has(codepage())) {
            pending.push(text.charCodeAt(0));
            text = text.slice(1);
          }
          flush();
        }
        write(text);
        break;
      }
      case "symbol":
        if (state.dest === "skip") break;
        if (token.ch === "*") state.starred = true;
        else if (token.ch === "~") write(" ");
        else if (token.ch === "_") write("‑");
        else if (token.ch === "\\" || token.ch === "{" || token.ch === "}") write(token.ch);
        break;
      case "word": {
        const { word, param } = token;
        if (state.dest === "skip") break;
        // \* marks only the word right after it as a destination Docs may skip.
        const starred = state.starred;
        state.starred = false;
        if (word === "u" && param !== undefined) {
          write(String.fromCharCode(param < 0 ? param + 65536 : param));
          skip = state.uc;
        } else if (word === "uc") state.uc = param ?? 1;
        else if ((starred && !DESTINATIONS.has(word)) || SKIPPED.has(word)) state.dest = "skip";
        else applyWord(doc, state, word, param);
      }
    }
  }
  flush();
  return doc.finish(state.para);
}
