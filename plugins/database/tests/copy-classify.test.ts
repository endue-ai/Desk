// What a COPY through standard input or output is to the guards (PG-23): COPY ... TO STDOUT reads
// unless its query writes, COPY ... FROM STDIN writes, so a read-only connection refuses it; a COPY
// to or from a file or a program on the server stays a write, asked on production; one among other
// statements, or an agent's, is refused in words.
import { describe, expect, it } from "vitest";
import { copyStep } from "../ui/copy/plan.js";
import { copyOf } from "../ui/copy/statement.js";
import { classify } from "../ui/sql/classify.js";
import { split } from "../ui/sql/split.js";
import { mount } from "./harness";
import { PG } from "./session-helpers";

const one = (sql: string) => {
  const [statement] = split(sql, "postgresql");
  if (!statement) throw new Error(`no statement in ${sql}`);
  return statement;
};

describe("a COPY through standard input or output", () => {
  it("runs: COPY TO STDOUT reads unless its query writes, COPY FROM STDIN writes", () => {
    const out = classify(one("copy items to stdout with (format csv)"), "postgresql");
    expect(out).toMatchObject({
      kind: "read",
      refused: expect.stringMatching(/alone from a console/u),
    });
    expect(classify(one("COPY (SELECT * FROM items) TO STDOUT"), "postgresql").kind).toBe("read");
    expect(classify(one("copy (delete from items returning *) to stdout"), "postgresql").kind).toBe(
      "write",
    );
    expect(classify(one("copy items (id, name) from stdin"), "postgresql")).toMatchObject({
      kind: "write",
      refused: expect.stringMatching(/alone from a console/u),
    });
    expect(classify(one("copy items to '/tmp/items.csv'"), "postgresql").kind).toBe("write");
    expect(classify(one("copy items from program 'cat x'"), "postgresql").kind).toBe("write");
    expect(copyOf(one("copy items to stdout"))).toBe("out");
    expect(copyOf(one("copy public.items from stdin csv header"))).toBe("in");
    expect(copyOf(one("copy items to '/tmp/x'"))).toBeUndefined();
    expect(copyOf(one("select 'copy t from stdin'"))).toBeUndefined();
  });

  it("runs alone, never for an agent, and with a sink or source that fits", () => {
    const copy = one("copy items to stdout");
    expect(copyStep("postgresql", [copy], {})).toMatchObject({ direction: "out" });
    expect(copyStep("postgresql", [one("select 1"), copy], {})).toBe(
      "Statement 2: a COPY through standard input or output runs on its own, so its file is chosen for it. Run it alone.",
    );
    expect(copyStep("postgresql", [copy], { agent: true })).toMatch(/agent cannot/u);
    const source = { read: async () => undefined };
    expect(copyStep("postgresql", [copy], { copy: { source } })).toMatch(/no place to write/u);
    expect(copyStep("postgresql", [one("select 1")], { copy: { source } })).toMatch(
      /Nothing to copy/u,
    );
    expect(copyStep("mysql", [copy], {})).toBeUndefined();
  });

  it("a read-only connection runs COPY TO STDOUT and refuses COPY FROM STDIN", async () => {
    const saved: string[] = [];
    const m = await mount({
      store: { connections: [{ ...PG, readOnly: true }] },
      script: (sql) =>
        sql.startsWith("copy items to")
          ? { copy: { direction: "out", data: "1\tone\n" } }
          : sql.startsWith("copy items from")
            ? { copy: { direction: "in", columns: 2 } }
            : {},
      handlers: {
        "dialog.save": () => ({ cancelled: false, path: "~/Downloads/items.txt" }),
        "fs.write": ({ path, content }) => {
          saved.push(`${path}:${content}`);
          return { bytesWritten: content.length };
        },
      },
    });
    await m.host.command("endue.database.console", { connection: PG.name });
    m.view.text = "copy items to stdout";
    await m.host.command("endue.database.run-all");
    expect(saved).toEqual(["~/Downloads/items.txt:1\tone\n"]);
    m.view.text = "copy items from stdin";
    await expect(m.host.command("endue.database.run-all")).rejects.toThrow(
      /Shop is read-only: statement 1 \(COPY\) may change it/u,
    );
  });

  it("a COPY to a server file is asked on production, and one among others is refused", async () => {
    const m = await mount({
      store: { connections: [{ ...PG, tag: "production" }] },
      pick: () => "no",
    });
    await m.host.command("endue.database.console", { connection: PG.name });
    m.view.text = "copy items to '/srv/items.csv'";
    await expect(m.host.command("endue.database.run-all")).rejects.toThrow(/Not run/u);
    expect(m.picks.at(-1)?.title).toBe("Run this statement on Shop?");
    m.view.text = "select 1; copy items from stdin";
    await expect(m.host.command("endue.database.run-all")).rejects.toThrow(/runs on its own/u);
    expect(m.sessions()).toHaveLength(0);
  });
});
