import { t } from "../../strings/index.js";

// What `pg_restore --list` says of an archive: its header (format, the database it was made from,
// the server's and pg_dump's versions) and its entries, one a line, `<id>; <table oid> <oid> <kind>
// <schema or -> <name> <owner>`. A kind may hold spaces (TABLE DATA, FK CONSTRAINT), so the known
// kinds are matched longest first. The chosen entries go back to pg_restore as a list file
// (`--use-list`): the archive's own lines, in its order, the others left out. Pure.

/**
 * @typedef {{ id: number, kind: string, schema: string, name: string, owner: string, line: string }} Entry
 * @typedef {{
 *   format: "custom" | "directory" | "tar" | "", database: string, from: string, by: string,
 *   entries: Entry[],
 * }} Toc
 */

// biome-ignore format: one line of PostgreSQL's entry kinds, longest matched first
const KINDS = ["ACCESS METHOD", "AGGREGATE", "BLOB", "BLOB METADATA", "BLOBS", "CAST", "CHECK CONSTRAINT", "COLLATION", "COMMENT", "CONSTRAINT", "CONVERSION", "DATABASE", "DATABASE PROPERTIES", "DEFAULT", "DEFAULT ACL", "DOMAIN", "EVENT TRIGGER", "EXTENSION", "FK CONSTRAINT", "FOREIGN DATA WRAPPER", "FOREIGN SERVER", "FOREIGN TABLE", "FUNCTION", "INDEX", "INDEX ATTACH", "LARGE OBJECT", "MATERIALIZED VIEW", "MATERIALIZED VIEW DATA", "OPERATOR", "OPERATOR CLASS", "OPERATOR FAMILY", "POLICY", "PROCEDURAL LANGUAGE", "PROCEDURE", "PUBLICATION", "PUBLICATION TABLE", "PUBLICATION TABLES IN SCHEMA", "ROW SECURITY", "RULE", "SCHEMA", "SECURITY LABEL", "SEQUENCE", "SEQUENCE OWNED BY", "SEQUENCE SET", "SERVER", "SHELL TYPE", "STATISTICS", "STATISTICS DATA", "SUBSCRIPTION", "SUBSCRIPTION TABLE", "TABLE", "TABLE ATTACH", "TABLE DATA", "TEXT SEARCH CONFIGURATION", "TEXT SEARCH DICTIONARY", "TEXT SEARCH PARSER", "TEXT SEARCH TEMPLATE", "TRANSFORM", "TRIGGER", "TYPE", "USER MAPPING", "VIEW", "ACL"]
  .sort((a, b) => b.length - a.length);

const ENTRY = /^(\d+); \d+ \d+ (.+)$/u;
const HEADER = {
  format: /^;\s+Format: (\w+)/u,
  database: /^;\s+dbname: (.*)$/u,
  from: /^;\s+Dumped from database version: (\S+)/u,
  by: /^;\s+Dumped by pg_dump version: (\S+)/u,
};

/** One entry line's parts; a line that is not an entry is undefined. */
export function entryOf(/** @type {string} */ line) {
  const match = ENTRY.exec(line);
  if (!match) return undefined;
  const rest = match[2] ?? "";
  const kind =
    KINDS.find((k) => rest === k || rest.startsWith(`${k} `)) ?? rest.split(" ")[0] ?? "";
  const words = rest.slice(kind.length).trim().split(" ");
  const schema = words.length > 1 ? (words.shift() ?? "") : "";
  const owner = words.length > 1 ? (words.pop() ?? "") : "";
  /** @type {Entry} */
  const entry = {
    id: Number(match[1]),
    kind,
    schema: schema === "-" ? "" : schema,
    name: words.join(" "),
    owner,
    line,
  };
  return entry;
}

/** @returns {Toc} */
export function parseToc(/** @type {string} */ text) {
  /** @type {Toc} */
  const toc = { format: "", database: "", from: "", by: "", entries: [] };
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\r$/u, "");
    if (line.startsWith(";")) {
      for (const [key, pattern] of Object.entries(HEADER)) {
        const found = pattern.exec(line);
        if (found && !toc[/** @type {"format"} */ (key)])
          Object.assign(toc, { [key]: key === "format" ? found[1]?.toLowerCase() : found[1] });
      }
      continue;
    }
    const entry = entryOf(line);
    if (entry) toc.entries.push(entry);
  }
  if (!["custom", "directory", "tar"].includes(toc.format)) toc.format = "";
  return toc;
}

/** The list file of the chosen entries, in the archive's order. */
export function listFile(/** @type {Entry[]} */ entries, /** @type {Iterable<number>} */ chosen) {
  const wanted = new Set(chosen);
  const lines = entries.filter((e) => wanted.has(e.id)).map((e) => e.line);
  return `; Chosen in endue: ${lines.length} of ${entries.length} entries\n${lines.join("\n")}\n`;
}

/** Whether pg_restore said the file is a plain SQL dump, which it does not read. */
export const isPlain = (/** @type {string} */ stderr) =>
  /appears to be a text format dump/u.test(stderr);

/** pg_restore's or pg_dump's own words for what went wrong: its error lines, else its last line. */
export function errorWords(/** @type {string} */ stderr, /** @type {string} */ program) {
  const lines = stderr.split("\n").map((l) => l.trim());
  const errors = lines.filter(
    (l) => l.startsWith(`${program}: error:`) || /^(?:FATAL|ERROR):/u.test(l),
  );
  const said = errors.length ? errors : lines.filter(Boolean).slice(-1);
  return said
    .map((l) =>
      l.replace(new RegExp(t("features.backup.toc.error", { program: String(program) }), "u"), ""),
    )
    .join(" ");
}
