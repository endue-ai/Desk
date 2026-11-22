// What the comparison's script says about its destructive and risky steps (PG-53), each a `-- ` line
// above its statement as the table form's are (features/table-design/words.js), and what it will not
// write. Pure.

export const DROPS = {
  table: (/** @type {string} */ n) => `Drops table ${n} and its rows for good.`,
  view: (/** @type {string} */ n) => `Drops view ${n}; anything built on it must go first.`,
  "materialized view": (/** @type {string} */ n) =>
    `Drops materialized view ${n} and the rows it holds.`,
  sequence: (/** @type {string} */ n) => `Drops sequence ${n} and where it stands for good.`,
  function: (/** @type {string} */ n) => `Drops ${n}; anything that calls it fails after.`,
  type: (/** @type {string} */ n) => `Drops type ${n}; a column of it must go first.`,
  trigger: (/** @type {string} */ n) => `Drops trigger ${n}: what it did stops.`,
};

export const MARKS = {
  replaceView: "Fails if the view's columns change other than added at the end.",
  replaceFunction: "Fails if what it returns changes: drop it first in a console then.",
  refresh: "Built again: its query runs now and fills it, which can take long.",
  enumValue: "A new enum value: usable after this transaction commits.",
  sequence: "Changes the sequence's parameters; the value it stands at stays.",
};

export const HELD = {
  enumRemoved: (/** @type {string} */ n, /** @type {string[]} */ values) =>
    `Type ${n} loses ${values.join(", ")}: PostgreSQL cannot drop an enum's value. Write it in a console (a new type, the columns moved to it).`,
  type: (/** @type {string} */ n) =>
    `Type ${n} changed: a domain or composite type is not altered by the script. Write it in a console.`,
  unread: (/** @type {string} */ n, /** @type {string} */ why) =>
    `${n} is not changed by the script: ${why}`,
  partition: (/** @type {string} */ n) =>
    `Table ${n} is partitioned another way: PostgreSQL changes that only by a new table.`,
};
