// The backup form (PG-62): the format, what to back up (the whole database, schemas the server has,
// or tables by name), schema or data only, the owner and privilege switches, compression (custom
// and directory), jobs (directory) and INSERT statements (plain), with the exact command line it
// makes below, the password left out. A choice that cannot be is said under it and holds the
// button. Back up answers with the options; Cancel and Escape with nothing (view-dialog.js).

import { el } from "../../dom.js";
import { t as messageText } from "../../strings/index.js";
import { commandLine, dumpArgs, dumpOptions, majorOf } from "./args.js";

/** @typedef {import("./backup.js").BackupModel} BackupModel */

const FORMATS = [
  ["custom", "Custom archive", "One file pg_restore reads, compressed"],
  ["directory", "Directory", "A folder, a file per table; several jobs at once"],
  ["tar", "Tar archive", "One file pg_restore reads, not compressed"],
  ["plain", "Plain SQL", "A script that runs in a console"],
];
const CONTENTS = [
  ["all", "Schema and data"],
  ["schema", "Schema only (--schema-only)"],
  ["data", "Data only (--data-only)"],
];
const METHOD_LABELS = {
  default: messageText("features.backup.backupForm.pgDumpSDefault"),
  none: messageText("features.backup.backupForm.none"),
  gzip: messageText("features.backup.backupForm.gzip"),
  lz4: messageText("features.backup.backupForm.lz4"),
  zstd: messageText("features.backup.backupForm.zstd"),
};

/**
 * @param {Document} doc
 * @param {BackupModel} model
 * @param {(answer?: unknown) => void} done
 */
export function backupDialog(doc, model, done) {
  const major = majorOf(model.program.version);
  const o = model.options;
  const field = (
    /** @type {string} */ tag,
    /** @type {Record<string, string | boolean | undefined>} */ attrs,
    /** @type {(Node | string)[]} */ ...kids
  ) => /** @type {HTMLInputElement & HTMLSelectElement} */ (el(doc, tag, attrs, ...kids));
  const check = (
    /** @type {string} */ name,
    /** @type {string} */ text,
    /** @type {boolean} */ on,
  ) => {
    const box = field("input", { type: "checkbox", class: "desk-check", name });
    box.checked = on;
    return { box, label: el(doc, "label", { class: "check" }, box, ` ${text}`) };
  };
  const option = (
    /** @type {string} */ value,
    /** @type {string} */ text,
    /** @type {string} */ now,
  ) => {
    const node = /** @type {HTMLOptionElement} */ (el(doc, "option", { value }, text));
    node.selected = value === now;
    return node;
  };
  const labelled = (
    /** @type {string} */ text,
    /** @type {HTMLElement} */ control,
    /** @type {string} */ part,
  ) => el(doc, "label", { "data-part": part }, el(doc, "span", {}, text), control);

  const format = field(
    "select",
    { class: "desk-field", name: "format" },
    ...FORMATS.map(([v, t]) => option(v ?? "", t ?? "", o.format)),
  );
  const formatHint = el(doc, "p", { class: "hint backup-format-hint" });
  const scopes = /** @type {const} */ (["database", "schemas", "tables"]).map((value) => {
    const radio = field("input", { type: "radio", class: "desk-check", name: "scope", value });
    radio.checked = o.scope === value;
    const text = { database: "Whole database", schemas: "Schemas", tables: "Tables" }[value];
    if (value === "schemas" && model.schemas.length === 0) radio.disabled = true;
    return { radio, label: el(doc, "label", { class: "check" }, radio, ` ${text}`) };
  });
  const schemaBoxes = model.schemas.map((name) => check("schema", name, o.schemas.includes(name)));
  const schemaList = el(
    doc,
    "fieldset",
    { class: "backup-schemas", "data-part": "schemas" },
    el(doc, "legend", { class: "sr-only" }, messageText("features.backup.backupForm.schemas")),
    ...schemaBoxes.map((b) => b.label),
  );
  const tables = field("input", {
    class: "desk-field",
    name: "tables",
    placeholder: messageText("features.backup.backupForm.publicOrdersSales"),
    "aria-label": messageText("features.backup.backupForm.tables"),
  });
  tables.value = o.tables.join(", ");
  const tablesRow = el(
    doc,
    "p",
    { class: "backup-tables", "data-part": "tables" },
    tables,
    el(
      doc,
      "span",
      { class: "hint" },
      messageText("features.backup.backupForm.namesOrPatternsByCommasMatches"),
    ),
  );
  const content = field(
    "select",
    { class: "desk-field", name: "content" },
    ...CONTENTS.map(([v, t]) => option(v ?? "", t ?? "", o.content)),
  );
  const noOwner = check("noOwner", "No owner (--no-owner)", o.noOwner);
  const noPrivileges = check("noPrivileges", "No privileges (--no-privileges)", o.noPrivileges);
  const method = field(
    "select",
    { class: "desk-field", name: "method" },
    ...Object.entries(METHOD_LABELS).map(([v, t]) => option(v, t, o.method)),
  );
  for (const node of method.options)
    if ((node.value === "lz4" || node.value === "zstd") && major < 16) node.disabled = true;
  const level = field("input", {
    class: "desk-field",
    name: "level",
    type: "number",
    min: "1",
    max: "22",
    placeholder: messageText("features.backup.backupForm.default"),
    "aria-label": messageText("features.backup.backupForm.level"),
  });
  level.value = o.level === null ? "" : String(o.level);
  const compression = el(
    doc,
    "label",
    { "data-part": "compression" },
    el(doc, "span", {}, messageText("features.backup.backupForm.compression")),
    el(doc, "span", { class: "backup-pair" }, method, level),
  );
  const jobs = field("input", {
    class: "desk-field",
    name: "jobs",
    type: "number",
    min: "1",
    max: "32",
  });
  jobs.value = String(o.jobs);
  const jobsRow = labelled("Jobs", jobs, "jobs");
  const inserts = check(
    "inserts",
    "Rows as INSERT statements, so the desk can run the file back (--inserts)",
    o.inserts || o.format !== "plain",
  );
  const command = el(doc, "pre", {
    class: "backup-command",
    "data-part": "command",
    "aria-label": messageText("features.backup.backupForm.commandLine"),
  });
  const problem = el(doc, "p", { class: "backup-problem", role: "alert" });
  const submit = field(
    "button",
    { type: "submit", class: "desk-btn desk-btn-primary" },
    model.path ? "Back up" : "Choose where and back up",
  );
  const cancel = el(
    doc,
    "button",
    { type: "button", class: "desk-btn desk-btn-quiet" },
    messageText("features.backup.backupForm.cancel"),
  );
  cancel.addEventListener("click", () => done());

  /** What the fields say now, as a command's arguments would. */
  const read = () => ({
    format: format.value,
    scope: scopes.find((s) => s.radio.checked)?.radio.value ?? "database",
    schemas: model.schemas.filter((_, i) => schemaBoxes[i]?.box.checked),
    tables: tables.value,
    content: content.value,
    noOwner: noOwner.box.checked,
    noPrivileges: noPrivileges.box.checked,
    method: method.value,
    level: level.value,
    jobs: jobs.value,
    inserts: inserts.box.checked,
  });
  const follow = () => {
    const raw = read();
    const archive = raw.format === "custom" || raw.format === "directory";
    compression.hidden = !archive;
    level.disabled = !["gzip", "lz4", "zstd"].includes(raw.method);
    jobsRow.hidden = raw.format !== "directory";
    inserts.label.hidden = raw.format !== "plain";
    schemaList.hidden = raw.scope !== "schemas";
    tablesRow.hidden = raw.scope !== "tables";
    formatHint.textContent = FORMATS.find(([v]) => v === raw.format)?.[2] ?? "";
    try {
      const options = dumpOptions(raw, major);
      const argv = dumpArgs(options, model.path || "~/chosen", major);
      const target = model.path ? argv : [...argv.slice(0, -1)];
      const line = commandLine(model.program.command, target, model.env, model.program.platform);
      command.textContent = model.path
        ? line
        : messageText("features.backup.backupForm.fileChosenNext", { line: String(line) });
      problem.textContent = "";
      submit.disabled = false;
    } catch (error) {
      problem.textContent = error instanceof Error ? error.message : String(error);
      submit.disabled = true;
    }
  };

  const title = messageText("features.backup.backupForm.backUp", {
    connection: String(model.connection),
  });
  const form = /** @type {HTMLFormElement} */ (
    el(
      doc,
      "form",
      { class: "dialog wide backup-form", "aria-labelledby": "backup-title" },
      el(doc, "h2", { id: "backup-title" }, title),
      el(
        doc,
        "p",
        { class: "hint" },
        `${model.database || "The connection's database"} · ${model.server} · ${model.program.command} ${model.program.version}${model.tag === "production" ? " · production" : ""}`,
      ),
      labelled("Format", format, "format"),
      formatHint,
      el(
        doc,
        "fieldset",
        { class: "backup-scope", "data-part": "scope" },
        el(doc, "legend", {}, messageText("features.backup.backupForm.what")),
        ...scopes.map((s) => s.label),
      ),
      schemaList,
      tablesRow,
      labelled("Content", content, "content"),
      el(doc, "p", { class: "backup-checks" }, noOwner.label, noPrivileges.label),
      compression,
      jobsRow,
      inserts.label,
      el(
        doc,
        "p",
        { class: "hint" },
        model.path
          ? messageText("features.backup.backupForm.into", { path: String(model.path) })
          : messageText("features.backup.backupForm.youChooseTheFileOrFolder"),
      ),
      command,
      el(doc, "p", { class: "hint" }, model.password),
      problem,
      el(doc, "p", { class: "buttons" }, cancel, submit),
    )
  );
  form.addEventListener("input", follow);
  form.addEventListener("change", follow);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    follow();
    if (!submit.disabled) done(read());
  });
  follow();
  return form;
}
