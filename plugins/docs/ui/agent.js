// What an agent reads through Docs (ADR 0088): the document on screen, or another one Docs has open,
// as plain text an agent can read: headings marked with #, list items with their marker, a table's
// rows with | between cells, then the footnotes, endnotes and comments. A range of it (from, chars)
// for a long one. It leaves the screen as it is. Docs opens a file only through the desk
// (desk.files.open), so an agent opens one there first.

/**
 * @typedef {import("./model.js").Block} Block
 * @typedef {import("./model.js").Inline} Inline
 * @typedef {import("./model.js").DocModel} DocModel
 * @typedef {{ buffer: string, path: string, name: string, size: number, doc: import("./model.js").Opened }} Shown
 */

/** How many characters one read answers by default and at most. */
export const CHARS = { usual: 20000, most: 200000 };

/** The text of a run of inlines. */
const inlineText = (/** @type {Inline[]} */ inlines) =>
  inlines
    .map((i) => {
      if (i.type === "text") return i.text;
      if (i.type === "tab") return "\t";
      if (i.type === "linebreak") return "\n";
      if (i.type === "noteref") return `[${i.label}]`;
      if (i.type === "field") return i.text;
      if (i.type === "image") return i.alt ? `[image: ${i.alt}]` : "[image]";
      return "";
    })
    .join("");

/** Blocks as lines of text. @returns {string[]} */
export function blocksText(/** @type {Block[]} */ blocks) {
  /** @type {string[]} */
  const lines = [];
  for (const block of blocks) {
    if (block.type === "paragraph") {
      const text = inlineText(block.inlines);
      if (block.level) lines.push(`${"#".repeat(block.level)} ${text}`);
      else if (block.marker) lines.push(`${block.marker} ${text}`);
      else lines.push(text);
    } else if (block.type === "table") {
      for (const row of block.rows)
        lines.push(
          `| ${row.cells.map((c) => blocksText(c.blocks).join(" ").replace(/\|/g, "\\|")).join(" | ")} |`,
        );
      lines.push("");
    } else if (block.type === "image") lines.push(block.alt ? `[image: ${block.alt}]` : "[image]");
  }
  return lines;
}

/** A whole document as text: its sections, then its notes and comments. */
export function documentText(/** @type {DocModel} */ doc) {
  const parts = doc.sections.flatMap((s) => blocksText(s.blocks));
  if (doc.notes.length) {
    parts.push("", "---", "Notes:");
    for (const note of doc.notes)
      parts.push(`[${note.label}] ${blocksText(note.blocks).join(" ")}`);
  }
  if (doc.comments.length) {
    parts.push("", "---", "Comments:");
    for (const c of doc.comments)
      parts.push(
        `${c.author || "Someone"} (${c.date || "undated"}): ${blocksText(c.blocks).join(" ")}`,
      );
  }
  return parts.join("\n");
}

/**
 * @param {{ on(name: string, handler: (args: unknown) => unknown): unknown }} commands
 * @param {{ open(): Shown[], shown(): string | null,
 *   position(): object, navigate?: import("./view/view.js").DocControls["navigate"],
 *   zoom?: import("./view/view.js").DocControls["zoom"] }} deps
 */
export function answerAgents(commands, deps) {
  commands.on("endue.docs.read", (raw) => {
    const a = /** @type {Record<string, unknown>} */ (raw && typeof raw === "object" ? raw : {});
    const open = deps.open();
    const documents = open.map((d) => ({
      path: d.path,
      name: d.name,
      onScreen: d.buffer === deps.shown(),
    }));
    const asked = typeof a.path === "string" && a.path !== "" ? a.path : undefined;
    const doc = asked
      ? open.find((d) => d.path === asked || d.name === asked)
      : open.find((d) => d.buffer === deps.shown());
    if (!doc) {
      if (asked) throw new Error(`Docs has no ${asked} open; open it with desk.files.open first.`);
      throw new Error("No document is open in Docs; open one with desk.files.open first.");
    }
    if (doc.doc.kind !== "document")
      return {
        path: doc.path,
        format: doc.doc.formatName,
        documents,
        text: null,
        reason: doc.doc.reason,
      };
    const text = documentText(doc.doc);
    const from = Number.isInteger(a.from) && Number(a.from) > 0 ? Number(a.from) : 0;
    const asked_ = Number(a.chars);
    const chars =
      Number.isInteger(asked_) && asked_ > 0 ? Math.min(asked_, CHARS.most) : CHARS.usual;
    return {
      path: doc.path,
      title: doc.doc.title || doc.name,
      format: doc.doc.formatName,
      documents,
      ...(doc.buffer === deps.shown() ? deps.position() : {}),
      text: text.slice(from, from + chars),
      from,
      length: text.length,
      more: from + chars < text.length,
      comments: doc.doc.comments.length,
    };
  });
  commands.on("endue.docs.show", (args) => {
    if (!deps.navigate) throw new Error("Docs has no document to move in.");
    return deps.navigate(/** @type {import("./view/view.js").DocTarget} */ (args));
  });
  commands.on("endue.docs.zoom", (args) => {
    if (!deps.zoom) throw new Error("Docs has no document to zoom.");
    return deps.zoom(/** @type {{ level: number | "fit" }} */ (args).level);
  });
}
