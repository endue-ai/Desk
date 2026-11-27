import { t } from "../../strings/index.js";
// What the comparison's script says about its destructive and risky steps (PG-53), each a `-- ` line
// above its statement as the table form's are (features/table-design/words.js), and what it will not
// write. Pure.

export const DROPS = {
  table: (/** @type {string} */ n) =>
    t("features.compareSchema.words.dropsTableAndItsRowsFor", { n: String(n) }),
  view: (/** @type {string} */ n) =>
    t("features.compareSchema.words.dropsViewAnythingBuiltOnIt", { n: String(n) }),
  "materialized view": (/** @type {string} */ n) =>
    t("features.compareSchema.words.dropsMaterializedViewAndTheRows", { n: String(n) }),
  sequence: (/** @type {string} */ n) =>
    t("features.compareSchema.words.dropsSequenceAndWhereItStands", { n: String(n) }),
  function: (/** @type {string} */ n) =>
    t("features.compareSchema.words.dropsAnythingThatCallsItFails", { n: String(n) }),
  type: (/** @type {string} */ n) =>
    t("features.compareSchema.words.dropsTypeAColumnOfIt", { n: String(n) }),
  trigger: (/** @type {string} */ n) =>
    t("features.compareSchema.words.dropsTriggerWhatItDidStops", { n: String(n) }),
};

export const MARKS = {
  replaceView: t("features.compareSchema.words.failsIfTheViewSColumns"),
  replaceFunction: t("features.compareSchema.words.failsIfWhatItReturnsChanges"),
  refresh: t("features.compareSchema.words.builtAgainItsQueryRunsNow"),
  enumValue: t("features.compareSchema.words.aNewEnumValueUsableAfter"),
  sequence: t("features.compareSchema.words.changesTheSequenceSParametersThe"),
};

export const HELD = {
  enumRemoved: (/** @type {string} */ n, /** @type {string[]} */ values) =>
    t("features.compareSchema.words.typeLosesPostgresqlCannotDropAn", {
      n: String(n),
      value: String(values.join(", ")),
    }),
  type: (/** @type {string} */ n) =>
    t("features.compareSchema.words.typeChangedADomainOrComposite", { n: String(n) }),
  unread: (/** @type {string} */ n, /** @type {string} */ why) =>
    `${n} is not changed by the script: ${why}`,
  partition: (/** @type {string} */ n) =>
    t("features.compareSchema.words.tableIsPartitionedAnotherWayPostgresql", { n: String(n) }),
};
