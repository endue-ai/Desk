// A copy past a stated size asks first (#504): past 100,000 cells (weighed before the text is
// built) or past 10,000,000 characters (weighed after), Copy as and the cell's value copy go on only
// on Yes, and say so when they do not; a copy as TSV carries an HTML table of the same cells.
import { describe, expect, it, vi } from "vitest";
import { COPY_LIMITS, copyQuestion, tooLarge } from "../ui/copy-size.js";
import { createTools } from "../ui/tools.js";

type Row = (string | null)[];
const setOf = (rows: Row[], columns = ["id", "note"]) => ({ columns, rows, truncated: false });
const rowsOf = (count: number): Row[] =>
  Array.from({ length: count }, (_, i) => [String(i), i % 2 ? null : "x"]);

/** The tools over one result on screen, a recording view and a confirm that answers `yes`. */
function toolsOver(set: ReturnType<typeof setOf>, yes: boolean, cell?: unknown) {
  const copied: Array<{ text: string; html: string | undefined }> = [];
  const said: string[] = [];
  const confirm = vi.fn(async (_title: string, _reasons: string[]) => yes);
  const view = {
    say: (text: string) => void said.push(text),
    copy: async (text: string, html?: string) => {
      copied.push({ text, html });
      return true;
    },
    selection: () => undefined,
    cell: () => cell,
  };
  const shown = { connection: "c-lite", tab: 0, shown: { tabs: [{ set }] } };
  const conn = { id: "c-lite", name: "Notes", engine: "sqlite" };
  const tools = createTools({
    view,
    confirm,
    pick: async () => undefined,
    consoles: { current: () => shown },
    manager: { get: () => conn },
  } as never);
  return { tools, copied, said, confirm };
}

describe("the size past which a copy asks", () => {
  it("is 100,000 cells or 10,000,000 characters", () => {
    expect(COPY_LIMITS).toEqual({ cells: 100_000, characters: 10_000_000 });
    expect(tooLarge({ cells: 100_000 })).toBe(false);
    expect(tooLarge({ cells: 100_001 })).toBe(true);
    expect(tooLarge({ characters: 10_000_000 })).toBe(false);
    expect(tooLarge({ characters: 10_000_001 })).toBe(true);
  });

  it("says how much the copy holds and why it asks", () => {
    const asked = copyQuestion({ cells: 250_000 });
    expect(asked.title).toBe(`Copy ${(250_000).toLocaleString()} cells to the clipboard?`);
    expect(asked.reasons[0]).toContain("can stall the app it goes to");
    expect(copyQuestion({ characters: 12_000_000 }).title).toContain("characters (about 11 MiB)");
  });
});

describe("Copy as", () => {
  it("past 100,000 cells asks first, and on No copies nothing and says so", async () => {
    const t = toolsOver(setOf(rowsOf(50_001)), false);
    expect(await t.tools.copy("csv")).toBeUndefined();
    expect(t.confirm).toHaveBeenCalledOnce();
    expect(t.confirm.mock.calls[0]?.[0]).toBe(
      `Copy ${(100_002).toLocaleString()} cells to the clipboard?`,
    );
    expect(t.copied).toEqual([]);
    expect(t.said).toEqual(["Nothing copied."]);
  });

  it("on Yes copies, asked once", async () => {
    const t = toolsOver(setOf(rowsOf(50_001)), true);
    const text = await t.tools.copy("csv");
    expect(t.confirm).toHaveBeenCalledOnce();
    expect(t.copied).toHaveLength(1);
    expect(t.copied[0]?.text).toBe(text);
    expect(t.said).toEqual(["Copied as CSV."]);
  });

  it("100,000 cells copy without a question", async () => {
    const t = toolsOver(setOf(rowsOf(50_000)), false);
    await t.tools.copy("tsv");
    expect(t.confirm).not.toHaveBeenCalled();
    expect(t.copied).toHaveLength(1);
  });

  it("past 10,000,000 characters asks too, for few cells", async () => {
    const t = toolsOver(setOf([["1", "y".repeat(COPY_LIMITS.characters)]]), false);
    expect(await t.tools.copy("json")).toBeUndefined();
    expect(t.confirm.mock.calls[0]?.[0]).toMatch(/^Copy [\d,]+ characters \(about 9\.5 MiB\) to/u);
    expect(t.copied).toEqual([]);
  });

  it("as TSV carries an HTML table of the same cells beside the text; other formats text only", async () => {
    const t = toolsOver(
      setOf([
        ["1", "a\tb"],
        ["2", null],
      ]),
      true,
    );
    await t.tools.copy("tsv");
    expect(t.copied[0]).toEqual({
      text: "1\ta\\tb\n2\t\\N",
      html: "<table><tr><td>1</td><td>a\tb</td></tr><tr><td>2</td><td></td></tr></table>",
    });
    await t.tools.copy("csv");
    expect(t.copied[1]?.html).toBeUndefined();
  });
});

describe("copying a cell's value", () => {
  it("copies the text the value viewer shows, or the cursor's cell's whole value", async () => {
    const t = toolsOver(setOf([]), true, { value: '{"a": 1}', type: "jsonb" });
    expect(await t.tools.copyValue("shown text")).toBe("shown text");
    expect(await t.tools.copyValue(undefined)).toBe('{"a": 1}');
    expect(t.copied.map((c) => c.text)).toEqual(["shown text", '{"a": 1}']);
    expect(t.said).toEqual(["Copied the value.", "Copied the value."]);
  });

  it("says where there is no cell, and asks first past 10,000,000 characters", async () => {
    await expect(toolsOver(setOf([]), true).tools.copyValue(undefined)).rejects.toThrow(
      "No cell here: put the grid's cursor on one.",
    );
    const t = toolsOver(setOf([]), false);
    expect(await t.tools.copyValue("z".repeat(COPY_LIMITS.characters + 1))).toBeUndefined();
    expect(t.confirm).toHaveBeenCalledOnce();
    expect(t.copied).toEqual([]);
    expect(t.said).toEqual(["Nothing copied."]);
  });
});
