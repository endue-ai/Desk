// A console's COPY through standard input or output (PG-23): COPY ... TO STDOUT asks where to save
// and writes there, COPY ... FROM STDIN asks for the file and streams it in, the console's bar
// shows the bytes with its Cancel, a dialog cancelled runs nothing, and the console shows the count.
import { describe, expect, it } from "vitest";
import type { Bar } from "../ui/copy/console.js";
import { copyName } from "../ui/copy/console.js";
import { split } from "../ui/sql/split.js";
import { mount } from "./harness";
import { made, messages, PG, run } from "./session-helpers";

type Params = Record<string, unknown>;

async function consoleWith(
  answers: { save?: string; open?: string },
  files: Record<string, string>,
) {
  const asked: Params[] = [];
  const m = await mount({
    store: { connections: [PG] },
    script: (sql) =>
      /^copy items to/iu.test(sql)
        ? { copy: { direction: "out", data: "1\tone\n2\ttwo\n" } }
        : /^copy items from/iu.test(sql)
          ? { copy: { direction: "in", columns: 2 } }
          : {},
    handlers: {
      "dialog.save": (params) => {
        asked.push({ dialog: "save", ...params });
        return answers.save ? { cancelled: false, path: answers.save } : { cancelled: true };
      },
      "dialog.open": (params) => {
        asked.push({ dialog: "open", ...params });
        return answers.open
          ? { cancelled: false, paths: [answers.open] }
          : { cancelled: true, paths: [] };
      },
      "fs.write": ({ path, content, append, scope }) => {
        asked.push({ write: path, scope });
        files[path] = append ? `${files[path] ?? ""}${content}` : content;
        return { bytesWritten: content.length };
      },
      "fs.read": ({ path, offset = 0, length }) => {
        const text = files[path] ?? "";
        const part = text.slice(offset, length === undefined ? undefined : offset + length);
        return { content: btoa(part), encoding: "base64", size: text.length };
      },
    },
  });
  const bars: (Bar | null)[] = [];
  (m.view as unknown as { copying(bar: Bar | null): void }).copying = (bar) => bars.push(bar);
  await m.host.command("endue.database.console", { connection: PG.name });
  return { m, asked, bars };
}

describe("a console's COPY", () => {
  it("COPY TO STDOUT asks where to save, writes that path alone and shows the bytes", async () => {
    const files: Record<string, string> = {};
    const { m, asked, bars } = await consoleWith({ save: "~/Downloads/items.txt" }, files);
    await run(m, "copy items to stdout");
    expect(asked[0]).toMatchObject({ dialog: "save", suggestedName: "items.txt" });
    expect(asked[1]).toEqual({
      write: "~/Downloads/items.txt",
      scope: { permission: "fs:write", paths: ["~/Downloads/items.txt"] },
    });
    expect(files["~/Downloads/items.txt"]).toBe("1\tone\n2\ttwo\n");
    expect(bars[0]).toEqual({ label: "COPY to items.txt", detail: "1 KiB written" });
    expect(bars.at(-1)).toBeNull();
    expect(messages(m).join("\n")).toMatch(/COPY: 2 rows/u);
  });

  it("COPY FROM STDIN asks for the file, streams it in and shows its share", async () => {
    const files: Record<string, string> = { "~/data/items.txt": "1\tone\n2\ttwo\n3\tthree\n" };
    const { m, asked, bars } = await consoleWith({ open: "~/data/items.txt" }, files);
    await run(m, "copy items from stdin");
    expect(asked[0]).toMatchObject({ dialog: "open" });
    const sent = made(m, "db.copy");
    expect(atob(String(sent[0]?.data))).toBe(files["~/data/items.txt"]);
    expect(sent.at(-1)).toMatchObject({ done: true });
    expect(bars[0]).toMatchObject({ value: 0, max: 20, detail: "1 KiB of 1 KiB sent" });
    expect(bars).toContainEqual({
      label: "COPY from items.txt",
      value: 20,
      max: 20,
      detail: "1 KiB of 1 KiB sent",
    });
    expect(messages(m).join("\n")).toMatch(/COPY: 3 rows/u);
  });

  it("a dialog cancelled runs nothing", async () => {
    const { m } = await consoleWith({}, {});
    await expect(run(m, "copy items to stdout")).rejects.toThrow(/Not copied/u);
    await expect(run(m, "copy items from stdin")).rejects.toThrow(/Not copied/u);
    expect(made(m, "db.run").filter((p) => /copy/u.test(String(p.sql)))).toEqual([]);
  });

  it("suggests the table's name and the format's extension", () => {
    const name = (sql: string) => copyName(split(sql, "postgresql")[0] as never);
    expect(name("copy public.items to stdout with (format csv, header)")).toBe("items.csv");
    expect(name('copy "My Items" to stdout')).toBe("My-Items.txt");
    expect(name("copy (select 1) to stdout (format binary)")).toBe("copy.bin");
  });
});
