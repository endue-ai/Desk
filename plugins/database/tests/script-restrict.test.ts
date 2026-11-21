// A plain dump of pg_dump 17.6 and later runs as a script (PG-62 on PG-24): its \restrict and
// \unrestrict guard lines, which only stop psql's meta-commands, are read as blanks of their length,
// so the statements around them run and every line and offset stays where it was. Any other
// backslash line is left for run-file to refuse as before.
import { describe, expect, it } from "vitest";
import { createScriptReader, unguarded } from "../ui/features/consoles/script-parts.js";

// pg_dump writes a random word of letters and digits after the command; a plain one stands in.
const WORD = "a1b2".repeat(16);
const DUMP = [
  "--",
  "-- PostgreSQL database dump",
  "--",
  "",
  `\\restrict ${WORD}`,
  "",
  "SET statement_timeout = 0;",
  "SELECT pg_catalog.set_config('search_path', '', false);",
  "INSERT INTO public.t VALUES (1, 'a\\restrict b');",
  "",
  "--",
  "-- PostgreSQL database dump complete",
  "--",
  "",
  `\\unrestrict ${WORD}`,
  "",
].join("\n");

/** The script read in pieces of `size` characters, as run-file reads ranges. */
function read(text: string, size: number) {
  const reader = createScriptReader("postgresql");
  const out = [];
  for (let at = 0; at < text.length; at += size)
    out.push(...reader.push(text.slice(at, at + size)));
  return [...out, ...reader.end()];
}

describe("pg_dump's guard lines", () => {
  it("pg_dump's \\restrict and \\unrestrict lines are read as comments, so a plain dump of pg_dump 17.6 or later runs as a script; any other backslash line is left as it is", () => {
    for (const size of [DUMP.length, 7, 64]) {
      const statements = read(DUMP, size);
      const texts = statements.map((s) => s.text.trim());
      expect(texts.some((t) => /^\\(?:un)?restrict /mu.test(t))).toBe(false);
      expect(texts.at(-1)).toBe("INSERT INTO public.t VALUES (1, 'a\\restrict b')");
      expect(statements.map((s) => s.line)).toEqual([1, 8, 9]);
      expect(statements[0]?.text.endsWith("SET statement_timeout = 0")).toBe(true);
    }
    // Offsets are kept: the blanks are as long as the lines.
    expect(unguarded(DUMP, true)).toHaveLength(DUMP.length);
    expect(unguarded("\\restrict abc", true)).toBe(" ".repeat(13));
    expect(unguarded("\\restrict abc", false)).toBe("\\restrict abc");
    expect(unguarded("\\connect other\nSELECT 1;\n", true)).toBe("\\connect other\nSELECT 1;\n");
    expect(unguarded("\\restrict bad key!\n", true)).toBe("\\restrict bad key!\n");
  });

  it("leaves MySQL's and SQLite's scripts as they are", () => {
    const reader = createScriptReader("sqlite");
    const [first] = [...reader.push(`\\restrict ${WORD}\nselect 1;\nselect 2;`), ...reader.end()];
    expect(first?.text).toContain("\\restrict");
  });
});
