// The restore form (PG-62): what the dump is (pg_restore's header), the connection it goes into (a
// read-only one is marked and holds the button), pg_restore's options as the archive's format
// allows them (if-exists needs clean; a single transaction takes one job and no create), the
// entries filtered and chosen, 200 shown at a time, and the exact command line below. A plain SQL
// file asks only for the connection: it runs as a script in a console. Restore answers with the
// connection, the options and the chosen entries (null: all); Cancel and Escape with nothing.

import { el } from "../../dom.js";
import { formatCount } from "../../format.js";
import { fileName } from "../../platform.js";
import { t } from "../../strings/index.js";
import { commandLine, listPath, restoreArgs, restoreOptions } from "./args.js";

/** @typedef {import("./restore.js").RestoreModel} RestoreModel */

export const SHOWN_MAX = 200;
const FORMAT_NAMES = {
  custom: "Custom archive",
  directory: "Directory archive",
  tar: "Tar archive",
  plain: "Plain SQL file",
};
const CONTENTS = [
  ["all", "Schema and data"],
  ["schema", "Schema only (--schema-only)"],
  ["data", "Data only (--data-only)"],
];

/** The words that find an entry: its kind, schema and name. */
const wordsOf = (/** @type {RestoreModel["entries"][number]} */ e) =>
  `${e.kind} ${e.schema ? `${e.schema}.` : ""}${e.name}`.toLowerCase();

/**
 * @param {Document} doc
 * @param {RestoreModel} model
 * @param {(answer?: unknown) => void} done
 */
export function restoreDialog(doc, model, done) {
  const plain = model.format === "plain";
  const o = model.options;
  const input = (/** @type {Record<string, string>} */ attrs) =>
    /** @type {HTMLInputElement} */ (el(doc, "input", { class: "desk-field", ...attrs }));
  const check = (
    /** @type {string} */ name,
    /** @type {string} */ text,
    /** @type {boolean} */ on,
  ) => {
    const box = /** @type {HTMLInputElement} */ (
      el(doc, "input", { type: "checkbox", class: "desk-check", name })
    );
    box.checked = on;
    return { box, label: el(doc, "label", { class: "check" }, box, ` ${text}`) };
  };
  const select = (
    /** @type {string} */ name,
    /** @type {string[][]} */ items,
    /** @type {string} */ now,
  ) => {
    const node = /** @type {HTMLSelectElement} */ (
      el(doc, "select", { class: "desk-field", name })
    );
    for (const [value, text, off] of items) {
      const item = /** @type {HTMLOptionElement} */ (
        el(doc, "option", { value: value ?? "" }, text ?? "")
      );
      item.selected = value === now;
      if (off) item.disabled = true;
      node.append(item);
    }
    return node;
  };
  const labelled = (
    /** @type {string} */ text,
    /** @type {HTMLElement} */ control,
    /** @type {string} */ part,
  ) => el(doc, "label", { "data-part": part }, el(doc, "span", {}, text), control);

  const target = select(
    "connection",
    model.connections.map((c) => [
      c.id,
      `${c.name}${c.tag !== "none" ? ` · ${c.tag}` : ""}${c.readOnly ? " (read-only)" : ""}`,
    ]),
    model.connection,
  );
  const clean = check("clean", "Clean: drop each object before making it (--clean)", o.clean);
  const ifExists = check("ifExists", "Only those that exist (--if-exists)", o.ifExists);
  const create = check(
    "create",
    `Create the database ${model.database || "the dump was made from"} (--create)`,
    o.create,
  );
  const content = select("content", CONTENTS, o.content);
  const noOwner = check("noOwner", "No owner (--no-owner)", o.noOwner);
  const noPrivileges = check("noPrivileges", "No privileges (--no-privileges)", o.noPrivileges);
  const jobs = input({ name: "jobs", type: "number", min: "1", max: "32" });
  jobs.value = String(o.jobs);
  const jobsRow = labelled("Jobs", jobs, "jobs");
  const single = check(
    "singleTransaction",
    "In a single transaction (--single-transaction)",
    o.singleTransaction,
  );

  const chosen = new Set(model.entries.map((e) => e.id));
  const words = model.entries.map(wordsOf);
  const filter = input({
    name: "filter",
    type: "search",
    placeholder: t("features.backup.restoreForm.ordersTableData"),
    "aria-label": t("features.backup.restoreForm.findEntries"),
  });
  const count = el(doc, "span", { class: "hint", "data-part": "count" });
  const list = el(doc, "div", {
    class: "restore-entries",
    "data-part": "entries",
    role: "group",
    "aria-label": t("features.backup.restoreForm.entries"),
  });
  const button = (/** @type {string} */ text, /** @type {boolean} */ on) => {
    const node = el(
      doc,
      "button",
      { type: "button", class: "desk-btn desk-btn-quiet", "data-ctl": on ? "all" : "none" },
      text,
    );
    node.addEventListener("click", () => {
      for (const i of matching()) {
        const id = model.entries[i]?.id;
        if (id === undefined) continue;
        if (on) chosen.add(id);
        else chosen.delete(id);
      }
      drawEntries();
      follow();
    });
    return node;
  };
  const matching = () => {
    const needle = filter.value.trim().toLowerCase();
    return words.flatMap((w, i) => (!needle || w.includes(needle) ? [i] : []));
  };
  const drawEntries = () => {
    const found = matching();
    const rows = found.slice(0, SHOWN_MAX).map((i) => {
      const entry = model.entries[i];
      if (!entry) return el(doc, "span");
      const box = /** @type {HTMLInputElement} */ (
        el(doc, "input", { type: "checkbox", class: "desk-check", value: String(entry.id) })
      );
      box.checked = chosen.has(entry.id);
      box.addEventListener("change", () => {
        if (box.checked) chosen.add(entry.id);
        else chosen.delete(entry.id);
        follow();
      });
      return el(
        doc,
        "label",
        { class: "check restore-entry" },
        box,
        el(doc, "span", { class: "restore-kind" }, entry.kind),
        ` ${entry.schema ? `${entry.schema}.` : ""}${entry.name}`,
      );
    });
    const more =
      found.length > SHOWN_MAX
        ? el(
            doc,
            "p",
            { class: "hint" },
            t("features.backup.restoreForm.moreMatchNarrowTheSearchTo", {
              value: String(formatCount(found.length - SHOWN_MAX)),
            }),
          )
        : undefined;
    list.replaceChildren(...rows, ...(more ? [more] : []));
  };
  filter.addEventListener("input", (event) => {
    event.stopPropagation();
    drawEntries();
  });

  const command = el(doc, "pre", {
    class: "backup-command",
    "data-part": "command",
    "aria-label": t("features.backup.restoreForm.commandLine"),
  });
  const problem = el(doc, "p", { class: "backup-problem", role: "alert" });
  const submit = /** @type {HTMLButtonElement} */ (
    el(
      doc,
      "button",
      { type: "submit", class: "desk-btn desk-btn-primary" },
      plain
        ? t("features.backup.restoreForm.runTheScript")
        : t("features.backup.restoreForm.restore"),
    )
  );
  const cancel = el(
    doc,
    "button",
    { type: "button", class: "desk-btn desk-btn-quiet" },
    t("features.backup.restoreForm.cancel"),
  );
  cancel.addEventListener("click", () => done());

  const raw = () => ({
    clean: clean.box.checked,
    ifExists: ifExists.box.checked,
    create: create.box.checked,
    content: content.value,
    noOwner: noOwner.box.checked,
    noPrivileges: noPrivileges.box.checked,
    jobs: jobs.value,
    singleTransaction: single.box.checked,
  });
  const answer = () => ({
    connection: target.value,
    options: raw(),
    chosen:
      chosen.size === model.entries.length
        ? null
        : model.entries.filter((e) => chosen.has(e.id)).map((e) => e.id),
  });
  const follow = () => {
    const into = model.connections.find((c) => c.id === target.value);
    ifExists.box.disabled = !clean.box.checked;
    jobsRow.hidden = model.format === "tar";
    count.textContent = t("features.backup.restoreForm.ofEntries", {
      value: String(formatCount(chosen.size)),
      value2: String(formatCount(model.entries.length)),
    });
    try {
      if (!into) throw new Error(t("features.backup.restoreForm.chooseTheConnectionToRestoreInto"));
      if (into.readOnly)
        throw new Error(
          t("features.backup.restoreForm.isReadOnlyNothingIsRestored", { name: String(into.name) }),
        );
      if (plain) {
        command.textContent = t("features.backup.restoreForm.databaseRunASqlFileOn", {
          file: String(model.file),
          name: String(into.name),
        });
      } else {
        if (chosen.size === 0)
          throw new Error(t("features.backup.restoreForm.chooseAnEntryToRestore"));
        const options = restoreOptions(raw(), /** @type {"custom"} */ (model.format));
        const some = chosen.size < model.entries.length;
        const argv = restoreArgs(options, {
          path: model.file,
          database: into.database,
          ...(some ? { list: listPath(into.id) } : {}),
        });
        command.textContent = commandLine(
          model.program.command,
          argv,
          into.env,
          model.program.platform,
        );
      }
      problem.textContent = "";
      submit.disabled = false;
    } catch (error) {
      problem.textContent = error instanceof Error ? error.message : String(error);
      submit.disabled = true;
    }
  };

  const about = plain
    ? t("features.backup.restoreForm.aPlainSqlFileItRuns")
    : t("features.backup.restoreForm.ofMadeByPgDumpFrom", {
        value: String(FORMAT_NAMES[model.format] ?? t("features.backup.restoreForm.archive")),
        value2: String(model.database || t("features.backup.restoreForm.aDatabase")),
        value3: String(model.by || "?"),
        value4: String(model.from || "?"),
        value5: String(formatCount(model.entries.length)),
      });
  const options = plain
    ? []
    : [
        el(doc, "p", { class: "backup-checks" }, clean.label, ifExists.label, create.label),
        labelled("Content", content, "content"),
        el(doc, "p", { class: "backup-checks" }, noOwner.label, noPrivileges.label, single.label),
        jobsRow,
        el(
          doc,
          "fieldset",
          { class: "restore-pick" },
          el(doc, "legend", {}, t("features.backup.restoreForm.entries")),
          el(
            doc,
            "p",
            { class: "restore-tools" },
            filter,
            button("All", true),
            button("None", false),
            count,
          ),
          list,
        ),
      ];
  const form = /** @type {HTMLFormElement} */ (
    el(
      doc,
      "form",
      { class: "dialog wide backup-form restore-form", "aria-labelledby": "restore-title" },
      el(
        doc,
        "h2",
        { id: "restore-title" },
        t("features.backup.restoreForm.restore2", { value: String(fileName(model.file)) }),
      ),
      el(doc, "p", { class: "hint" }, about),
      labelled("Into", target, "into"),
      ...options,
      command,
      problem,
      el(doc, "p", { class: "buttons" }, cancel, submit),
    )
  );
  form.addEventListener("input", follow);
  form.addEventListener("change", follow);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    follow();
    if (!submit.disabled) done(answer());
  });
  drawEntries();
  follow();
  return form;
}
