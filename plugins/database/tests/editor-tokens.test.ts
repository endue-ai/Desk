// The console editor's tokens of a script of any size (ui/editor/tokens.js): lexed from checkpoints,
// they must be the tokens the lexer gives the whole text, so what is drawn as a string runs as one,
// in every dialect, after any edit. Then what pairs up and folds, from those tokens (pairs.js).
import { describe, expect, it } from "vitest";
import { highlight, runsOf } from "../ui/editor/highlight.js";
import { foldsIn, pairAt } from "../ui/editor/pairs.js";
import { CHUNK, Lexed } from "../ui/editor/tokens.js";
import { type Dialect, tokenize } from "../ui/sql/lexer.js";

const DIALECTS: Dialect[] = ["postgresql", "mysql", "sqlite"];

/** A source over a string that counts what it hands out. */
function source(text: string) {
  const counted = { read: 0 };
  return {
    counted,
    length: text.length,
    sliceString(from: number, to = text.length) {
      counted.read += to - from;
      return text.slice(from, to);
    },
  };
}

/** One replacement, as the editor's changes describe it. */
function change(from: number, to: number, insert: string) {
  const delta = insert.length - (to - from);
  return {
    iterChangedRanges: (f: (fromA: number, toA: number) => void) => f(from, to),
    mapPos: (pos: number, assoc = -1) =>
      pos < from ? pos : pos > to ? pos + delta : assoc < 0 ? from : from + insert.length,
  };
}

const PIECES = [
  "select a, b from t where x = 'it''s' and y = 2;\n",
  "insert into t values (1, E'a\\'b', $$body; with ; inside$$, $tag$ $$ $tag$);\n",
  "/* a /* nested */ comment; */ select 1;\n",
  "-- a comment; with a semicolon\n",
  'select "quoted;name", `tick;name`, [bracket;name] from t;\n',
  "create function f() returns int as $$\nbegin\n  return (1 + (2));\nend;\n$$ language plpgsql;\n",
  "DELIMITER //\ncreate procedure p() begin select 1; end//\nDELIMITER ;\n",
  "select t.order, count(x) from t group by 1;\n",
  "   \n\n",
  "select '",
  "update t set a = :name, b = $1, c = ? where d = 0x1F;\n",
];

/** A deterministic pseudo-random sequence. */
function random(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

function script(rand: () => number, size: number) {
  let text = "";
  while (text.length < size) text += PIECES[Math.floor(rand() * PIECES.length)];
  return text;
}

/** The highlight runs of `from`..`to` as the whole text's lexer gives them. */
function wholeRuns(text: string, dialect: Dialect, from: number, to: number) {
  const spans: { from: number; to: number; kind: string }[] = [];
  let at = 0;
  for (const run of highlight(text, dialect)) {
    const start = Math.max(from, at);
    const end = Math.min(to, at + run.text.length);
    if (end > start && run.kind !== "plain") {
      const last = spans[spans.length - 1];
      if (last && last.kind === run.kind && last.to === start) last.to = end;
      else spans.push({ from: start, to: end, kind: run.kind });
    }
    at += run.text.length;
  }
  return spans;
}

const solid = (tokens: { type: string; start: number; end: number }[], from: number, to: number) =>
  tokens
    .filter((t) => t.type !== "space" && t.end > from && t.start < to)
    .map((t) => `${t.type}@${t.start}-${t.end}`);

function agrees(lexed: Lexed, text: string, dialect: Dialect, rand: () => number, ranges = 12) {
  const whole = tokenize(text, dialect);
  for (let i = 0; i < ranges; i++) {
    const from = Math.floor(rand() * text.length);
    const to = Math.min(text.length, from + 1 + Math.floor(rand() * 3000));
    const { tokens, exact } = lexed.tokens(from, to);
    expect(exact).toBe(true);
    expect(solid(tokens, from, to)).toEqual(solid(whole, from, to));
    expect(runsOf(tokens, dialect, from, to)).toEqual(wholeRuns(text, dialect, from, to));
  }
}

describe("a window lexed from a checkpoint has the whole text's tokens", () => {
  for (const dialect of DIALECTS)
    it(`in ${dialect}`, () => {
      const rand = random(DIALECTS.indexOf(dialect) + 7);
      const text = script(rand, 6 * CHUNK);
      const lexed = new Lexed(dialect, source(text));
      expect(lexed.work(() => false)).toBe(true);
      expect(lexed.points.length).toBeGreaterThan(3);
      agrees(lexed, text, dialect, rand, 30);
      // Asked first, before any work: the same answers.
      agrees(new Lexed(dialect, source(text)), text, dialect, rand);
    });

  it("checkpoints keep MySQL's delimiter and whether a statement may start", () => {
    const text = [
      "DELIMITER //\n",
      "select 1; select 2//\n".repeat(3000),
      "DELIMITER ;\n",
      "select\n",
      "  a,\n".repeat(10000),
      "delimiter x\n",
      "  b;\n",
      "select 3;\n".repeat(3000),
    ].join("");
    const rand = random(3);
    const lexed = new Lexed("mysql", source(text));
    agrees(lexed, text, "mysql", rand, 20);
    lexed.work(() => false);
    expect(lexed.points.some((p) => p.delimiter === "//")).toBe(true);
    expect(lexed.points.some((p) => !p.fresh)).toBe(true);
    agrees(lexed, text, "mysql", rand, 40);
    const inside = text.indexOf("delimiter x");
    expect(lexed.statementAt(inside).from).toBe(text.indexOf("select\n"));
  });

  it("an unclosed string runs to the end, as the client reads it", () => {
    const text = `${"select 1;\n".repeat(4000)}select 'open\n${"select 2;\n".repeat(4000)}`;
    const lexed = new Lexed("postgresql", source(text));
    const at = text.length - 50;
    const { tokens } = lexed.tokens(at, at + 10);
    expect(tokens.find((t) => t.start <= at && t.end > at)?.type).toBe("string");
  });
});

describe("checkpoints follow random edits", () => {
  for (const dialect of DIALECTS)
    it(`in ${dialect}`, () => {
      const rand = random(DIALECTS.indexOf(dialect) + 31);
      let text = script(rand, 5 * CHUNK);
      let lexed = new Lexed(dialect, source(text));
      lexed.work(() => false);
      for (let step = 0; step < 60; step++) {
        const from = Math.floor(rand() * text.length);
        const to = rand() < 0.5 ? from : Math.min(text.length, from + Math.floor(rand() * 400));
        const insert = rand() < 0.3 ? "" : (PIECES[Math.floor(rand() * PIECES.length)] ?? "");
        text = text.slice(0, from) + insert + text.slice(to);
        lexed = lexed.map(change(from, to, insert), source(text));
        // Some edits are looked at at once, some after a part of the checking.
        if (rand() < 0.5) agrees(lexed, text, dialect, rand, 2);
        if (rand() < 0.3) {
          let budget = Math.floor(rand() * 3);
          lexed.work(() => budget-- <= 0);
        }
      }
      lexed.work(() => false);
      agrees(lexed, text, dialect, rand, 20);
      const fresh = new Lexed(dialect, source(text));
      fresh.work(() => false);
      for (const p of lexed.points) {
        const { tokens } = fresh.tokens(p.pos, p.pos + 1);
        const inside = tokens.find((t) => t.start < p.pos && p.pos < t.end);
        expect(inside === undefined || inside.type === "space", `point at ${p.pos}`).toBe(true);
      }
    });

  it("an edit that changes nothing further on stops checking at the next checkpoint", () => {
    const text = "select a from t where b = 'x';\n".repeat(20000);
    const src = source(text);
    let lexed = new Lexed("postgresql", src);
    lexed.work(() => false);
    const points = lexed.points.length;
    const edited = `${text.slice(0, 100)} ${text.slice(100)}`;
    const after = source(edited);
    lexed = lexed.map(change(100, 100, " "), after);
    lexed.work(() => false);
    expect(lexed.done).toBe(true);
    expect(lexed.points.length).toBe(points);
    expect(after.counted.read).toBeLessThan(4 * CHUNK + 64 * 1024);
  });

  it("a quote opened at the top makes the rest a string, once checked", () => {
    const text = "select 1;\n".repeat(30000);
    let lexed = new Lexed("sqlite", source(text));
    lexed.work(() => false);
    const edited = `'${text}`;
    lexed = lexed.map(change(0, 0, "'"), source(edited));
    lexed.work(() => false);
    const at = edited.length - 5;
    expect(lexed.tokens(at, at + 1).tokens.find((t) => t.end > at)?.type).toBe("string");
  });
});

describe("brackets, quotes and folds come from the tokens", () => {
  const lexedOf = (text: string, dialect: Dialect = "postgresql") =>
    new Lexed(dialect, source(text));

  it("a bracket matches its partner, never one in a string or a comment", () => {
    const text = "select f(a, ')', /* ( */ g(b)) from t;";
    const lexed = lexedOf(text);
    const open = text.indexOf("(");
    const close = text.lastIndexOf(")");
    expect(pairAt(lexed, open)).toEqual({
      start: { from: open, to: open + 1 },
      end: { from: close, to: close + 1 },
    });
    expect(pairAt(lexed, close + 1)?.start).toEqual({ from: open, to: open + 1 });
    expect(pairAt(lexedOf("select (1;"), 7)).toEqual({ start: { from: 7, to: 8 }, end: null });
  });

  it("a string's quotes and a dollar quote's tags match", () => {
    const text = "select E'it''s', $fn$ body $fn$, \"Name\";";
    const lexed = lexedOf(text);
    const e = text.indexOf("E'");
    expect(pairAt(lexed, e + 1)).toEqual({
      start: { from: e + 1, to: e + 2 },
      end: { from: e + 7, to: e + 8 },
    });
    const tag = text.indexOf("$fn$");
    expect(pairAt(lexed, tag)?.end).toEqual({ from: tag + 10, to: tag + 14 });
    const name = text.indexOf('"');
    expect(pairAt(lexed, name)?.end).toEqual({ from: name + 5, to: name + 6 });
    expect(pairAt(lexedOf("select 'open"), 7)).toEqual({ start: { from: 7, to: 8 }, end: null });
  });

  it("statements, block comments, strings and groups over several lines fold", () => {
    const text = [
      "select a,", // 0: a statement to its terminator
      "  b from t;",
      "/* one", // 2: a block comment
      "two */",
      "insert into t values (1);", // 4: one line, nothing
      "select 1; select (", // 5: the second statement
      "  2", //
      ");",
      "select $$a", // 8: the statement, before its string
      "b$$;",
      "select x", // 10: the statement
      "from f(", // 11: a group inside it
      "  1",
      ");",
    ].join("\n");
    const lexed = lexedOf(text);
    const lines = text.split("\n");
    const startOf = (i: number) => lines.slice(0, i).join("\n").length + (i ? 1 : 0);
    const endOf = (i: number) => startOf(i) + (lines[i]?.length ?? 0);
    const folds = foldsIn(lexed, 0, text.length);
    expect(folds.get(startOf(0))).toEqual({ from: endOf(0), to: text.indexOf(";") });
    expect(folds.get(startOf(2))).toEqual({ from: endOf(2), to: text.indexOf("*/") });
    expect(folds.has(startOf(4))).toBe(false);
    expect(folds.get(startOf(5))).toEqual({ from: endOf(5), to: endOf(7) - 1 });
    expect(folds.get(startOf(8))).toEqual({ from: endOf(8), to: endOf(9) - 1 });
    expect(folds.has(startOf(1))).toBe(false);
    expect(folds.get(startOf(10))).toEqual({ from: endOf(10), to: endOf(13) - 1 });
    expect(folds.get(startOf(11))).toEqual({ from: endOf(11), to: startOf(13) });
  });
});
