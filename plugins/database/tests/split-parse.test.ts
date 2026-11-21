// The plugin's splitter (psql's rules, ui/sql/split.js) and PostgreSQL's grammar (ADR 0283) cut the
// plugin's scripts alike: the splitter's own cases, the corpus, and the SQL the plugin writes itself
// (catalog queries, DDL, table pages, edits, imports, EXPLAIN; pg-generated.ts). A script the parser
// cannot read whole is cut by the splitter, so a difference could only show in one that parses;
// DECIDED lists the ones found and what was decided.
import { describe, expect, it } from "vitest";
import { codeOf } from "../ui/sql/parse/parse.js";
import { split } from "../ui/sql/split.js";
import { STATEMENTS } from "./pg-corpus";
import { FIXTURES } from "./pg-generated";
import { loadParse } from "./pg-parser";

/**
 * Differences found and decided: [fixture, statement text, what was decided]. Empty: none was
 * found. A new one fails the test until it is listed here with its decision.
 */
const DECIDED: Array<[string, string, string]> = [];

describe("split and parse", () => {
  it("the splitter and the parser end statements at the same place", async () => {
    const parse = await loadParse();
    const differences: Array<[string, string, string]> = [];
    let read = 0;
    for (const [name, sql] of FIXTURES) {
      const parsed = parse(sql);
      expect([name, parsed.whole, parsed.statements.filter((s) => s.error).length]).toEqual([
        name,
        true,
        0,
      ]);
      const cuts = split(sql, "postgresql")
        .map(codeOf)
        .map((c) => sql.slice(c.start, c.end));
      const reads = parsed.statements.map((s) => sql.slice(s.start.offset, s.end.offset));
      for (const text of reads.filter((t) => !cuts.includes(t)))
        differences.push([name, text, "parser"]);
      for (const text of cuts.filter((t) => !reads.includes(t)))
        differences.push([name, text, "splitter"]);
      if (reads.length !== cuts.length)
        differences.push([name, `${reads.length} / ${cuts.length}`, "count"]);
      read += reads.length;
    }
    expect(read).toBeGreaterThan(STATEMENTS.length + 50);
    expect(differences).toEqual(DECIDED.map(([name, text]) => [name, text, expect.any(String)]));
    expect(FIXTURES.every(([, sql]) => sql.length > 0)).toBe(true);
  });

  it("cuts a script that does not parse where the splitter cuts it", async () => {
    const parse = await loadParse();
    const sql = "select :limit;\nselect * from people where id = ?;\n\\d people\nselect 1";
    const parsed = parse(sql);
    expect(parsed.whole).toBe(false);
    const cuts = split(sql, "postgresql").map(codeOf);
    expect(parsed.statements.map((s) => [s.start.offset, s.end.offset])).toEqual(
      cuts.map((c) => [c.start, c.end]),
    );
    expect(parsed.statements.map((s) => s.error?.message ?? s.kind)).toEqual([
      'syntax error at or near ":"',
      "syntax error at end of input",
      'syntax error at or near "\\"',
    ]);
  });
});
