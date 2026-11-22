// @vitest-environment jsdom
// The import wizard's COPY part on the page (PG-60): shown only on PostgreSQL, the reading options
// and the run's choices handed back as importChange, a new table's columns as a name and a type per
// file column, the server's check, and the progress in rows and bytes whose Cancel stops the run.
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import type { ImportModel } from "../ui/importer.js";
import { t } from "../ui/strings/index.js";
import { createImportView } from "../ui/view-import.js";

const html = readFileSync("plugins/database/ui/index.html", "utf8");
const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

beforeEach(() => {
  document.body.innerHTML = new DOMParser().parseFromString(html, "text/html").body.innerHTML;
});

const COPY: NonNullable<ImportModel["copy"]> = {
  format: "csv",
  options: {
    encoding: "utf-8",
    delimiter: ",",
    quote: '"',
    escape: '"',
    nullText: "",
    trim: false,
    skip: 0,
    dateOrder: "",
  },
  target: "new",
  newTable: "sales",
  newColumns: [
    { name: "id", type: "integer" },
    { name: "name", type: "text" },
  ],
  onError: "stop",
  batch: 0,
  size: 3 * 1024 * 1024,
  progress: null,
  server: null,
  checking: false,
};

const model = (over: Partial<ImportModel> = {}): ImportModel => ({
  file: "sales.csv",
  format: "csv",
  header: true,
  emptyNull: true,
  connection: "c-pg",
  connections: [{ id: "c-pg", name: "Shop" }],
  schema: "public",
  schemas: ["public"],
  table: "",
  tables: [],
  columns: [],
  fileColumns: ["ID", "Name"],
  examples: ["1", "Ann"],
  mapping: [null, null],
  rows: 2,
  preview: { columns: ["id", "name"], rows: [["1", "Ann"]] },
  statements: 0,
  sql: 'COPY "public"."sales" ("id", "name") FROM STDIN',
  problem: "",
  running: false,
  copy: COPY,
  ...over,
});

function mounted() {
  const acts: unknown[][] = [];
  const view = createImportView(document, (...args) => void acts.push(args));
  return { view, acts };
}

const change = (id: string, value: string | boolean) => {
  const node = byId<HTMLInputElement>(id);
  if (typeof value === "boolean") node.checked = value;
  else node.value = value;
  node.dispatchEvent(new Event("change", { bubbles: true }));
};

describe("the import wizard's COPY part", () => {
  it("shows the options on PostgreSQL and hides them for another engine", () => {
    const { view } = mounted();
    view.render(model());
    expect(byId("import-copy").hidden).toBe(false);
    expect(byId<HTMLInputElement>("i-target-new").checked).toBe(true);
    expect(byId<HTMLInputElement>("i-new-table").value).toBe("sales");
    expect(byId("import-file").textContent).toBe(
      "CSV, 3 MiB, 2 columns; the first 2 rows are shown.",
    );
    expect(byId("import-summary").textContent).toMatch(
      /^The whole file goes in by COPY, in one transaction/u,
    );
    const names = [...byId("import-map").querySelectorAll<HTMLInputElement>("input")].map(
      (i) => i.value,
    );
    expect(names).toEqual(["id", "integer", "name", "text"]);
    view.render(model({ copy: undefined }));
    expect(byId("import-copy").hidden).toBe(true);
    expect(byId("import-checks").hidden).toBe(true);
  });

  it("hands the options, the target and the new columns back as importChange", () => {
    const { view, acts } = mounted();
    view.render(model());
    change("i-delimiter", "\\t");
    change("i-null", "NULL");
    change("i-skip", "2");
    change("i-dates", "DMY");
    change("i-trim", true);
    change("i-on-error", "skip");
    change("i-batch", "5000");
    change("i-target-existing", true);
    const type = byId("import-map").querySelector<HTMLInputElement>('input[data-part="type"]');
    if (!type) throw new Error("no type field");
    type.value = "bigint";
    type.dispatchEvent(new Event("change", { bubbles: true }));
    expect(acts).toEqual([
      ["importChange", { options: { delimiter: "\t" } }],
      ["importChange", { options: { nullText: "NULL" } }],
      ["importChange", { options: { skip: "2" } }],
      ["importChange", { options: { dateOrder: "DMY" } }],
      ["importChange", { options: { trim: true } }],
      ["importChange", { onError: "skip" }],
      ["importChange", { batch: 5000 }],
      ["importChange", { target: "existing" }],
      ["importChange", { column: [0, { type: "bigint" }] }],
    ]);
  });

  it("checks on the server and shows what it read, or its error", () => {
    const { view, acts } = mounted();
    view.render(model());
    byId("import-check").click();
    expect(acts).toEqual([["importCheck"]]);
    view.render(model({ copy: { ...COPY, server: { columns: ["id"], rows: [["1"], [null]] } } }));
    expect(byId("import-server-box").hidden).toBe(false);
    expect(byId("import-server").textContent).toBe("id1NULL");
    view.render(model({ copy: { ...COPY, server: { error: "invalid input syntax" } } }));
    expect(byId("import-server-box").hidden).toBe(true);
    expect(byId("import-server-error").textContent).toBe(
      t("copyImport.server", { error: "invalid input syntax" }),
    );
    // The server's words stay its own, marked as such (PG-108).
    const said = byId("import-server-error").querySelector<HTMLElement>("[data-words=server]");
    expect(said?.textContent).toBe("invalid input syntax");
    expect(said?.getAttribute("translate")).toBe("no");
  });

  it("shows the progress in rows and bytes, and its Cancel stops the run", () => {
    const { view, acts } = mounted();
    view.render(
      model({
        running: true,
        copy: { ...COPY, progress: { rows: 12345, bytes: 1024 * 1024, total: 3 * 1024 * 1024 } },
      }),
    );
    const bar = byId("import-progress");
    expect(bar.hidden).toBe(false);
    expect(bar.getAttribute("detail")).toBe(
      t("copyImport.read", {
        rows: 12345,
        bytes: "1 MiB",
        total: t("copyImport.readOf", { total: "3 MiB" }),
      }),
    );
    expect(bar.getAttribute("value")).toBe(String(1024 * 1024));
    expect(byId<HTMLInputElement>("i-delimiter").disabled).toBe(true);
    bar.dispatchEvent(new Event("desk-cancel"));
    expect(acts).toEqual([["importCancel"]]);
  });
});
