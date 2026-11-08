// The words the editor knows: keywords it highlights and completes, the reserved ones the formatter
// writes in capitals (only those, so a table called `user` or `name` keeps its spelling), and the
// common functions of each dialect.

/** @typedef {import("../sql/lexer.js").Dialect} Dialect */

/** Reserved words of the three dialects that are never an unquoted name. */
export const RESERVED = new Set(
  (
    "ALL AND ANY AS ASC BETWEEN BY CASE CHECK COLLATE CONSTRAINT CREATE CROSS DEFAULT DELETE DESC " +
    "DISTINCT DROP ELSE END EXCEPT EXISTS FALSE FETCH FOR FOREIGN FROM FULL GRANT GROUP HAVING IN " +
    "INNER INSERT INTERSECT INTO IS JOIN LEFT LIKE LIMIT NOT NULL OFFSET ON OR ORDER OUTER PRIMARY " +
    "REFERENCES RETURNING RIGHT SELECT SET THEN TRUE UNION UNIQUE UPDATE USING VALUES WHEN WHERE WITH"
  ).split(" "),
);

/** Words above that MySQL does not reserve, so an unquoted table there may be called one. */
const MYSQL_FREE = new Set(["ANY", "END", "FULL", "OFFSET", "RETURNING"]);
/** More words MySQL reserves. */
const MYSQL_RESERVED =
  "ADD ALTER CALL COLUMN CONVERT DATABASE DESCRIBE DIV EXPLAIN FUNCTION IF IGNORE INDEX INTERVAL " +
  "KEY LOCK MOD PROCEDURE REGEXP RENAME REPLACE SCHEMA SHOW TABLE TO TRIGGER UNLOCK USE XOR";

/**
 * The words the formatter writes in capitals. PostgreSQL folds an unquoted name to lower case and
 * SQLite ignores its case, so there every keyword can be; MySQL's table names keep their case on
 * Linux, so there only words it reserves, which no unquoted name can be.
 */
export function reservedOf(/** @type {Dialect} */ dialect) {
  if (dialect !== "mysql") return keywordsOf(dialect);
  return new Set([
    ...[...RESERVED].filter((w) => !MYSQL_FREE.has(w)),
    ...MYSQL_RESERVED.split(" "),
  ]);
}

/** Keywords for highlighting and completion, beyond the reserved ones. */
const COMMON =
  "ADD ALTER ANALYZE ARRAY ASYMMETRIC ATOMIC BEGIN BIGINT BOOLEAN CASCADE CAST CHAR COLUMN COMMIT " +
  "CONFLICT CURRENT_DATE CURRENT_TIME CURRENT_TIMESTAMP DATABASE DATE DECIMAL DECLARE DO EACH " +
  "EXPLAIN FILTER FIRST FLOAT FOLLOWING FUNCTION IF IGNORE ILIKE INDEX INT INTEGER INTERVAL KEY " +
  "LAST LATERAL MATERIALIZED NATURAL NO NOTHING NULLS NUMERIC OVER PARTITION PRECEDING PROCEDURE " +
  "RANGE RECURSIVE RELEASE RENAME REPLACE RESTRICT RETURN RETURNS ROLLBACK ROW ROWS SAVEPOINT " +
  "SCHEMA SEQUENCE SHOW SIMILAR SMALLINT START TABLE TEMP TEMPORARY TEXT TIME TIMESTAMP TO " +
  "TRANSACTION TRIGGER TRUNCATE UNBOUNDED VARCHAR VIEW WINDOW WITHOUT";

const DIALECT = {
  postgresql:
    "BYTEA CONCURRENTLY COPY DOMAIN EXTENSION JSONB JSON OWNER REFRESH SERIAL BIGSERIAL TABLESPACE " +
    "UUID VACUUM VERBOSE ONLY",
  mysql:
    "AUTO_INCREMENT CHARSET DELIMITER DESCRIBE DUPLICATE ENGINE ENUM FORCE LOCK LONGTEXT " +
    "MEDIUMTEXT STRAIGHT_JOIN TINYINT UNSIGNED USE ZEROFILL",
  sqlite:
    "ABORT AUTOINCREMENT CONFLICT FAIL GLOB INDEXED PRAGMA RAISE REINDEX ROWID STRICT VACUUM " +
    "WITHOUT",
};

const FUNCTIONS = {
  common:
    "abs avg coalesce count lower max min nullif round sum upper length replace substr trim " +
    "ltrim rtrim",
  postgresql:
    "now array_agg string_agg jsonb_build_object json_agg to_char date_trunc extract " +
    "generate_series greatest least concat format regexp_replace split_part unnest age " +
    "row_number rank dense_rank lag lead",
  mysql:
    "now concat concat_ws date_format group_concat ifnull json_extract json_object greatest " +
    "least str_to_date timestampdiff row_number rank dense_rank lag lead",
  sqlite:
    "datetime date time strftime ifnull iif instr json_extract json_object group_concat " +
    "printf random total typeof unixepoch",
};

/** @type {Map<Dialect, Set<string>>} */
const keywordSets = new Map();

/** Every keyword of a dialect, in capitals. */
export function keywordsOf(/** @type {Dialect} */ dialect) {
  let set = keywordSets.get(dialect);
  if (!set) {
    set = new Set([...RESERVED, ...COMMON.split(" "), ...DIALECT[dialect].split(" ")]);
    keywordSets.set(dialect, set);
  }
  return set;
}

/** The common functions of a dialect, in lower case. */
export function functionsOf(/** @type {Dialect} */ dialect) {
  return [...new Set([...FUNCTIONS.common.split(" "), ...FUNCTIONS[dialect].split(" ")])].sort();
}
