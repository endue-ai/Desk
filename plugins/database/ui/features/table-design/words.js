// What the table form's script says about its dangerous steps (PG-51): each a `-- ` line above its
// statement, part of the script that runs and that opens in a console. Pure.

export const MARKS = {
  rewrite: "Rewrites the whole table: reads and writes wait until it ends.",
  notNull: "Reads every row while reads and writes wait, and fails if one holds NULL.",
  check: "Reads every row while reads and writes wait, and fails if one breaks it.",
  foreign: "Reads every row while writes to both tables wait, and fails if one has no match.",
  primary: "Builds a unique index while writes wait, and fails on a duplicate or a NULL.",
  unique: "Builds a unique index while writes wait, and fails on a duplicate.",
  index: "Builds while writes to the table wait (reads go on).",
  concurrently:
    "CONCURRENTLY: runs after the transaction, on its own, while writes go on; if it fails, an invalid index is left to drop.",
  volatile:
    "A volatile default (random(), clock_timestamp() ...) rewrites the whole table; a constant or stable one does not.",
  newNotNull: "Fails if the table has rows: a new NOT NULL column needs a default for them.",
  identity:
    "Its sequence starts at 1: when the column holds values, set it past them after (ALTER COLUMN ... RESTART WITH).",
  partitioned:
    "Rows go into its partitions: create them after, each with CREATE TABLE ... PARTITION OF.",
};

/** A dropped column's mark. */
export const dropsColumn = (/** @type {string} */ name) =>
  `Drops column ${name} and its data for good.`;

/** A type change's mark. */
export const converts = (/** @type {string[]} */ names) =>
  `Fails if a value of ${names.join(", ")} does not convert to its new type.`;

/** Why a type change is not written as it would need to be. */
export const needsUsing = (
  /** @type {string} */ column,
  /** @type {string} */ from,
  /** @type {string} */ to,
) =>
  `PostgreSQL has no automatic cast from ${from} to ${to} for column ${column}, so the change needs USING, which the form does not write: open the script in a console and add USING with an expression, or keep the type.`;
