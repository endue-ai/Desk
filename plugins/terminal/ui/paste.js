// Pasting into a terminal (TERM-I02). Several lines pasted into a program that has not turned on
// bracketed paste run one by one as they arrive, so the person is asked first; the setting
// endue.terminal.paste-warning says when (auto: only then; always; never). The markers that start
// and end a bracketed paste are taken out of the text, so a paste cannot end one early and have the
// rest typed as commands. No DOM: view.js catches the paste and shows the question.

/** @typedef {"auto" | "always" | "never"} Warn */

// biome-ignore lint/suspicious/noControlCharactersInRegex: the markers start with ESC
const MARKERS = /\x1b\[20[01]~/g;

/**
 * What a paste holds: its text without bracketed-paste markers, its lines (a last newline aside) and
 * whether to ask before it goes in.
 * @param {string} text
 * @param {{ bracketed: boolean, warn: Warn }} options
 */
export function preparePaste(text, { bracketed, warn }) {
  const clean = text.replace(MARKERS, "");
  const lines = clean.replace(/(\r\n|\r|\n)$/u, "").split(/\r\n|\r|\n/u).length;
  const ask = lines > 1 && (warn === "always" || (warn === "auto" && !bracketed));
  return { text: clean, lines, ask };
}

/**
 * @param {{
 *   paste(text: string): void,
 *   ask(text: string, lines: number): Promise<boolean>,
 *   bracketed(): boolean,
 *   warn(): Warn,
 * }} deps
 */
export function createPasteGuard(deps) {
  return {
    /** Paste `text`, asking first when it should; resolves with whether it went in. */
    async paste(/** @type {string} */ text) {
      if (text === "") return false;
      const prepared = preparePaste(text, { bracketed: deps.bracketed(), warn: deps.warn() });
      if (prepared.text === "") return false;
      if (prepared.ask && !(await deps.ask(prepared.text, prepared.lines))) return false;
      deps.paste(prepared.text);
      return true;
    },
  };
}
