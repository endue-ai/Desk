import { beforeEach, describe, expect, it, vi } from "vitest";
// Before the elements: it installs the DOM they extend.
import "./test-dom";
import { defineElements } from "./index";
import { focused, press, queryAll, reset } from "./test-dom";

defineElements();

const columns = [
  { key: "task", label: "Task", sortable: true },
  { key: "priority", label: "Priority", sortable: true },
  { key: "project", label: "Project" },
];
const rows = [
  { cells: { task: "Send the report", priority: "P1", project: "Work" }, values: { priority: 1 } },
  { cells: { task: "Buy groceries", priority: "P3", project: "Home" }, values: { priority: 3 } },
  { cells: { task: "Call the bank", priority: "P2", project: "Home" }, values: { priority: 2 } },
];

function table() {
  const element = document.createElement("desk-table");
  element.setAttribute("label", "Open tasks");
  element.columns = columns;
  element.rows = rows;
  document.body.append(element);
  const root = element.shadowRoot as ShadowRoot;
  const byRole = (role: string) => queryAll(root, (el) => el.getAttribute("role") === role);
  const [grid] = byRole("grid");
  const headers = () => byRole("columnheader");
  const bodyRows = () => byRole("row").filter((row) => byRoleIn(row, "gridcell").length > 0);
  const titles = () => bodyRows().map((row) => byRoleIn(row, "gridcell")[0]?.textContent);
  return { element, grid: grid as HTMLElement, headers, bodyRows, titles };
}

const byRoleIn = (root: Element, role: string) =>
  queryAll(root, (el) => el.getAttribute("role") === role);

describe("desk-table", () => {
  beforeEach(reset);

  it("is a labelled grid of column headers and rows", () => {
    const { grid, headers, bodyRows } = table();
    expect(grid.getAttribute("aria-label")).toBe("Open tasks");
    expect(grid.tabIndex).toBe(0);
    expect(headers().map((header) => header.textContent)).toEqual(["Task", "Priority", "Project"]);
    expect(bodyRows()).toHaveLength(3);
    expect(bodyRows().map((row) => byRoleIn(row, "gridcell").map((c) => c.textContent))).toEqual([
      ["Send the report", "P1", "Work"],
      ["Buy groceries", "P3", "Home"],
      ["Call the bank", "P2", "Home"],
    ]);
    for (const row of bodyRows()) expect(row.getAttribute("aria-selected")).toBe("false");
  });

  it("moves the active row with the arrows, Home and End, and selects with Enter, Space and a click", () => {
    const { element, grid, bodyRows } = table();
    const onSelect = vi.fn();
    element.addEventListener("desk-select", onSelect);
    const active = () => grid.getAttribute("aria-activedescendant");
    element.focus();
    expect(focused()).toBe(grid);
    expect(press("ArrowDown")).toBe(true);
    expect(active()).toBe(bodyRows()[0]?.id);
    press("End");
    expect(active()).toBe(bodyRows()[2]?.id);
    press("ArrowDown");
    expect(active()).toBe(bodyRows()[2]?.id);
    press("Home");
    press("ArrowDown");
    expect(active()).toBe(bodyRows()[1]?.id);
    expect(press("Enter")).toBe(true);
    expect(onSelect.mock.calls[0]?.[0].detail).toEqual({ index: 1, row: rows[1] });
    expect(element.selectedIndex).toBe(1);
    expect(bodyRows().map((row) => row.getAttribute("aria-selected"))).toEqual([
      "false",
      "true",
      "false",
    ]);
    press("Home");
    press(" ");
    expect(onSelect.mock.calls[1]?.[0].detail).toEqual({ index: 0, row: rows[0] });
    byRoleIn(bodyRows()[2] as Element, "gridcell")[1]?.click();
    expect(onSelect.mock.calls[2]?.[0].detail).toEqual({ index: 2, row: rows[2] });
    expect(element.selectedIndex).toBe(2);
    expect(active()).toBe(bodyRows()[2]?.id);
  });

  it("sorts by a sortable column, ascending then descending", () => {
    const { element, headers, titles } = table();
    const onSort = vi.fn();
    element.addEventListener("desk-sort", onSort);
    const sortOf = () => headers().map((header) => header.getAttribute("aria-sort"));
    expect(sortOf()).toEqual(["none", "none", null]);
    const button = (header: Element | undefined) =>
      queryAll(header as Element, (el) => el.localName === "button")[0];

    button(headers()[1])?.click();
    expect(sortOf()).toEqual(["none", "ascending", null]);
    expect(titles()).toEqual(["Send the report", "Call the bank", "Buy groceries"]);
    expect(onSort.mock.calls[0]?.[0].detail).toEqual({ key: "priority", direction: "ascending" });

    button(headers()[1])?.click();
    expect(sortOf()).toEqual(["none", "descending", null]);
    expect(titles()).toEqual(["Buy groceries", "Call the bank", "Send the report"]);
    expect(onSort.mock.calls[1]?.[0].detail).toEqual({ key: "priority", direction: "descending" });

    // A selected row stays selected wherever the sort puts it.
    element.selectedIndex = 0;
    button(headers()[1])?.click();
    expect(titles()).toEqual(["Send the report", "Call the bank", "Buy groceries"]);
    expect(element.selectedIndex).toBe(2);
    button(headers()[0])?.click();
    expect(titles()).toEqual(["Buy groceries", "Call the bank", "Send the report"]);
    expect(element.selectedIndex).toBe(0);
    expect(element.sort).toEqual({ key: "task", direction: "ascending" });

    expect(button(headers()[2])).toBeUndefined();
    headers()[2]?.click();
    expect(onSort).toHaveBeenCalledTimes(4);
    expect(sortOf()).toEqual(["ascending", "none", null]);
  });

  it("starts in the sort it is given", () => {
    const element = document.createElement("desk-table");
    element.columns = columns;
    element.sort = { key: "priority", direction: "descending" };
    element.rows = rows;
    document.body.append(element);
    const cells = byRoleIn(element.shadowRoot as unknown as Element, "gridcell").map(
      (cell) => cell.textContent,
    );
    expect(cells.filter((text) => text?.startsWith("P"))).toEqual(["P3", "P2", "P1"]);
  });
});
