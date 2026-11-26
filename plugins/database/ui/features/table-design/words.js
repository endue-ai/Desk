import { t } from "../../strings/index.js";
// What the table form's script says about its dangerous steps (PG-51): each a `-- ` line above its
// statement, part of the script that runs and that opens in a console. Pure.

export const MARKS = {
  rewrite: t("features.tableDesign.words.rewritesTheWholeTableReadsAnd"),
  notNull: t("features.tableDesign.words.readsEveryRowWhileReadsAnd"),
  check: t("features.tableDesign.words.readsEveryRowWhileReadsAnd2"),
  foreign: t("features.tableDesign.words.readsEveryRowWhileWritesTo"),
  primary: t("features.tableDesign.words.buildsAUniqueIndexWhileWrites"),
  unique: t("features.tableDesign.words.buildsAUniqueIndexWhileWrites2"),
  index: t("features.tableDesign.words.buildsWhileWritesToTheTable"),
  concurrently: t("features.tableDesign.words.concurrentlyRunsAfterTheTransactionOn"),
  volatile: t("features.tableDesign.words.aVolatileDefaultRandomClockTimestamp"),
  newNotNull: t("features.tableDesign.words.failsIfTheTableHasRows"),
  identity: t("features.tableDesign.words.itsSequenceStartsAtWhenThe"),
  partitioned: t("features.tableDesign.words.rowsGoIntoItsPartitionsCreate"),
};

/** A dropped column's mark. */
export const dropsColumn = (/** @type {string} */ name) =>
  t("features.tableDesign.words.dropsColumnAndItsDataFor", { name: String(name) });

/** A type change's mark. */
export const converts = (/** @type {string[]} */ names) =>
  t("features.tableDesign.words.failsIfAValueOfDoes", { value: String(names.join(", ")) });

/** Why a type change is not written as it would need to be. */
export const needsUsing = (
  /** @type {string} */ column,
  /** @type {string} */ from,
  /** @type {string} */ to,
) =>
  t("features.tableDesign.words.postgresqlHasNoAutomaticCastFrom", {
    from: String(from),
    to: String(to),
    column: String(column),
  });
