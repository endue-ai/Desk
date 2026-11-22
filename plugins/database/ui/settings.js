// The plugin's settings, each read through `settings.get` (the core's default < init.yaml < set
// value, ADR 0031) over `init.get`'s for a host that serves no settings.*, then checked: a value of
// the wrong type, out of range or not one of its choices keeps the default, and says why
// (settings-follow.js tells the person once). The `format-*` settings hold Format SQL's style
// (ui/sql/layout/style.js, ADR 0292) and whether Save lays a bound .sql file out first (`format-on-save`).
// The `problems-*` settings say which of the editor's SQL problems and warnings are told (ADR 0294,
// ADR 0328). The `session*` settings bound the PostgreSQL sessions consoles and table views keep
// (PG-02, ADR 0320); `snippets` the person's own completion snippets, name to template
// (editor/snippets.js, ADR 0327).
import { ownSnippets } from "./editor/snippets.js";
import { CHOICES, RANGES, STYLE } from "./sql/layout/style.js";

/**
 * @typedef {{
 *   maxRows: number, timeoutSeconds: number, confirm: boolean, history: boolean, historyMax: number,
 *   systemSchemas: boolean, mysql: string, sqlite3: string, path: string[],
 *   formatKeywordCase: string, formatIndent: number, formatLineWidth: number, formatComma: string,
 *   formatAndOr: string, formatJoins: string, formatOneLine: string, formatLists: string,
 *   formatOnSave: boolean, problemsSyntax: boolean, problemsNames: boolean,
 *   problemsWarnings: boolean, problemsWarningsOff: string[],
 *   pgDump: string, pgRestore: string, sessionsPerConnection: number, sessionIdleMinutes: number,
 *   snippets: Record<string, string>,
 * }} Settings
 */

/** @type {Readonly<Settings>} */
export const DEFAULTS = Object.freeze({
  maxRows: 500,
  timeoutSeconds: 0,
  confirm: true,
  history: true,
  historyMax: 200,
  systemSchemas: false,
  mysql: "",
  sqlite3: "",
  path: [],
  formatKeywordCase: STYLE.keywordCase,
  formatIndent: STYLE.indent,
  formatLineWidth: STYLE.lineWidth,
  formatComma: STYLE.comma,
  formatAndOr: STYLE.andOr,
  formatJoins: STYLE.joins,
  formatOneLine: STYLE.oneLine,
  formatLists: STYLE.lists,
  formatOnSave: false,
  problemsSyntax: true,
  problemsNames: true,
  problemsWarnings: true,
  problemsWarningsOff: [],
  pgDump: "",
  pgRestore: "",
  sessionsPerConnection: 8,
  sessionIdleMinutes: 30,
  snippets: Object.freeze({}),
});

/** The manifest key of each setting, the range of the numbers and the choices of the strings. */
const KEYS =
  /** @type {Record<keyof Settings, { key: string, min?: number, max?: number, choices?: readonly string[] }>} */ ({
    maxRows: { key: "endue.database.max-rows", min: 1, max: 100_000 },
    timeoutSeconds: { key: "endue.database.timeout-seconds", min: 0, max: 86_400 },
    confirm: { key: "endue.database.confirm" },
    history: { key: "endue.database.history" },
    historyMax: { key: "endue.database.history-max", min: 0, max: 1000 },
    systemSchemas: { key: "endue.database.system-schemas" },
    mysql: { key: "endue.database.mysql" },
    sqlite3: { key: "endue.database.sqlite3" },
    path: { key: "endue.database.path" },
    formatKeywordCase: { key: "endue.database.format-keyword-case", choices: CHOICES.keywordCase },
    formatIndent: {
      key: "endue.database.format-indent",
      min: RANGES.indent[0],
      max: RANGES.indent[1],
    },
    formatLineWidth: {
      key: "endue.database.format-line-width",
      min: RANGES.lineWidth[0],
      max: RANGES.lineWidth[1],
    },
    formatComma: { key: "endue.database.format-comma", choices: CHOICES.comma },
    formatAndOr: { key: "endue.database.format-and-or", choices: CHOICES.andOr },
    formatJoins: { key: "endue.database.format-joins", choices: CHOICES.joins },
    formatOneLine: { key: "endue.database.format-one-line", choices: CHOICES.oneLine },
    formatLists: { key: "endue.database.format-lists", choices: CHOICES.lists },
    formatOnSave: { key: "endue.database.format-on-save" },
    problemsSyntax: { key: "endue.database.problems-syntax" },
    problemsNames: { key: "endue.database.problems-names" },
    problemsWarnings: { key: "endue.database.problems-warnings" },
    problemsWarningsOff: { key: "endue.database.problems-warnings-off" },
    pgDump: { key: "endue.database.pg-dump" },
    pgRestore: { key: "endue.database.pg-restore" },
    sessionsPerConnection: { key: "endue.database.sessions-per-connection", min: 1, max: 12 },
    sessionIdleMinutes: { key: "endue.database.session-idle-minutes", min: 0, max: 1440 },
    snippets: { key: "endue.database.snippets" },
  });

/** The setting keys as the manifest declares them, in order. */
export const SETTING_KEYS = Object.values(KEYS).map((entry) => entry.key);

const PREFIX = "endue.database.";

/** A key as the manifest names it: settings.get and settings.changed name it without the prefix. */
export const fullKey = (/** @type {string} */ key) =>
  key.startsWith(PREFIX) ? key : `${PREFIX}${key}`;

/**
 * The values in force by manifest key: each through settings.get, which resolves the default,
 * init.yaml and what the person set; init.get's (init.yaml as in force) under them, for a host that
 * answers settings.get with nothing.
 * @param {Pick<import("@endue-ai/plugin-sdk").PluginBridge, "call">} bridge
 * @returns {Promise<Record<string, unknown>>}
 */
export async function loadValues(bridge) {
  const init = await bridge.call("init.get", {}).catch(() => ({ settings: {} }));
  /** @type {Record<string, unknown>} */
  const values = { ...(init.settings ?? {}) };
  const read = await Promise.all(
    SETTING_KEYS.map((key) =>
      bridge
        .call("settings.get", { key: key.slice(PREFIX.length) })
        .then((answer) => /** @type {{ value?: unknown }} */ (answer))
        .catch(() => ({})),
    ),
  );
  SETTING_KEYS.forEach((key, i) => {
    if (read[i] && "value" in read[i]) values[key] = read[i].value;
  });
  return values;
}

/**
 * @typedef {{ key: string, value: unknown, expected: string, fallback: unknown }} Fallback
 *   A value that failed its check: what it should have been, and the default in force instead.
 */

/**
 * The settings in force from values by manifest key, and every value that fell back.
 * @param {Record<string, unknown>} values
 * @returns {{ settings: Settings, fallbacks: Fallback[] }}
 */
export function checked(values) {
  /** @type {Record<string, unknown>} */
  const settings = { ...DEFAULTS };
  /** @type {Fallback[]} */
  const fallbacks = [];
  for (const [name, { key, min, max, choices }] of Object.entries(KEYS)) {
    if (!(key in values)) continue;
    const value = values[key];
    // The person's snippets keep each entry that is a name and a template (editor/snippets.js).
    if (name === "snippets") {
      settings[name] = ownSnippets(value);
      continue;
    }
    const fallback = /** @type {Record<string, unknown>} */ (DEFAULTS)[name];
    const low = min ?? 0;
    const high = max ?? Number.MAX_SAFE_INTEGER;
    /** @type {[boolean, string]} */
    const [fits, expected] = Array.isArray(fallback)
      ? [
          Array.isArray(value) && value.every((v) => typeof v === "string" && v !== ""),
          "a list of folders",
        ]
      : typeof fallback === "number"
        ? [
            typeof value === "number" && Number.isInteger(value) && value >= low && value <= high,
            `a whole number from ${low} to ${high}`,
          ]
        : choices
          ? [typeof value === "string" && choices.includes(value), `one of ${choices.join(", ")}`]
          : typeof fallback === "boolean"
            ? [typeof value === "boolean", "true or false"]
            : [typeof value === "string", "text"];
    if (fits) settings[name] = value;
    else fallbacks.push({ key, value, expected, fallback });
  }
  return { settings: /** @type {Settings} */ (settings), fallbacks };
}

/**
 * @param {Record<string, unknown>} values
 * @returns {Settings}
 */
export const fromValues = (values) => checked(values).settings;

/** A value as the person wrote it, kept short for the footer. */
const shown = (/** @type {unknown} */ value) => {
  const text = JSON.stringify(value) ?? String(value);
  return text.length > 60 ? `${text.slice(0, 59)}…` : text;
};

/** The sentence that says a value fell back. */
export const fallbackText = (/** @type {Fallback} */ f) =>
  `The setting ${f.key} is ${shown(f.value)}, not ${f.expected}, so its default ${shown(f.fallback)} is in force.`;

/**
 * The sentence for a value the core says fell back (settings.invalid): where it is written, why,
 * and the value in force now.
 * @param {{ key: string, reason: string, file?: string, line?: number }} invalid
 * @param {Settings} settings
 */
export function invalidText(invalid, settings) {
  const key = fullKey(invalid.key);
  const name = Object.entries(KEYS).find(([, entry]) => entry.key === key)?.[0];
  const file = invalid.file?.split(/[\\/]/u).at(-1);
  const where = file ? ` (${file}${invalid.line ? ` line ${invalid.line}` : ""})` : "";
  const now = name ? /** @type {Record<string, unknown>} */ (settings)[name] : undefined;
  const tail = now === undefined ? "" : `, so ${shown(now)} is in force`;
  return `The setting ${key}${where}: ${invalid.reason}${tail}.`;
}

/** The settings whose value differs between two, by name. */
export const changedNames = (/** @type {Settings} */ before, /** @type {Settings} */ after) =>
  /** @type {Array<keyof Settings>} */ (Object.keys(KEYS)).filter(
    (name) => JSON.stringify(before[name]) !== JSON.stringify(after[name]),
  );

/** The style Format SQL lays PostgreSQL out by, from the settings. */
export const formatStyle = (/** @type {Settings} */ settings) =>
  /** @type {import("./sql/layout/style.js").Style} */ ({
    keywordCase: settings.formatKeywordCase,
    indent: settings.formatIndent,
    lineWidth: settings.formatLineWidth,
    comma: settings.formatComma,
    andOr: settings.formatAndOr,
    joins: settings.formatJoins,
    oneLine: settings.formatOneLine,
    lists: settings.formatLists,
  });
