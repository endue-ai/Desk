// Snippets (PG-31, ADR 0327): the built-in ones where a statement starts (and CASE in an expression),
// the person's own from the setting `endue.database.snippets` in both places, one named like a
// built-in replacing it, and a setting's value that is not a snippet left out.
import { describe, expect, it } from "vitest";
import {
  MAX_SNIPPETS,
  MAX_TEMPLATE,
  ownSnippets,
  preview,
  snippetItems,
  snippetsOf,
} from "../ui/editor/snippets.js";
import { DEFAULTS, fromValues } from "../ui/settings.js";
import { completer } from "./complete-fixture";

describe("snippets", () => {
  it("a statement's start offers the built-in ones with their tab stops, an expression CASE", async () => {
    const c = await completer();
    const snippets = snippetsOf("postgresql");
    const start = c.at("sel|", { snippets }).items.filter((i) => i.kind === "snippet");
    expect(start.map((i) => i.label)).toEqual(["sel", "selc"]);
    expect(start[0]).toMatchObject({
      snippet: true,
      insert: "SELECT ${columns}\nFROM ${table}\nWHERE ${condition}",
      // The list shows the start of the text; the info box all of it.
      detail: "SELECT columns FROM table WHERE conditi…",
      info: "SELECT columns FROM table WHERE condition",
    });
    const all = c.at("|", { snippets }).items.filter((i) => i.kind === "snippet");
    expect(all.map((i) => i.label).sort()).toEqual(
      ["ctab", "del", "idx", "ins", "sel", "selc", "txn", "upd", "upsert", "with"].sort(),
    );
    const expression = c.at("select ca| from orders", { snippets }).items;
    expect(expression.filter((i) => i.kind === "snippet").map((i) => i.label)).toEqual(["case"]);
    // Neither in a FROM list nor after a qualifier.
    expect(c.at("select * from |", { snippets }).items.some((i) => i.kind === "snippet")).toBe(
      false,
    );
    expect(
      c.at("select o.| from orders o", { snippets }).items.some((i) => i.kind === "snippet"),
    ).toBe(false);
    // Each dialect writes its own upsert and identity column.
    const upsert = (d: "postgresql" | "mysql" | "sqlite") =>
      snippetsOf(d).find((s) => s.name === "upsert")?.template ?? "";
    expect(upsert("postgresql")).toContain("ON CONFLICT");
    expect(upsert("mysql")).toContain("ON DUPLICATE KEY UPDATE");
    expect(snippetsOf("mysql").find((s) => s.name === "ctab")?.template).toContain(
      "AUTO_INCREMENT",
    );
  });

  it("the person's own come from the setting, in both places, and replace a built-in of the same name", async () => {
    const settings = fromValues({
      "endue.database.snippets": {
        sel: "SELECT * FROM ${table} LIMIT ${n}",
        recent: "placed_at > now() - interval '${days} days'",
        "bad name": "x",
        empty: "  ",
        long: "x".repeat(MAX_TEMPLATE + 1),
        number: 3,
      },
    });
    expect(settings.snippets).toEqual({
      sel: "SELECT * FROM ${table} LIMIT ${n}",
      recent: "placed_at > now() - interval '${days} days'",
    });
    expect(DEFAULTS.snippets).toEqual({});
    expect(fromValues({ "endue.database.snippets": ["x"] }).snippets).toEqual({});
    const many = Object.fromEntries(
      Array.from({ length: MAX_SNIPPETS + 5 }, (_, i) => [`s${i}`, "x"]),
    );
    expect(Object.keys(ownSnippets(many))).toHaveLength(MAX_SNIPPETS);

    const snippets = snippetsOf("postgresql", settings.snippets);
    const c = await completer();
    const sel = c.at("sel|", { snippets }).items.filter((i) => i.label === "sel");
    expect(sel).toHaveLength(1);
    expect(sel[0]).toMatchObject({
      insert: "SELECT * FROM ${table} LIMIT ${n}",
      info: "Your snippet: SELECT * FROM table LIMIT n",
    });
    const where = c.at("select * from orders where rec|", { snippets }).items;
    expect(where.find((i) => i.kind === "snippet")?.label).toBe("recent");
  });

  it("a preview writes the text without its tab stops; places other than a statement or an expression take none", () => {
    expect(preview("a ${x}\n  b #{y} \\{z\\}")).toBe("a x b y {z}");
    expect(snippetItems(snippetsOf("sqlite"), "none")).toEqual([]);
  });
});
