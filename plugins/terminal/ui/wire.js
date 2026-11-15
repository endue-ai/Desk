// What a terminal's program says besides its text, from xterm.js to the actions: the OSC sequences
// osc.js reads, OSC 52's copies (clipboard.js), the title, the bell, and the mouse reports xterm.js
// makes in the X10 encoding. Those are binary, not text: xterm.js hands them to onBinary, so a
// program that turns the mouse on without SGR's 1006 (every ncurses program with macOS's own
// terminfo) hears its clicks only through this (issue 319). No DOM.
import { OSC_COPY } from "./clipboard.js";
import { CODES } from "./osc.js";

/**
 * @typedef {import("./pipe.js").Input} Input
 * @typedef {{
 *   input(id: string, data: Input): unknown, osc(id: string, code: number, data: string): unknown,
 *   retitle(id: string, title: string): unknown, bell(id: string): unknown,
 * }} Actions
 * @typedef {{
 *   parser: { registerOscHandler(code: number, handler: (data: string) => boolean): unknown },
 *   onTitleChange(listener: (title: string) => void): unknown,
 *   onBell(listener: () => void): unknown,
 *   onBinary(listener: (data: string) => void): unknown,
 * }} Emulator
 */

/**
 * @param {Emulator} term
 * @param {string} id
 * @param {Actions} actions
 * @param {(id: string, data: string) => void} copy OSC 52's payload, for clipboard.js
 */
export function wireProgram(term, id, actions, copy) {
  for (const code of CODES) {
    term.parser.registerOscHandler(code, (data) => {
      actions.osc(id, code, data);
      return true;
    });
  }
  term.parser.registerOscHandler(OSC_COPY, (data) => {
    copy(id, data);
    return true;
  });
  term.onTitleChange((title) => actions.retitle(id, title));
  term.onBell(() => actions.bell(id));
  term.onBinary((data) => actions.input(id, { binary: data }));
}
