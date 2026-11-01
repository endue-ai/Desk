import { describe, expect, it } from "vitest";
import { denied, disk, file, fixture, mount } from "./harness";

const A = file("~/Documents/a.csv");
const B = file("~/Documents/budget.xlsx");
const X = file("~/Documents/x.xlsx");
const DOCS_READ = { permission: "fs:read", paths: ["~/Documents/**"] } as const;

/** The first sheet of what the view shows last, as rows of displayed text. */
const textOf = (view: Awaited<ReturnType<typeof mount>>["view"], rows = 2, cols = 2) => {
  const book = view.shown.at(-1)?.book;
  if (book?.kind !== "sheets") return book?.kind;
  const sheet = book.sheets[0];
  return Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => sheet?.text(r, c)),
  );
};

describe("the desk's file requests", () => {
  it("visit reads bounded ranges, shows it and watches it", async () => {
    const { host, view, params } = await mount({
      handlers: disk({ [A.path]: "name,qty\napple,3\n", [B.path]: fixture("budget.xlsx") }),
    });
    await expect(host.command("desk.files.visit", A)).resolves.toBeUndefined();
    const fs = host.calls.map((c) => c.method).filter((m) => m.startsWith("fs."));
    expect(fs).toEqual(["fs.url", "fs.read", "fs.read", "fs.watch"]);
    expect(params("fs.read")).toEqual([
      { path: A.path, encoding: "base64", scope: DOCS_READ, offset: 0, length: 0 },
      { path: A.path, encoding: "base64", scope: DOCS_READ, offset: 0, length: 17 },
    ]);
    expect(params("fs.watch")).toEqual([{ path: A.path, scope: DOCS_READ }]);
    expect(view.shown.at(-1)).toMatchObject({ ...A, name: "a.csv", size: 17 });
    expect(textOf(view)).toEqual([
      ["name", "qty"],
      ["apple", "3"],
    ]);
    expect(view.focused).toBe(1);
    expect(view.statuses.at(-1)).toBe("Opened a.csv: 1 sheet.");

    await host.command("desk.files.visit", B);
    expect(view.shown.at(-1)).toMatchObject({ ...B, name: "budget.xlsx" });
    expect(view.statuses.at(-1)).toBe("Opened budget.xlsx: 2 sheets.");
  });

  it("revert reads the file again", async () => {
    const files: Record<string, string> = { [A.path]: "a,b\n1,2\n" };
    const { host, view, params } = await mount({ handlers: disk(files) });
    await host.command("desk.files.visit", A);
    files[A.path] = "a,b\n7,8\n";
    await expect(host.command("desk.files.revert", A)).resolves.toBeUndefined();
    expect(params("fs.read")).toHaveLength(4);
    expect(textOf(view)).toEqual([
      ["a", "b"],
      ["7", "8"],
    ]);
  });

  it("show switches between open files and closed forgets one", async () => {
    const C = file("~/Documents/c.csv");
    const { host, view } = await mount({
      handlers: disk({ [A.path]: "a\n", [C.path]: "c\n" }),
    });
    expect(view.shown.at(-1)).toBeNull();
    await host.command("desk.files.visit", A);
    await host.command("desk.files.visit", C);
    expect(view.shown.at(-1)).toMatchObject({ buffer: C.buffer, name: "c.csv" });

    await expect(host.command("desk.buffers.show", A)).resolves.toBeUndefined();
    expect(view.shown.at(-1)).toMatchObject({ buffer: A.buffer, name: "a.csv" });
    expect(view.focused).toBe(3);

    await host.command("desk.buffers.closed", { buffer: A.buffer });
    expect(view.shown.at(-1)).toBeNull();
    await expect(host.command("desk.buffers.show", A)).rejects.toThrow(
      `No spreadsheet ${A.buffer}.`,
    );
    await host.command("desk.buffers.show", C);
    expect(view.shown.at(-1)).toMatchObject({ buffer: C.buffer });
  });

  it("save is refused: the plugin reads only", async () => {
    const { host, view, params } = await mount({ handlers: disk({ [A.path]: "a\n" }) });
    await host.command("desk.files.visit", A);
    await expect(host.command("desk.files.save", A)).rejects.toThrow(
      "Sheets opens files read-only.",
    );
    expect(view.statuses.at(-1)).toBe("Sheets opens files read-only.");
    expect(params("fs.write")).toEqual([]);
  });

  it("a change on disk runs desk.files.changed with the path", async () => {
    const { host, ran, settle } = await mount({ handlers: disk({ [A.path]: "a\n" }) });
    await host.command("desk.files.visit", A);
    host.emit({ event: "fs.changed", data: { watchId: "w1", path: A.path, change: "modified" } });
    await settle();
    expect(ran("desk.files.changed")).toEqual([{ path: A.path }]);
    await host.command("desk.buffers.closed", { buffer: A.buffer });
    host.emit({ event: "fs.changed", data: { watchId: "w1", path: A.path, change: "modified" } });
    await settle();
    expect(ran("desk.files.changed")).toHaveLength(1);
  });
});

describe("files outside the grants", () => {
  it("a refused read asks once for the folder and says so in words", async () => {
    const { host, view, params } = await mount({
      handlers: {
        "fs.read": () => {
          throw denied("fs:read over ~/Documents/x.xlsx");
        },
        "perm.request": () => ({ granted: false }),
      },
    });
    await expect(host.command("desk.files.visit", X)).rejects.toThrow(
      "Not allowed to read ~/Documents/x.xlsx.",
    );
    expect(params("perm.request")).toEqual([
      { permission: DOCS_READ, reason: "To open ~/Documents/x.xlsx in Sheets" },
    ]);
    expect(params("fs.read")).toHaveLength(1);
    expect(params("fs.watch")).toEqual([]);
    expect(view.statuses.at(-1)).toBe("Not allowed to read ~/Documents/x.xlsx.");
    expect(view.shown.at(-1)).toBeNull();
  });

  it("a granted ask reads again and opens the file", async () => {
    let reads = 0;
    const { host, view, params } = await mount({
      handlers: {
        ...disk({ [X.path]: fixture("budget.xlsx") }),
        "fs.read": ({ offset = 0, length }) => {
          reads++;
          if (reads === 1) throw denied("fs:read over ~/Documents/x.xlsx");
          return {
            content: Buffer.from(
              fixture("budget.xlsx").subarray(
                offset,
                length === undefined ? undefined : offset + length,
              ),
            ).toString("base64"),
            size: fixture("budget.xlsx").length,
            encoding: "base64",
          };
        },
        "perm.request": ({ permission }) => ({
          granted: true,
          grant: {
            grantId: "g1",
            permission,
            duration: "session",
            grantedAt: "2026-11-01T09:00:00Z",
          },
        }),
      },
    });
    await expect(host.command("desk.files.visit", X)).resolves.toBeUndefined();
    expect(params("fs.read")).toHaveLength(3);
    expect(params("perm.request")).toHaveLength(1);
    expect(view.shown.at(-1)?.book.kind).toBe("sheets");
  });
});

describe("the csv-encoding setting", () => {
  // "가격,합계" in EUC-KR (code page 949).
  const KOREAN = new Uint8Array([0xb0, 0xa1, 0xb0, 0xdd, 0x2c, 0xc7, 0xd5, 0xb0, 0xe8, 0x0a]);

  it("auto reads bytes that are not UTF-8 as EUC-KR", async () => {
    const { host, view } = await mount({ handlers: disk({ [A.path]: KOREAN }) });
    await host.command("desk.files.visit", A);
    expect(textOf(view, 1)).toEqual([["가격", "합계"]]);
  });

  it("a change decodes the open CSV files again", async () => {
    const { host, view, settle } = await mount({
      handlers: disk({ [A.path]: KOREAN }),
      settings: { "csv-encoding": "windows-1252" },
    });
    await host.command("desk.files.visit", A);
    expect(textOf(view, 1)).toEqual([["°¡°Ý", "ÇÕ°è"]]);
    await host.call("settings.set", { key: "csv-encoding", value: "euc-kr" }, "endue.sheets");
    await settle();
    expect(textOf(view, 1)).toEqual([["가격", "합계"]]);
  });
});
