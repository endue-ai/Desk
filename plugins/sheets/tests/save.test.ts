// Editing and saving CSV and TSV on the SDK's test host: the edit tier each file states, the
// unsaved mark the desk hears, desk.files.save writing only the edited cells' bytes, the one ask
// for a folder outside the grants, revert, and the formats that stay read-only (ADR 0071).
import { MessageChannel } from "node:worker_threads";
import { describe, expect, it } from "vitest";
import { assertMinimalEdit } from "../../../packages/plugin-sdk/src/testing/round-trip";
import { handleOpen, type Reply } from "../ui/worker.js";
import { large } from "./fixtures/make-csv.mjs";
import { denied, disk, file, fixture, mount } from "./harness";

const A = file("~/Documents/cities.csv");
const X = file("~/Documents/budget.xlsx");
const K = file("~/Documents/notes-euc-kr.csv");
const DOCS_WRITE = { permission: "fs:write", paths: ["~/Documents/**"] } as const;

/** The bytes of every fs.write, decoded. */
const written = (params: unknown[]) =>
  params.map((p) => new Uint8Array(Buffer.from((p as { content: string }).content, "base64")));

describe("a CSV in UTF-8", () => {
  it("an edit marks the buffer modified once and save writes only that cell's bytes", async () => {
    const before = fixture("crlf-bom-quotes.csv");
    const files: Record<string, Uint8Array> = { [A.path]: before };
    const { host, view, app, params, ran, settle } = await mount({ handlers: disk(files) });
    await host.command("desk.files.visit", A);
    expect(view.shown.at(-1)).toMatchObject({
      tier: { tier: "lossless", format: "CSV" },
      modified: false,
    });
    expect(view.shown.at(-1)?.editable?.(1, 0)).toBe(true);
    expect(view.shown.at(-1)?.editable?.(1, 4)).toBe(false);

    expect(app.edit(1, 0, "Seoul, South Korea")).toBe(true);
    expect(app.edit(2, 2, "3.5")).toBe(true);
    await settle();
    expect(ran("desk.buffers.update")).toEqual([{ id: A.buffer, modified: true }]);
    const shown = view.shown.at(-1);
    expect(shown?.modified).toBe(true);
    const sheet = shown?.book.kind === "sheets" ? shown.book.sheets[0] : undefined;
    expect([sheet?.text(1, 0), sheet?.input(2, 2), sheet?.cell(2, 2)]).toEqual([
      "Seoul, South Korea",
      "3.5",
      { t: "n", v: 3.5, w: "3.5" },
    ]);

    await expect(host.command("desk.files.save", A)).resolves.toBeUndefined();
    expect(params("fs.write")).toEqual([
      { path: A.path, content: expect.any(String), encoding: "base64", scope: DOCS_WRITE },
    ]);
    const [after] = written(params("fs.write"));
    assertMinimalEdit(before, after as Uint8Array, [
      { find: '"Seoul, KR"', bytes: '"Seoul, South Korea"' },
      { find: ",3.4,", bytes: ",3.5," },
    ]);
    expect(files[A.path]).toEqual(after);
    expect(view.shown.at(-1)).toMatchObject({ modified: false });
    expect(view.statuses.at(-1)).toBe("Saved cities.csv.");

    // The desk cleared its mark with the save; it hears of the next edit, and of setting it back.
    app.edit(4, 0, "Daejeon");
    await settle();
    app.edit(4, 0, "Daegu");
    await settle();
    expect(ran("desk.buffers.update")).toEqual([
      { id: A.buffer, modified: true },
      { id: A.buffer, modified: true },
      { id: A.buffer, modified: false },
    ]);
  });

  it("a refused write asks once for the folder and keeps the edits", async () => {
    const { host, view, app, params } = await mount({
      handlers: {
        ...disk({ [A.path]: fixture("crlf-bom-quotes.csv") }),
        "fs.write": () => {
          throw denied("fs:write over ~/Documents/cities.csv");
        },
        "perm.request": () => ({ granted: false }),
      },
    });
    await host.command("desk.files.visit", A);
    app.edit(2, 0, "Ulsan");
    await expect(host.command("desk.files.save", A)).rejects.toThrow(
      "Not allowed to write ~/Documents/cities.csv.",
    );
    expect(params("perm.request")).toEqual([
      { permission: DOCS_WRITE, reason: "To save ~/Documents/cities.csv in Sheets" },
    ]);
    expect(params("fs.write")).toHaveLength(1);
    expect(view.shown.at(-1)).toMatchObject({ modified: true });
    expect(view.statuses.at(-1)).toBe("Not allowed to write ~/Documents/cities.csv.");
  });

  it("a granted ask writes again", async () => {
    let writes = 0;
    const files: Record<string, Uint8Array> = { [A.path]: fixture("crlf-bom-quotes.csv") };
    const handlers = disk(files);
    const write = handlers["fs.write"];
    if (!write) throw new Error("the disk has no fs.write");
    const { host, app, params } = await mount({
      handlers: {
        ...handlers,
        "fs.write": (request, caller) => {
          if (++writes === 1) throw denied("fs:write over ~/Documents/cities.csv");
          return write(request, caller);
        },
        "perm.request": ({ permission }) => ({
          granted: true,
          grant: { grantId: "g1", permission, duration: "session", grantedAt: "2026-11-02T09:00Z" },
        }),
      },
    });
    await host.command("desk.files.visit", A);
    app.edit(2, 0, "Ulsan");
    await expect(host.command("desk.files.save", A)).resolves.toBeUndefined();
    expect(params("fs.write")).toHaveLength(2);
    expect(new TextDecoder().decode(files[A.path])).toContain("\r\nUlsan,Korea,3.4,");
  });

  it("revert reloads from disk and drops the edits", async () => {
    const files: Record<string, Uint8Array | string> = { [A.path]: "a,b\r\n1,2\r\n" };
    const { host, view, app, params } = await mount({ handlers: disk(files) });
    await host.command("desk.files.visit", A);
    app.edit(1, 0, "edited");
    files[A.path] = "a,b\r\n7,8\r\n";
    await host.command("desk.files.revert", A);
    const shown = view.shown.at(-1);
    const sheet = shown?.book.kind === "sheets" ? shown.book.sheets[0] : undefined;
    expect([shown?.modified, sheet?.text(1, 0), sheet?.text(1, 1)]).toEqual([false, "7", "8"]);
    await host.command("desk.files.save", A);
    expect(written(params("fs.write")).map((b) => new TextDecoder().decode(b))).toEqual([
      "a,b\r\n7,8\r\n",
    ]);
  });

  it("a 100 000-row CSV opens, edits and saves one cell", async () => {
    const before = large(100_000);
    const files: Record<string, Uint8Array> = { [A.path]: before };
    const { host, app, view } = await mount({ handlers: disk(files) });
    await host.command("desk.files.visit", A);
    expect(view.shown.at(-1)?.tier?.tier).toBe("lossless");
    expect(app.edit(99_999, 3, 'say "done"')).toBe(true);
    await host.command("desk.files.save", A);
    assertMinimalEdit(before, files[A.path] as Uint8Array, {
      find: "\r\n99999,item 99999,124998.75,",
      bytes: '\r\n99999,item 99999,124998.75,"say ""done"""',
    });
  });
});

describe("files Sheets does not save", () => {
  it("an Excel workbook is read-only and says so", async () => {
    const { host, view, app, params } = await mount({
      handlers: disk({ [X.path]: fixture("budget.xlsx") }),
    });
    await host.command("desk.files.visit", X);
    expect(view.shown.at(-1)).toMatchObject({ tier: { tier: "read-only", format: "XLSX" } });
    expect(view.shown.at(-1)?.editable?.(0, 0) ?? false).toBe(false);
    expect(app.edit(0, 0, "x")).toBe(false);
    await expect(host.command("desk.files.save", X)).rejects.toThrow(
      "Sheets opens XLSX files read-only.",
    );
    expect(params("fs.write")).toEqual([]);
  });

  it("a CSV that is not UTF-8 is read-only, and the tier says why", async () => {
    const { host, view, app, params } = await mount({
      handlers: disk({ [K.path]: fixture("notes-euc-kr.csv") }),
    });
    await host.command("desk.files.visit", K);
    const tier = view.shown.at(-1)?.tier;
    expect(tier).toMatchObject({ tier: "read-only", format: "CSV" });
    expect(tier?.detail).toContain("EUC-KR");
    expect(app.edit(0, 0, "x")).toBe(false);
    await expect(host.command("desk.files.save", K)).rejects.toThrow(
      "Sheets saves CSV and TSV files in UTF-8 only; notes-euc-kr.csv is EUC-KR.",
    );
    expect(params("fs.write")).toEqual([]);
  });
});

it("the worker hands the model back with the file's bytes", async () => {
  const bytes = fixture("crlf-bom-quotes.csv");
  const { port1, port2 } = new MessageChannel();
  const transferred: ArrayBuffer[] = [];
  try {
    const done = new Promise<Reply>((resolve) =>
      port1.on("message", (message: Reply) => {
        if (message.type === "done") resolve(message);
      }),
    );
    handleOpen({ bytes, name: "cities.csv" }, (message: Reply, buffers: ArrayBuffer[] = []) => {
      port2.postMessage(message, buffers);
      transferred.push(...buffers);
    });
    const reply = await done;
    if (reply.type !== "done" || reply.book.kind !== "sheets") throw new Error("no sheets");
    expect(reply.book.csv?.bytes).toEqual(fixture("crlf-bom-quotes.csv"));
    expect(reply.book.csv?.rows).toBe(5);
    expect(bytes.byteLength).toBe(0);
    expect(transferred).toContain(bytes.buffer);
  } finally {
    port1.close();
    port2.close();
  }
});
