// What each operation's dialog asks (PG-52): its fields (a new name, a schema, an owner, a comment,
// a trigger's state) filled from what was read or what a command was given, its choices (CASCADE,
// RESTART IDENTITY, CONCURRENTLY, WITH NO DATA) never on unless given, what depends on the object,
// and the notes that say what the statement does beyond its words. The dialog writes the script
// from the same model (statements.js), so it is data only. Pure.

import { t } from "../../strings/index.js";
import { ENGINE_NAMES, OPS, said } from "./kinds.js";

/**
 * @typedef {import("../../engines/common.js").Connection} Connection
 * @typedef {import("./kinds.js").Target} Target
 * @typedef {import("./sql-postgres.js").AnyOp} AnyOp
 * @typedef {import("./sql-postgres.js").Facts} Facts
 * @typedef {{ name: string, label: string, kind: "text" | "select" | "textarea", value: string, options?: string[], list?: string[], hint?: string }} Field
 * @typedef {{ name: string, label: string, hint: string, checked: boolean, disabled?: boolean }} Choice
 * @typedef {{
 *   engine: import("../../engines/common.js").EngineId, op: AnyOp, target: Target, facts: Facts,
 *   title: string, where: string, tag: string, fields: Field[], choices: Choice[],
 *   dependents: Facts["dependents"] | null, notes: string[], run: string, danger: boolean,
 * }} OperationModel
 */

/** The dialog type every operation asks with. */
export const DIALOG = "object-operation";

const ENABLED = { O: "enabled", D: "disabled", R: "enabled on replicas only", A: "always enabled" };
/** The dialog's button, by operation. */
const RUN = {
  rename: "Rename",
  move: "Move",
  owner: "Change owner",
  comment: "Save comment",
  drop: "Drop",
  truncate: "Truncate",
  refresh: "Refresh",
  enable: "Apply",
  apply: "Apply",
};
const yes = (/** @type {unknown} */ value) => value === true || value === "true";

/** A routine's own name, without its arguments. */
const ownName = (/** @type {Target} */ target, /** @type {Facts} */ facts) =>
  facts.routine?.name ?? target.name.replace(/\(.*$/su, "");

/**
 * @param {Connection} conn
 * @param {AnyOp} op
 * @param {Target} target
 * @param {Facts} facts
 * @param {Record<string, unknown>} given A command's arguments, which fill the fields.
 * @param {string[]} [schemas] Where an object can move to.
 * @returns {OperationModel}
 */
export function modelOf(conn, op, target, facts, given, schemas = []) {
  const pg = conn.engine === "postgresql";
  const text = (/** @type {string} */ key) =>
    typeof given[key] === "string" ? /** @type {string} */ (given[key]) : undefined;
  const object = said(conn.engine, target);
  const verb = op === "apply" ? "Apply the source of" : OPS[op].label.replace(/…$/u, "");
  /** @type {Field[]} */
  const fields = [];
  /** @type {Choice[]} */
  const choices = [];
  /** @type {string[]} */
  const notes = [];
  if (op === "rename") {
    fields.push({
      name: "to",
      label: t("features.objects.models.newName"),
      kind: "text",
      value: text("to") ?? ownName(target, facts),
      hint: t("features.objects.models.writtenAsTypedInQuotesIts"),
    });
    if (pg && (target.kind === "table" || target.kind === "view"))
      notes.push(t("features.objects.models.viewsAndKeysFollowItA"));
  }
  if (op === "move") {
    const options = schemas.filter((s) => s !== target.schema);
    fields.push({
      name: "to",
      label:
        conn.engine === "mysql"
          ? t("features.objects.models.database")
          : t("features.objects.models.schema"),
      kind: "select",
      value: text("to") ?? options[0] ?? "",
      options,
    });
  }
  if (op === "owner") {
    fields.push({
      name: "to",
      label: t("features.objects.models.newOwner"),
      kind: "text",
      value: text("to") ?? "",
      list: facts.roles ?? [],
    });
    if (facts.owner)
      notes.push(t("features.objects.models.ownsItNow", { owner: String(facts.owner) }));
  }
  if (op === "comment")
    fields.push({
      name: "comment",
      label: t("features.objects.models.comment"),
      kind: "textarea",
      value: text("comment") ?? facts.comment ?? "",
      hint:
        conn.engine === "mysql"
          ? t("features.objects.models.emptyLeavesNoComment")
          : t("features.objects.models.emptyRemovesTheComment"),
    });
  if (op === "drop") dropParts(conn, target, facts, given, choices, notes);
  if (op === "truncate") truncateParts(conn, facts, given, choices, notes);
  if (op === "refresh") {
    const can = facts.populated !== false && facts.unique === true;
    choices.push({
      name: "concurrently",
      label: t("features.objects.models.concurrently"),
      hint: can
        ? t("features.objects.models.readsGoOnWhileItRefreshes")
        : t("features.objects.models.needsDataAndAUniqueIndex"),
      checked: can && given.concurrently !== false,
      disabled: !can,
    });
    choices.push({
      name: "nodata",
      label: t("features.objects.models.withNoData"),
      hint: t("features.objects.models.emptiesItItCannotBeRead"),
      checked: yes(given.withNoData),
    });
  }
  if (op === "enable") {
    const now = facts.enabled ?? "O";
    const wanted = typeof given.enabled === "boolean" ? given.enabled : now === "D";
    fields.push({
      name: "state",
      label: t("features.objects.models.trigger"),
      kind: "select",
      value: wanted ? "enable" : "disable",
      options: ["enable", "disable"],
    });
    notes.push(
      t("features.objects.models.itIsNow", {
        value: String(
          ENABLED[/** @type {keyof typeof ENABLED} */ (now)] ??
            t("features.objects.models.enabled"),
        ),
      }),
    );
  }
  if (op === "apply") notes.push(...applyNotes(conn, target));
  return {
    engine: conn.engine,
    op,
    target,
    facts,
    title: `${verb} ${object}`,
    where: `${conn.name} · ${ENGINE_NAMES[conn.engine]}`,
    tag: conn.tag === "none" ? "" : conn.tag,
    fields,
    choices,
    dependents: facts.dependents ?? null,
    notes,
    run: /** @type {Record<string, string>} */ (RUN)[op] ?? "Run",
    danger: op === "drop" || op === "truncate",
  };
}

/** A drop's CASCADE (PostgreSQL's) and what the engine cannot say. */
function dropParts(
  /** @type {Connection} */ conn,
  /** @type {Target} */ target,
  /** @type {Facts} */ facts,
  /** @type {Record<string, unknown>} */ given,
  /** @type {Choice[]} */ choices,
  /** @type {string[]} */ notes,
) {
  if (conn.engine !== "postgresql") {
    notes.push(
      t("features.objects.models.keepsNoListOfWhatDepends", {
        value: String(ENGINE_NAMES[conn.engine]),
      }),
    );
    return;
  }
  const blocking = facts.dependents?.blocking.length ?? 0;
  choices.push({
    name: "cascade",
    label: t("features.objects.models.cascade"),
    hint: blocking
      ? blocking === 1
        ? t("features.objects.models.alsoDropsTheObjectThatDepends")
        : t("features.objects.models.alsoDropsTheObjectsThatDepend", { blocking: String(blocking) })
      : t("features.objects.models.nothingDependsOnItNowCascade"),
    checked: yes(given.cascade),
  });
  if (blocking) notes.push(t("features.objects.models.withoutCascadeTheServerRefusesWhile"));
  if (target.kind === "schema")
    notes.push(t("features.objects.models.cascadeDropsEveryObjectInThe"));
}

/** A truncate's options, with the row estimate and the tables its foreign keys meet. */
function truncateParts(
  /** @type {Connection} */ conn,
  /** @type {Facts} */ facts,
  /** @type {Record<string, unknown>} */ given,
  /** @type {Choice[]} */ choices,
  /** @type {string[]} */ notes,
) {
  const rows = facts.rows;
  if (typeof rows === "number")
    notes.push(
      t("features.objects.models.aboutRowsTheServerSEstimate", {
        value: String(rows.toLocaleString("en-US")),
      }),
    );
  else if (conn.engine === "postgresql")
    notes.push(t("features.objects.models.theServerHasNoEstimateOf"));
  if (conn.engine === "sqlite") {
    notes.push(t("features.objects.models.sqliteHasNoTruncateDeleteFrom"));
    return;
  }
  if (conn.engine === "mysql") {
    notes.push(t("features.objects.models.mysqlCommitsATruncateAtOnce"));
    return;
  }
  const sequences = facts.sequences ?? [];
  choices.push({
    name: "restart",
    label: t("features.objects.models.restartIdentity"),
    hint: sequences.length
      ? t("features.objects.models.startsAgain", { value: String(sequences.join(", ")) })
      : t("features.objects.models.itOwnsNoSequenceNothingStarts"),
    checked: yes(given.restartIdentity),
  });
  const referencing = facts.referencing ?? [];
  choices.push({
    name: "cascade",
    label: t("features.objects.models.cascade"),
    hint: referencing.length
      ? t("features.objects.models.alsoEmptiesWhoseForeignKeysPoint", {
          value: String(referencing.join(", ")),
        })
      : t("features.objects.models.noOtherTableSForeignKey"),
    checked: yes(given.cascade),
  });
  if (referencing.length)
    notes.push(t("features.objects.models.withoutCascadeTheServerRefusesOther"));
  notes.push(t("features.objects.models.onDeleteTriggersDoNotFire"));
}

/** What applying a source does beyond its text. */
function applyNotes(/** @type {Connection} */ conn, /** @type {Target} */ target) {
  if (conn.engine === "sqlite") return [t("features.objects.models.sqliteHasNoCreateOrReplace")];
  if (conn.engine === "mysql") return [t("features.objects.models.mysqlCommitsDdlAtOnceIt")];
  if (target.kind === "materialized view")
    return [
      t("features.objects.models.aMaterializedViewHasNoCreate"),
      t("features.objects.models.itsGrantsAreNotKeptGrant"),
    ];
  if (target.kind === "view")
    return [
      "CREATE OR REPLACE keeps its grants; it can add columns at the end, not drop or rename them.",
    ];
  return ["CREATE OR REPLACE keeps its grants; other arguments make another routine."];
}
