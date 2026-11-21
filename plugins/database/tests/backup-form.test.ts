// @vitest-environment jsdom
// The backup and restore forms and the log panel on jsdom (PG-62): fields that follow the format,
// the command line that follows every change, what cannot be said under it holding the button, the
// entries filtered and chosen, and the log drawn in place.
import { describe, expect, it } from "vitest";
import { DUMP_DEFAULTS, RESTORE_DEFAULTS } from "../ui/features/backup/args.js";
import type { BackupModel } from "../ui/features/backup/backup.js";
import { backupDialog } from "../ui/features/backup/backup-form.js";
import { logState } from "../ui/features/backup/job.js";
import { logPanel } from "../ui/features/backup/log-panel.js";
import type { RestoreModel } from "../ui/features/backup/restore.js";
import { restoreDialog, SHOWN_MAX } from "../ui/features/backup/restore-form.js";
import { parseToc } from "../ui/features/backup/toc.js";
import { FIXTURE_TOC } from "./backup-fixture";

const ENV = { PGHOST: "db.example", PGDATABASE: "warehouse", PGUSER: "app" };
const backupModel = (fields: Partial<BackupModel> = {}): BackupModel => ({
  connection: "warehouse",
  database: "warehouse",
  tag: "none",
  server: "PostgreSQL 17",
  program: { command: "pg_dump", version: "17.6" },
  schemas: ["public", "sales"],
  path: "",
  env: ENV,
  password: "No password given: libpq reads ~/.pgpass, else the server must not ask for one.",
  options: { ...DUMP_DEFAULTS },
  ...fields,
});
const toc = parseToc(FIXTURE_TOC);
const restoreModel = (fields: Partial<RestoreModel> = {}): RestoreModel => ({
  file: "~/Backups/warehouse.dump",
  format: "custom",
  database: "warehouse",
  from: "17.6",
  by: "17.6",
  program: { command: "pg_restore", version: "17.6" },
  connections: [
    {
      id: "c-wh",
      name: "warehouse",
      tag: "none",
      readOnly: false,
      database: "warehouse",
      env: ENV,
    },
    { id: "c-ro", name: "locked", tag: "none", readOnly: true, database: "warehouse", env: ENV },
  ],
  connection: "c-wh",
  entries: toc.entries.map(({ line: _line, ...e }) => e),
  options: { ...RESTORE_DEFAULTS },
  ...fields,
});

function shown<T>(
  render: (doc: Document, model: T, done: (answer?: unknown) => void) => HTMLElement,
  model: T,
) {
  const answers: unknown[] = [];
  const form = render(document, model, (answer) => answers.push(answer));
  document.body.replaceChildren(form);
  const $ = <E extends Element = HTMLInputElement>(selector: string) =>
    form.querySelector(selector) as E;
  const set = (selector: string, value: string | boolean) => {
    const node = $(selector);
    if (typeof value === "boolean") node.checked = value;
    else node.value = value;
    node.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const visible = (part: string) => !$<HTMLElement>(`[data-part="${part}"]`).closest("[hidden]");
  const submit = () => form.dispatchEvent(new Event("submit", { cancelable: true }));
  return {
    form,
    $,
    set,
    visible,
    submit,
    answers,
    command: () => $<HTMLElement>('[data-part="command"]').textContent,
  };
}

describe("the backup form", () => {
  it("the backup form's fields follow the format (jobs for directory, compression for custom and directory, INSERTs for plain) and its command line follows every change", () => {
    const f = shown(backupDialog, backupModel());
    expect(f.command()).toBe(
      "PGHOST=db.example PGDATABASE=warehouse PGUSER=app pg_dump --format=custom --verbose --no-password --file=(chosen next)",
    );
    expect([f.visible("compression"), f.visible("jobs")]).toEqual([true, false]);
    expect(f.$("[name=inserts]").closest("[hidden]")).not.toBeNull();
    f.set("[name=format]", "directory");
    f.set("[name=jobs]", "4");
    expect([f.visible("compression"), f.visible("jobs")]).toEqual([true, true]);
    expect(f.command()).toContain(
      "--format=directory --verbose --no-password --jobs=4 --file=(chosen next)",
    );
    f.set("[name=format]", "plain");
    expect([f.visible("compression"), f.visible("jobs")]).toEqual([false, false]);
    expect(f.$("[name=inserts]").closest("[hidden]")).toBeNull();
    expect(f.$("[name=inserts]").checked).toBe(true);
    expect(f.command()).toContain("--format=plain --verbose --no-password --inserts");
    f.set("[name=format]", "custom");
    f.set("[name=scope][value=schemas]", true);
    expect(f.visible("schemas")).toBe(true);
    // No schema chosen yet: said under the form, and the button waits.
    expect(f.$<HTMLElement>(".backup-problem").textContent).toBe("Choose a schema to back up.");
    expect(f.$<HTMLButtonElement>("[type=submit]").disabled).toBe(true);
    f.set("[name=schema][type=checkbox]", true);
    f.set("[name=content]", "schema");
    f.set("[name=noPrivileges]", true);
    f.set("[name=method]", "gzip");
    f.set("[name=level]", "9");
    expect(f.command()).toContain(
      `'--schema="public"' --strict-names --schema-only --no-privileges --compress=gzip:9`,
    );
    f.submit();
    expect(f.answers[0]).toMatchObject({
      format: "custom",
      scope: "schemas",
      schemas: ["public"],
      content: "schema",
      method: "gzip",
      level: "9",
    });
  });

  it("names where it writes when a path came with the request, and keeps lz4 and zstd for pg_dump 16 and later", () => {
    const f = shown(
      backupDialog,
      backupModel({ path: "~/Backups/w.dump", program: { command: "pg_dump", version: "15.8" } }),
    );
    expect(f.command()).toMatch(/--file=\.\/Backups\/w\.dump$/u);
    expect(f.$<HTMLButtonElement>("[type=submit]").textContent).toBe("Back up");
    const methods = [...f.$<HTMLSelectElement>("[name=method]").options]
      .filter((o) => o.disabled)
      .map((o) => o.value);
    expect(methods).toEqual(["lz4", "zstd"]);
  });
});

describe("the restore form", () => {
  it("the restore form: if-exists needs clean, jobs and single transaction exclude each other, entries filtered and chosen, read-only connections marked", () => {
    const f = shown(restoreDialog, restoreModel());
    expect(f.command()).toBe(
      "PGHOST=db.example PGDATABASE=warehouse PGUSER=app pg_restore --verbose --no-password --dbname=warehouse ./Backups/warehouse.dump",
    );
    expect(f.$("[name=ifExists]").disabled).toBe(true);
    f.set("[name=clean]", true);
    expect(f.$("[name=ifExists]").disabled).toBe(false);
    f.set("[name=ifExists]", true);
    f.set("[name=jobs]", "2");
    f.set("[name=singleTransaction]", true);
    expect(f.$<HTMLElement>(".backup-problem").textContent).toBe(
      "A single transaction runs in one job: set jobs to 1, or leave it off.",
    );
    f.set("[name=jobs]", "1");
    expect(f.command()).toContain(
      "--clean --if-exists --single-transaction ./Backups/warehouse.dump",
    );
    // Entries: found by kind or name, chosen in bulk, counted.
    expect(f.$<HTMLElement>('[data-part="count"]').textContent).toBe("9 of 9 entries");
    f.$("[name=filter]").value = "table data";
    f.$("[name=filter]").dispatchEvent(new Event("input", { bubbles: true }));
    expect(f.form.querySelectorAll(".restore-entry")).toHaveLength(3);
    f.$<HTMLButtonElement>('[data-ctl="none"]').click();
    expect(f.$<HTMLElement>('[data-part="count"]').textContent).toBe("6 of 9 entries");
    expect(f.command()).toContain("--use-list=./.endue/database/restore/c-wh.list");
    f.submit();
    expect(f.answers[0]).toEqual({
      connection: "c-wh",
      options: expect.objectContaining({ clean: true, ifExists: true, singleTransaction: true }),
      chosen: [6, 218, 219, 220, 3440, 3284],
    });
    // A read-only connection is marked and holds the button.
    f.set("[name=connection]", "c-ro");
    expect(f.$<HTMLSelectElement>("[name=connection]").selectedOptions[0]?.textContent).toBe(
      "locked (read-only)",
    );
    expect(f.$<HTMLElement>(".backup-problem").textContent).toBe(
      "locked is read-only: nothing is restored into it.",
    );
    expect(f.$<HTMLButtonElement>("[type=submit]").disabled).toBe(true);
  });

  it("shows at most 200 entries at a time, and a plain SQL file asks only where it runs", () => {
    const many = Array.from({ length: SHOWN_MAX + 50 }, (_, i) => ({
      id: i + 1,
      kind: "TABLE",
      schema: "public",
      name: `t${i}`,
      owner: "app",
    }));
    const f = shown(restoreDialog, restoreModel({ entries: many }));
    expect(f.form.querySelectorAll(".restore-entry")).toHaveLength(SHOWN_MAX);
    expect(f.form.querySelector(".restore-entries .hint")?.textContent).toBe(
      "50 more match: narrow the search to see them.",
    );
    const plain = shown(restoreDialog, restoreModel({ format: "plain", entries: [] }));
    expect(plain.form.querySelector("[name=clean]")).toBeNull();
    expect(plain.command()).toBe(
      "Database: run a .sql file · ~/Backups/warehouse.dump on warehouse",
    );
    expect(plain.$<HTMLButtonElement>("[type=submit]").textContent).toBe("Run the script");
  });
});

describe("the log panel", () => {
  it("draws the command, the lines and the result in place, with Cancel while it runs", () => {
    const acted: unknown[][] = [];
    const first = logState(
      {
        kind: "backup",
        title: "Back up warehouse to w.dump",
        command: "pg_dump --format=custom",
        password: "No password given.",
        noun: "tables",
      },
      0,
    );
    const panel = logPanel(document, first, (...args) => acted.push(args), { id: "b-1" });
    document.body.replaceChildren(panel.el);
    const text = (s: string) => panel.el.querySelector(s)?.textContent;
    expect(text(".backup-status")).toBe("Running · 0 tables");
    (panel.el.querySelector('[data-ctl="cancel"]') as HTMLButtonElement).click();
    expect(acted).toEqual([["backupCancel", "b-1"]]);
    panel.update({
      ...first,
      lines: ["pg_dump: reading schemas"],
      dropped: 4,
      done: 2,
      status: "done",
      result: "Wrote it.",
    });
    expect(text('[data-part="log"]')).toBe("… 4 earlier lines not kept\npg_dump: reading schemas");
    expect(text(".backup-status")).toBe("Done · 2 tables");
    expect(text('[data-part="result"]')).toBe("Wrote it.");
    expect((panel.el.querySelector('[data-ctl="cancel"]') as HTMLElement).hidden).toBe(true);
    panel.update({ ...first, status: "failed", result: "pg_dump failed: no." });
    expect(panel.el.querySelector('[data-part="result"]')?.getAttribute("role")).toBe("alert");
  });
});
