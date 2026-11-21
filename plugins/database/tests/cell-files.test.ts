// Typed cell editors (PG-40, #467): bytes are loaded from a file the person picks (dialog.open, then
// fs.read as base64 under that file's own scope) and saved to one in ~/Downloads (fs.write as base64,
// the folder the manifest declares for writes), from the editor's buttons and from the palette, where
// the commands work on the cursor's cell, as set DEFAULT does.
import { describe, expect, it, vi } from "vitest";
import { DEFAULT } from "../ui/edit/values.js";
import { feature, loadBytes, saveBytes } from "../ui/features/cell-values/index.js";

const base64 = (bytes: number[]) => Buffer.from(bytes).toString("base64");

function bridge(answers: Record<string, unknown>) {
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  return {
    calls,
    call: vi.fn(async (method: string, params: Record<string, unknown>) => {
      calls.push({ method, params });
      const answer = answers[method];
      if (answer instanceof Error) throw answer;
      return typeof answer === "function" ? answer(params) : answer;
    }),
  };
}

describe("bytes load from a file the person picks and save to one", () => {
  it("reads the picked file as base64 into hex", async () => {
    const b = bridge({
      "dialog.open": { cancelled: false, paths: ["~/data/a.bin"] },
      "fs.read": { content: base64([0xde, 0xad, 0xbe, 0xef]), encoding: "base64", size: 4 },
    });
    expect(await loadBytes(b)).toEqual({ hex: "\\xdeadbeef", name: "a.bin", size: 4 });
    expect(b.calls[1]).toEqual({
      method: "fs.read",
      params: {
        path: "~/data/a.bin",
        encoding: "base64",
        length: 262_145,
        scope: { permission: "fs:read", paths: ["~/data/a.bin"] },
      },
    });
    const cancelled = bridge({ "dialog.open": { cancelled: true, paths: [] } });
    expect(await loadBytes(cancelled)).toBeUndefined();
  });

  it("refuses a file over the cap", async () => {
    const b = bridge({
      "dialog.open": { cancelled: false, paths: ["~/big.bin"] },
      "fs.read": { content: base64([1]), encoding: "base64", size: 300_000 },
    });
    await expect(loadBytes(b)).rejects.toThrow(
      /big\.bin is 293 KiB: a value loaded from a file is 256 KiB at most/u,
    );
  });

  it("writes the bytes into ~/Downloads as base64 and shows the file", async () => {
    const b = bridge({ "fs.write": {} });
    const commands = { run: vi.fn(async () => undefined) };
    const at = new Date(2026, 10, 21, 9, 8, 7);
    const path = await saveBytes(b, commands, "\\x00ff10", "photo", at);
    expect(path).toBe("~/Downloads/photo-20261121-090807.bin");
    expect(b.calls[0]).toEqual({
      method: "fs.write",
      params: {
        path,
        content: base64([0, 255, 16]),
        encoding: "base64",
        createDirs: true,
        scope: { permission: "fs:write", paths: ["~/Downloads/**"] },
      },
    });
    expect(commands.run).toHaveBeenCalledWith("desk.files.reveal", { path });
    await expect(saveBytes(b, commands, "hello", "x", at)).rejects.toThrow(/not bytes/u);
  });

  it("works on the cursor's cell from the palette, and sets DEFAULT there", async () => {
    const cell = {
      row: 2,
      col: 1,
      name: "photo",
      value: "\\x01",
      editable: true,
      reason: "",
      editor: { kind: "bytes", hasDefault: true },
    };
    const editCell = vi.fn(async () => undefined);
    const say = vi.fn();
    const b = bridge({
      "dialog.open": { cancelled: false, paths: ["~/a.bin"] },
      "fs.read": { content: base64([2, 3]), encoding: "base64", size: 2 },
      "fs.write": {},
    });
    const deps = {
      bridge: b,
      commands: { run: vi.fn(async () => undefined) },
      view: { cell: () => cell },
      consoles: { edits: { editCell } },
      say,
    };
    const commands = feature.commands?.(deps as never) ?? {};
    await commands["endue.database.cell-file-load"]?.({});
    expect(editCell).toHaveBeenCalledWith(2, 1, "\\x0203");
    expect(say).toHaveBeenLastCalledWith(
      "Loaded a.bin (2 bytes) into photo: pending until Submit.",
    );
    await commands["endue.database.cell-file-save"]?.({});
    expect(b.calls.at(-1)?.method).toBe("fs.write");
    await commands["endue.database.set-default"]?.({});
    expect(editCell).toHaveBeenLastCalledWith(2, 1, DEFAULT);
    const fixed = {
      ...cell,
      editable: false,
      reason: "photo is generated: the server computes it.",
    };
    deps.view.cell = () => fixed;
    await expect(commands["endue.database.set-default"]?.({})).rejects.toThrow(
      /photo is generated/u,
    );
    deps.view.cell = () => ({ ...cell, editor: { kind: "text", hasDefault: false } });
    await expect(commands["endue.database.set-default"]?.({})).rejects.toThrow(
      /photo has no default/u,
    );
    await expect(commands["endue.database.cell-file-load"]?.({})).rejects.toThrow(/not bytes/u);
    expect(Object.keys(feature.actions?.(deps as never) ?? {}).sort()).toEqual([
      "cellFileLoad",
      "cellFileSave",
    ]);
  });
});
