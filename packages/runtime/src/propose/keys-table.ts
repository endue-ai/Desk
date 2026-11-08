/**
 * Proposed key bindings as a table: the key as people read it, the command it would run, what the key
 * runs now, and a mark for each conflict: the key is taken by another command (in any layer), two
 * proposals share it, or it already runs that command.
 */

export type KeyMark = "taken" | "twice" | "same";

export interface KeyRow {
  /** As people read it on this platform: ⇧⌘T. */
  key: string;
  /** Canonical: Meta+Shift+T. */
  combo: string;
  /** The command it would run; "" takes the key away. */
  command: string;
  title: string;
  /** What the key runs now, or another layer gives it. */
  now?: { command: string; title: string; owner: string };
  marks: KeyMark[];
}

const MARKS: Record<KeyMark, (row: KeyRow) => string> = {
  taken: (row) => `Taken from ${row.now?.title ?? row.now?.command ?? "another command"}`,
  twice: () => "Twice in this proposal",
  same: () => "Already bound",
};

export function drawKeys(doc: Document, rows: KeyRow[]): HTMLElement {
  const cell = (tag: "td" | "th", text = "", className = "") => {
    const el = doc.createElement(tag);
    if (className) el.className = className;
    el.textContent = text;
    return el;
  };
  const table = doc.createElement("table");
  table.className = "proposal-keys";
  const head = doc.createElement("tr");
  for (const title of ["Key", "Command", "Now", ""]) head.append(cell("th", title));
  table.createTHead().append(head);
  const body = table.createTBody();
  for (const row of rows) {
    const tr = doc.createElement("tr");
    tr.dataset.marks = row.marks.join(" ");
    const key = cell("td");
    const kbd = doc.createElement("kbd");
    kbd.textContent = row.key;
    key.append(kbd);
    const command = cell("td", row.command ? row.title : "Nothing: the key is taken away");
    if (row.command) command.title = row.command;
    const marks = cell("td");
    for (const mark of row.marks) {
      const span = doc.createElement("span");
      span.className = "proposal-mark";
      span.dataset.mark = mark;
      span.textContent = MARKS[mark](row);
      marks.append(span);
    }
    tr.append(key, command, cell("td", row.now?.title ?? ""), marks);
    body.append(tr);
  }
  return table;
}
