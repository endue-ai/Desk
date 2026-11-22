// A password command as the person writes it (PG-14, ADR 0354): a program and its arguments on one
// line, split on spaces, a word holding spaces or quotes in double quotes ("a b", "say \"hi\""), and
// nothing a shell would do: no variables, no globs, no pipes. The connection keeps the line in one
// spelling (each word quoted only when it must be), so a change shows as a changed field; the
// program is a name looked up on PATH or a full path. The programs the plugin may run without
// asking (the manifest's named `proc:spawn` list) are not taken: a password command always asks.
// No DOM.

/** Programs `plugin.json` grants by name at install (tests/manifest.test.ts pins them). */
export const GRANTED = Object.freeze(["mysql", "mariadb", "sqlite3", "pg_dump", "pg_restore"]);
const MAX_LENGTH = 2048;
const MAX_WORDS = 64;

/**
 * The words of a command line, or the sentence why it cannot be read.
 * @param {string} line
 * @returns {string[] | string}
 */
export function wordsOf(line) {
  /** @type {string[]} */
  const words = [];
  let at = 0;
  while (at < line.length) {
    while (line[at] === " " || line[at] === "\t") at++;
    if (at >= line.length) break;
    let word = "";
    let quoted = false;
    while (at < line.length && line[at] !== " " && line[at] !== "\t") {
      if (line[at] !== '"') {
        word += line[at++];
        continue;
      }
      quoted = true;
      at++;
      while (at < line.length && line[at] !== '"') {
        if (line[at] === "\\" && (line[at + 1] === '"' || line[at + 1] === "\\")) at++;
        word += line[at++];
      }
      if (at >= line.length) return 'a double quote is not closed: end the word with ".';
      at++;
    }
    if (word || quoted) words.push(word);
  }
  return words;
}

/** One word as the connection keeps it: quoted only when it is empty or holds a space or quote. */
export function quoted(/** @type {string} */ word) {
  if (word && !/[\s"\\]/u.test(word)) return word;
  return `"${word.replace(/["\\]/gu, (c) => `\\${c}`)}"`;
}

/**
 * The command checked and in the connection's spelling, "" when there is none; an Error names what
 * is wrong.
 * @param {unknown} value
 */
export function commandOf(value) {
  const field = "Password command";
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new Error(`${field}: text expected.`);
  if (/[\n\r\0]/u.test(value)) throw new Error(`${field}: one line, please.`);
  if (value.length > MAX_LENGTH) throw new Error(`${field}: at most ${MAX_LENGTH} characters.`);
  const words = wordsOf(value.trim());
  if (typeof words === "string") throw new Error(`${field}: ${words}`);
  if (words.length === 0) return "";
  if (words.length > MAX_WORDS) throw new Error(`${field}: at most ${MAX_WORDS} words.`);
  const program = /** @type {string} */ (words[0]);
  if (program.includes("/") && !program.startsWith("/"))
    throw new Error(`${field}: the program by its name, or its full path starting with /.`);
  const name = program.slice(program.lastIndexOf("/") + 1);
  if (GRANTED.includes(name))
    throw new Error(`${field}: ${name} is one of the database clients, not a password program.`);
  return words.map(quoted).join(" ");
}

/** The program and its arguments of a kept command. */
export function argvOf(/** @type {string} */ command) {
  const words = wordsOf(command);
  if (typeof words === "string" || words.length === 0) return { program: "", args: [] };
  return { program: /** @type {string} */ (words[0]), args: words.slice(1) };
}
