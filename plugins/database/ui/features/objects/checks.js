import { t } from "../../strings/index.js";

// What the dialogs' answers must be before a statement is written from them (PG-52): a new name
// that is there, changed and short enough for the engine, a choice of two that cannot go together.
// A refusal is an Error whose words the dialog shows in place of the script. Pure.

/** The longest name each engine keeps: PostgreSQL's 63 bytes, MySQL's 64 characters. */
const LIMITS = {
  postgresql: { max: 63, bytes: true },
  mysql: { max: 64, bytes: false },
  sqlite: { max: Number.POSITIVE_INFINITY, bytes: false },
};

/**
 * A new name as typed (never trimmed: it is written quoted, spaces and case kept), refused when
 * empty, unchanged or longer than the engine keeps.
 * @param {import("../../engines/common.js").EngineId} engine
 * @param {string | undefined} value
 * @param {string} current
 * @param {string} [what] "name", "schema", "owner" ...
 */
export function newName(engine, value, current, what = "name") {
  const name = value ?? "";
  if (name.trim() === "")
    throw new Error(t("features.objects.checks.typeTheNew", { what: String(what) }));
  if (name === current)
    throw new Error(t("features.objects.checks.thatIsItsNowTypeAnother", { what: String(what) }));
  const limit = LIMITS[engine];
  const size = limit.bytes ? new TextEncoder().encode(name).length : [...name].length;
  if (size > limit.max)
    throw new Error(
      t("features.objects.checks.keepsANameOfAtMost", {
        value: String(
          engine === "mysql"
            ? t("features.objects.checks.mysql")
            : t("features.objects.checks.postgresql"),
        ),
        max: String(limit.max),
        value2: String(
          limit.bytes
            ? t("features.objects.checks.bytes")
            : t("features.objects.checks.characters"),
        ),
        size: String(size),
      }),
    );
  return name;
}

/** The answers a dialog gave: its fields' values and the choices turned on. */
export function answersOf(/** @type {unknown} */ given) {
  const answers = /** @type {{ values?: unknown, choices?: unknown }} */ (given ?? {});
  const values = /** @type {Record<string, string>} */ ({});
  if (answers.values && typeof answers.values === "object")
    for (const [key, value] of Object.entries(answers.values))
      if (typeof value === "string") values[key] = value;
  const choices = Array.isArray(answers.choices)
    ? answers.choices.filter((c) => typeof c === "string")
    : [];
  return { values, choices: /** @type {string[]} */ (choices) };
}
