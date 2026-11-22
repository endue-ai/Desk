// Export through the plugin (PG-61, ui/features/export/): a format picked in the palette opens the
// options dialog filled with that format's last options; options given as arguments skip it; the
// file goes only where the save dialog answered, whatever an argument says; the rows held say so
// when the server has more; every result of a console goes into one .xlsx, a sheet each.
import { describe, expect, it } from "vitest";
import type { Script } from "./clients";
import { mount, SAVED } from "./harness";

const script: Script = (sql) =>
  /^select \* from people/u.test(sql)
    ? {
        rows: [
          ["id", "name"],
          ["1", "Ada"],
          ["2", "Grace"],
        ],
      }
    : /^select \* from orders/u.test(sql)
      ? {
          rows: [
            ["id", "total"],
            ["7", "19.99"],
          ],
        }
      : {};

async function exporting(
  answer?: (type: string, model: unknown) => unknown,
  pick = "csv",
  settings: Record<string, unknown> = {},
) {
  const writes: Array<{ path: string; content: string; encoding: string }> = [];
  const saves: Array<Record<string, unknown>> = [];
  const m = await mount({
    store: { connections: SAVED },
    script,
    pick: () => pick,
    settings,
    ...(answer ? { dialog: answer } : {}),
    handlers: {
      "dialog.save": (params) => {
        saves.push(params as never);
        return { cancelled: false, path: `~/Chosen/${params.suggestedName}` };
      },
      "fs.write": (params) => {
        writes.push(params as never);
        return { bytesWritten: params.content.length };
      },
    },
  });
  await m.host.command("endue.database.console", { connection: "Notes" });
  const run = async (text: string) => {
    m.view.text = text;
    m.view.caret = text.length;
    m.app.edited(text);
    await m.host.command("endue.database.run-all");
    await m.settle();
  };
  await run("select * from people");
  return { m, writes, saves, run };
}

describe("export through the plugin", () => {
  it("a format picked in the palette opens its options, then the save dialog", async () => {
    const asked: Array<{ type: string; model: Record<string, unknown> }> = [];
    const { m, writes, saves } = await exporting((type, model) => {
      asked.push({ type, model: model as never });
      return {
        options: {
          delimiter: ";",
          null: "NULL",
          header: true,
          quote: "needed",
          lineEnding: "lf",
          encoding: "utf-8",
          bom: false,
        },
        sheets: "shown",
      };
    });
    const done = await m.host.command("endue.database.export");
    expect(m.picks.at(-1)?.title).toBe("Database: export the result as");
    expect(m.picks.at(-1)?.items.map((i) => i.id)).toEqual([
      "tsv",
      "csv",
      "json",
      "markdown",
      "insert",
      "update",
      "xlsx",
      "html",
      "xml",
      "template",
    ]);
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({
      type: "export-options",
      model: { format: "csv", label: "CSV", rows: 2, partial: false, results: 0 },
    });
    expect((asked[0]?.model.options as { delimiter: string } | undefined)?.delimiter).toBe(",");
    expect(saves).toHaveLength(1);
    expect(writes[0]?.path).toMatch(/^~\/Chosen\/result-\d{8}-\d{6}\.csv$/u);
    expect(writes[0]?.content).toBe("id;name\n1;Ada\n2;Grace\n");
    expect(done).toMatchObject({ path: writes[0]?.path, format: "csv", rows: 2, partial: false });
    expect(m.view.said.at(-1)).toBe(`Exported 2 rows as CSV to ${writes[0]?.path}.`);
    // The next export of that format starts from those options, and from the folder chosen.
    await m.host.command("endue.database.export");
    expect((asked[1]?.model.options as { delimiter: string } | undefined)?.delimiter).toBe(";");
    expect(saves[1]?.startIn).toBe("~/Chosen");
  });

  it("options given as arguments skip the dialog; Cancel there writes nothing", async () => {
    const shown: string[] = [];
    const { m, writes } = await exporting((type) => {
      shown.push(type);
      return undefined;
    });
    await m.host.command("endue.database.export", {
      format: "template",
      options: { row: "{{#}}. {{name}}", separator: "," },
    });
    expect(shown).toEqual([]);
    expect(writes[0]?.content).toBe("1. Ada,\n2. Grace\n");
    // A named format with no options takes its last ones, without the dialog.
    await m.host.command("endue.database.export", { format: "template" });
    expect(writes[1]?.content).toBe("1. Ada,\n2. Grace\n");
    await expect(m.host.command("endue.database.export")).rejects.toThrow("Not exported.");
    expect(shown).toEqual(["export-options"]);
    expect(writes).toHaveLength(2);
    await expect(
      m.host.command("endue.database.export", { format: "csv", options: { quote: "maybe" } }),
    ).rejects.toThrow("Export: quoting is one of needed, always, never.");
  });

  it("an agent cannot export to a place the person did not choose", async () => {
    const { m, writes, saves } = await exporting();
    await m.host.command("endue.database.export", {
      format: "json",
      options: {},
      path: "~/.ssh/authorized_keys",
    } as never);
    expect(saves).toHaveLength(1);
    expect(writes.map((w) => w.path)).toEqual([expect.stringMatching(/^~\/Chosen\//u)]);
    expect(writes[0]).toMatchObject({ scope: { paths: [writes[0]?.path] } });
  });

  it("an export of the rows held says so when the server has more", async () => {
    const { m } = await exporting(undefined, "csv", { "max-rows": 1 });
    const done = await m.host.command("endue.database.export", { format: "tsv", options: {} });
    expect(done).toMatchObject({ partial: true, rows: 1 });
    expect(m.view.said.at(-1)).toMatch(
      /^Exported 1 rows as TSV to ~\/Chosen\/.+\.tsv \(the rows loaded: the server has more; load more rows first for the rest\)\.$/u,
    );
  });

  it("every result of a console goes into one .xlsx, a sheet each", async () => {
    const asked: Array<Record<string, unknown>> = [];
    const { m, writes, run } = await exporting((_, model) => {
      asked.push(model as never);
      return { options: { header: true, null: "" }, sheets: "all" };
    }, "xlsx");
    await run("select * from people;\nselect * from orders;");
    await m.host.command("endue.database.export");
    expect(asked[0]?.results).toBe(2);
    expect(writes[0]?.encoding).toBe("base64");
    expect(m.view.said.at(-1)).toMatch(
      /^Exported 3 rows as Spreadsheet \(\.xlsx\) in 2 sheets to /u,
    );
  });
});
