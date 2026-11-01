import { Base, element, reflect, shadow, step, uid } from "./base";
import { compareValues } from "./order";

const css = `
:host {
  display: block;
  box-sizing: border-box;
  border: 1px solid var(--desk-border);
  border-radius: var(--desk-radius-md);
  background: var(--desk-card);
  color: var(--desk-text);
  font: inherit;
  font-size: var(--desk-text-sm);
  overflow: auto;
}
:host([hidden]) {
  display: none;
}
[role="grid"] {
  display: table;
  width: 100%;
  outline: none;
}
[role="grid"]:focus-visible {
  outline: 2px solid var(--desk-ring);
  outline-offset: -2px;
}
[role="rowgroup"] {
  display: table-row-group;
}
[role="row"] {
  display: table-row;
}
[role="columnheader"],
[role="gridcell"] {
  display: table-cell;
  padding: 6px 10px;
  border-bottom: 1px solid var(--desk-border);
  text-align: left;
  white-space: nowrap;
}
[role="columnheader"] {
  color: var(--desk-text-muted);
  font-weight: 600;
}
button {
  padding: 0;
  border: none;
  background: var(--desk-card);
  color: var(--desk-text-muted);
  font: inherit;
  cursor: pointer;
}
button:focus-visible {
  outline: 2px solid var(--desk-ring);
  outline-offset: 2px;
}
.body [role="row"] {
  cursor: pointer;
}
.body [data-active] {
  background: var(--desk-border);
  color: var(--desk-text);
}
.body [aria-selected="true"] {
  color: var(--desk-primary-text);
}
:host([density="compact"]) [role="columnheader"],
:host([density="compact"]) [role="gridcell"] {
  padding: 2px 6px;
}
:host([density="compact"]) {
  font-size: var(--desk-text-xs);
}
`;

/** One column: `key` names its cell in each row; only `sortable` columns sort on a click. */
export interface DeskTableColumn {
  key: string;
  label: string;
  sortable?: boolean;
}

/** One row: the text of each cell by column key, and the values a column sorts by (else the text). */
export interface DeskTableRow {
  cells: Record<string, string>;
  values?: Record<string, unknown>;
}

export type DeskSortDirection = "ascending" | "descending";
/** What `desk-sort` carries, and what `sort` holds. */
export type DeskSortDetail = { key: string; direction: DeskSortDirection };
/** What `desk-select` carries from a table: the row's index as shown, and the row. */
export type DeskTableSelectDetail = { index: number; row: DeskTableRow };

/**
 * `<desk-table label="Open tasks">`: a grid of `columns` and `rows`. The grid keeps focus and points
 * at the active row with `aria-activedescendant`; arrows, Home and End move; Enter, Space and a click
 * select and fire `desk-select` ({@link DeskTableSelectDetail}). A sortable column's header is a
 * button: ascending, then descending; `aria-sort` says which, and `desk-sort` tells the page.
 */
export class DeskTable extends Base {
  static readonly styles = css;
  static readonly observedAttributes = ["label"];
  readonly #grid = element("div", { role: "grid", tabindex: "0", part: "grid" });
  readonly #head = element("div", { role: "row" });
  readonly #body = element("div", { role: "rowgroup", class: "body" });
  #columns: DeskTableColumn[] = [];
  #rows: DeskTableRow[] = [];
  #shown: DeskTableRow[] = [];
  #ids = new Map<DeskTableRow, string>();
  #sort: DeskSortDetail | null = null;
  #active: DeskTableRow | null = null;
  #selected: DeskTableRow | null = null;

  constructor() {
    super();
    const head = element("div", { role: "rowgroup", class: "head" });
    head.append(this.#head);
    this.#grid.append(head, this.#body);
    shadow(this, css, [this.#grid], { delegatesFocus: true });
    this.#grid.addEventListener("keydown", this.#onKeyDown);
    this.#grid.addEventListener("click", this.#onClick);
  }

  get columns(): DeskTableColumn[] {
    return this.#columns;
  }

  set columns(columns: DeskTableColumn[]) {
    this.#columns = [...columns];
    this.#render();
  }

  get rows(): DeskTableRow[] {
    return this.#rows;
  }

  set rows(rows: DeskTableRow[]) {
    this.#rows = [...rows];
    this.#ids = new Map(this.#rows.map((row) => [row, this.#ids.get(row) ?? uid("desk-row")]));
    if (this.#active && !this.#rows.includes(this.#active)) this.#active = null;
    if (this.#selected && !this.#rows.includes(this.#selected)) this.#selected = null;
    this.#render();
  }

  /** The column the rows are sorted by, or null for the order they were given in. */
  get sort(): DeskSortDetail | null {
    return this.#sort;
  }

  set sort(sort: DeskSortDetail | null) {
    this.#sort = sort ? { ...sort } : null;
    this.#render();
  }

  /** The selected row's index among the rows as shown, or -1. */
  get selectedIndex(): number {
    return this.#selected ? this.#shown.indexOf(this.#selected) : -1;
  }

  set selectedIndex(index: number) {
    this.#selected = this.#shown[index] ?? null;
    this.#render();
  }

  /** The row the arrows are on, or null. */
  get activeRow(): DeskTableRow | null {
    return this.#active;
  }

  get selectedRow(): DeskTableRow | null {
    return this.#selected;
  }

  /** The row a node of the grid belongs to (a row, a cell), or null: for a page's context menu. */
  rowOf(node: EventTarget | null): DeskTableRow | null {
    for (let at = node as Node | null; at; at = at.parentNode) {
      if (at.parentNode !== this.#body) continue;
      return this.#shown[Number((at as Element).getAttribute("data-index"))] ?? null;
    }
    return null;
  }

  attributeChangedCallback(_name: string, _old: string | null, value: string | null): void {
    reflect(this.#grid, "aria-label", value);
  }

  #ordered(): DeskTableRow[] {
    const sort = this.#sort;
    if (!sort) return [...this.#rows];
    const value = (row: DeskTableRow) => row.values?.[sort.key] ?? row.cells[sort.key];
    const sign = sort.direction === "ascending" ? 1 : -1;
    return [...this.#rows].sort((a, b) => compareValues(value(a), value(b), sign));
  }

  #render(): void {
    this.#shown = this.#ordered();
    this.#head.replaceChildren(...this.#columns.map((column) => this.#header(column)));
    this.#body.replaceChildren(
      ...this.#shown.map((row, index) => {
        const tr = element("div", {
          role: "row",
          id: this.#ids.get(row) ?? uid("desk-row"),
          "aria-selected": String(row === this.#selected),
          "data-index": String(index),
        });
        if (row === this.#active) tr.setAttribute("data-active", "");
        tr.append(
          ...this.#columns.map((column) => {
            const cell = element("div", { role: "gridcell" });
            cell.textContent = row.cells[column.key] ?? "";
            return cell;
          }),
        );
        return tr;
      }),
    );
    reflect(this.#grid, "aria-activedescendant", this.#active ? this.#idOf(this.#active) : null);
  }

  #idOf(row: DeskTableRow): string {
    return this.#ids.get(row) ?? "";
  }

  #header(column: DeskTableColumn): HTMLElement {
    const header = element("div", { role: "columnheader" });
    if (!column.sortable) {
      header.textContent = column.label;
      return header;
    }
    const on = this.#sort?.key === column.key ? this.#sort.direction : "none";
    header.setAttribute("aria-sort", on);
    const button = element("button", { type: "button" });
    button.textContent = column.label;
    button.addEventListener("click", () => this.#sortBy(column.key));
    header.append(button);
    return header;
  }

  #sortBy(key: string): void {
    const direction: DeskSortDirection =
      this.#sort?.key === key && this.#sort.direction === "ascending" ? "descending" : "ascending";
    this.sort = { key, direction };
    const detail: DeskSortDetail = { key, direction };
    this.dispatchEvent(new CustomEvent("desk-sort", { bubbles: true, detail }));
  }

  #activate(row: DeskTableRow | null): void {
    this.#active = row;
    this.#render();
    if (!row) return;
    const index = this.#shown.indexOf(row);
    (this.#body.children[index] as HTMLElement | undefined)?.scrollIntoView({ block: "nearest" });
  }

  #select(row: DeskTableRow): void {
    this.#selected = row;
    this.#activate(row);
    const detail: DeskTableSelectDetail = { index: this.#shown.indexOf(row), row };
    this.dispatchEvent(new CustomEvent("desk-select", { bubbles: true, detail }));
  }

  #onKeyDown = (event: KeyboardEvent): void => {
    if (event.target !== this.#grid) return;
    const at = this.#active ? this.#shown.indexOf(this.#active) : -1;
    const next = step(event.key, at, this.#shown.length, false);
    if (next !== null) {
      event.preventDefault();
      this.#activate(this.#shown[next] ?? null);
    } else if ((event.key === "Enter" || event.key === " ") && this.#active) {
      event.preventDefault();
      this.#select(this.#active);
    }
  };

  #onClick = (event: MouseEvent): void => {
    const row = this.rowOf(event.target);
    if (row) this.#select(row);
  };
}
