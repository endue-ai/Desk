// A PostgreSQL script read by the server's own grammar (wasm.js): every statement's raw parse tree,
// where it starts and ends, and for a statement that does not parse the server's message and where
// it points. A script that parses whole is cut where the parser cuts it. One that does not is cut by
// the plugin's splitter (ui/sql/split.js, psql's rules) and each statement parsed alone, so one
// mistake leaves the others their trees; split-parse.test.ts holds the two cuts to each other. Every
// `location` in a tree is the UTF-8 byte the node starts at in the whole script.
import { tokenize } from "../lexer.js";
import { split } from "../split.js";
import { createPositions } from "./positions.js";
import { kindOf, shiftLocations } from "./tree.js";

/**
 * @typedef {import("./positions.js").Position} Position
 * @typedef {import("./positions.js").Positions} Positions
 * @typedef {import("./wasm.js").RawParser} RawParser
 * @typedef {import("./tree.js").Node} Node
 * @typedef {{ message: string, position: Position }} ParseError
 * @typedef {{ kind: string | null, start: Position, end: Position, tree: Node | null, error?: ParseError }} ParsedStatement
 *   `kind` is the tree's node kind (`SelectStmt`), null when the statement does not parse.
 * @typedef {{ version: number, whole: boolean, statements: ParsedStatement[] }} Parsed
 *   `version` is the grammar's server version (180004); `whole` is false when the script was cut
 *   by the splitter because it did not parse as one.
 */

/** Where a statement ends once the space and comments before its terminator are left out. */
export function trimEnd(/** @type {string} */ sql, /** @type {number} */ from, to = sql.length) {
  let end = to;
  while (end > from && /\s/u.test(sql[end - 1] ?? "")) end--;
  // Only the statement's own text is searched, so a long script costs no more per statement.
  const own = sql.slice(from, end);
  const comment = own.endsWith("*/") || own.includes("--", own.lastIndexOf("\n") + 1);
  if (!comment) return end;
  const tokens = tokenize(sql.slice(from, end), "postgresql");
  for (let i = tokens.length - 1; i >= 0; i--) {
    const token = /** @type {import("../lexer.js").Token} */ (tokens[i]);
    if (token.type !== "space" && token.type !== "comment") return from + token.end;
  }
  return from;
}

/** A splitter statement's place without the comments it starts or ends with. */
export function codeOf(/** @type {import("../split.js").Statement} */ statement) {
  const code = statement.tokens.filter((t) => t.type !== "space" && t.type !== "comment");
  return {
    start: code[0]?.start ?? statement.start,
    end: code[code.length - 1]?.end ?? statement.end,
  };
}

/**
 * @param {RawParser} raw
 * @returns {(sql: string, positions?: Positions) => Parsed}
 */
export function createParse(raw) {
  return (sql, positions = createPositions(sql)) => {
    const whole = raw.parse(sql);
    if ("tree" in whole) {
      const stmts = whole.tree.stmts ?? [];
      return {
        version: whole.tree.version,
        whole: true,
        statements: stmts.map((stmt) => {
          const from = stmt.stmt_location ?? 0;
          const start = positions.at(from);
          const to = stmt.stmt_len ? positions.at(from + stmt.stmt_len).offset : sql.length;
          const tree = stmt.stmt ?? null;
          return {
            kind: kindOf(tree),
            start,
            end: positions.ofOffset(trimEnd(sql, start.offset, to)),
            tree,
          };
        }),
      };
    }
    return { whole: false, ...piecewise(raw, sql, positions, whole.error) };
  };
}

/**
 * Each statement the splitter cuts, parsed alone. A space goes before each so that no node of it
 * sits at 0, which libpg_query would leave out; every location then moves to the whole script.
 * @param {RawParser} raw @param {string} sql @param {Positions} positions
 * @param {import("./wasm.js").RawError} wholeError
 * @returns {{ version: number, statements: ParsedStatement[] }}
 */
function piecewise(raw, sql, positions, wholeError) {
  /** @type {ParsedStatement[]} */
  const statements = [];
  let version = 0;
  for (const piece of split(sql, "postgresql")) {
    const base = positions.byteOf(piece.start) - 1;
    const read = raw.parse(` ${piece.text}`);
    const code = codeOf(piece);
    if ("error" in read) {
      const { message, cursor } = read.error;
      const at = cursor > 1 ? positions.characterOf(piece.start) + cursor - 2 : -1;
      statements.push({
        kind: null,
        start: positions.ofOffset(code.start),
        end: positions.ofOffset(code.end),
        tree: null,
        error: {
          message,
          position: at < 0 ? positions.ofOffset(code.start) : positions.ofCharacter(at),
        },
      });
      continue;
    }
    version = read.tree.version;
    for (const stmt of read.tree.stmts ?? []) {
      const tree = stmt.stmt ?? null;
      shiftLocations(tree, base);
      const start = positions.at(base + (stmt.stmt_location ?? 0));
      const to = stmt.stmt_len ? positions.at(start.byte + stmt.stmt_len).offset : code.end;
      const end = positions.ofOffset(trimEnd(sql, start.offset, to));
      statements.push({ kind: kindOf(tree), start, end, tree });
    }
  }
  // Each statement parsed alone though the script did not: the server's message goes where it points.
  if (!statements.some((s) => s.error)) {
    const at =
      wholeError.cursor > 0 ? positions.ofCharacter(wholeError.cursor - 1) : positions.at(0);
    const error = { message: wholeError.message, position: at };
    const holder =
      statements.find((s) => at.offset <= s.end.offset) ?? statements[statements.length - 1];
    if (holder) holder.error = error;
    else statements.push({ kind: null, start: at, end: at, tree: null, error });
  }
  return { version, statements };
}
