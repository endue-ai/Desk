// @vitest-environment jsdom
// What the page says where the real-app check found it wrong (#564): the work pane names the
// connection the explorer's cursor is in instead of asking to pick one, and the TLS choice of a
// PostgreSQL connection says what the desk's own sessions do by default.
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import type { Node } from "../ui/explorer.js";
import { createView } from "../ui/view.js";
import { SAVED } from "./harness";

const html = readFileSync("plugins/database/ui/index.html", "utf8");
const byId = (id: string) => document.getElementById(id) as HTMLElement;
const PICK = "Pick a connection on the left, or add one with New.";

const row = (kind: Node["kind"], label: string, level: number, connection: string): Node => ({
  key: `${connection}/${label}`,
  kind,
  label,
  detail: "",
  level,
  expandable: kind !== "table",
  expanded: kind !== "table",
  connection,
});

beforeEach(() => {
  // jsdom lays nothing out; the console's editor asks a range for its boxes.
  Range.prototype.getClientRects = (() => []) as never;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  document.body.innerHTML = new DOMParser().parseFromString(html, "text/html").body.innerHTML;
});

describe("the work pane with nothing open", () => {
  it("names the connection the explorer's cursor is in", () => {
    const view = createView(document, () => undefined);
    view.console(null, null);
    view.explorer([]);
    expect(byId("empty").textContent).toBe(PICK);
    view.explorer([
      row("connection", "fixture", 1, "c-1"),
      row("schema", "main", 2, "c-1"),
      row("table", "people", 3, "c-1"),
      row("connection", "warehouse", 1, "c-2"),
    ]);
    expect(byId("empty").hidden).toBe(false);
    expect(byId("empty").textContent).toBe(
      "No console is open on fixture: Enter or a double click on it opens one.",
    );
    // The cursor moves to the other connection: the pane follows it.
    const tree = byId("tree");
    const items = tree.querySelectorAll<HTMLElement>("[role=treeitem]");
    items[3]?.click();
    expect(byId("empty").textContent).toBe(
      "No console is open on warehouse: Enter or a double click on it opens one.",
    );
    items[2]?.click();
    expect(byId("empty").textContent).toContain("on fixture:");
    // A group holds no connection of its own: the pane asks to pick one.
    view.explorer([row("group", "Shop", 1, "")]);
    expect(byId("empty").textContent).toBe(PICK);
  });
});

describe("the TLS choice", () => {
  it("says what the desk's PostgreSQL sessions do by default, and MySQL's client for MySQL", () => {
    const view = createView(document, () => undefined);
    const pg = SAVED[1];
    if (!pg) throw new Error("a PostgreSQL connection");
    view.form({ mode: "new", fields: { ...pg, ssl: "default" }, error: "", note: "" } as never);
    const ssl = byId("f-ssl") as HTMLSelectElement;
    expect(ssl.value).toBe("default");
    expect(ssl.selectedOptions[0]?.textContent).toBe("default: TLS when the server offers it");
    expect([...ssl.options].some((o) => /client's default/u.test(o.textContent ?? ""))).toBe(false);
    const engine = byId("f-engine") as HTMLSelectElement;
    engine.value = "mysql";
    engine.dispatchEvent(new Event("change"));
    expect(ssl.selectedOptions[0]?.textContent).toBe("the client's default");
  });
});
