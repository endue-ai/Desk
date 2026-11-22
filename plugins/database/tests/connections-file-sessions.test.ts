// An import that changes how a connection signs in closes its PostgreSQL sessions as Save does
// (#452 with PG-02, ADR 0320): a new name keeps them; another database asks first while a
// transaction is open, keeps everything as it was on no, and closes them on yes.
import { describe, expect, it } from "vitest";
import { FORMAT } from "../ui/features/connections-file/file.js";
import { mounted } from "./connections-file-harness";
import { closed, PG, run, script, sessionOf } from "./session-helpers";

const fileOf = (changes: Record<string, unknown>) =>
  JSON.stringify({ format: FORMAT, version: 1, connections: [{ ...PG, ...changes }] });

describe("an import over a connection with sessions", () => {
  it("closes them when how it signs in changes, asked first in a transaction", async () => {
    const answers: string[] = [];
    const files = {
      "~/rename.json": fileOf({ name: "Shop main" }),
      "~/move.json": fileOf({ name: "Shop main", database: "audit" }),
    };
    let path = "~/rename.json";
    const f = await mounted({
      connections: [PG],
      files,
      open: () => path,
      script,
      pick: () => answers.shift() ?? "yes",
      answer: () => ({ ticked: [0] }),
    });
    const openAt = (next: string) => {
      path = next;
    };
    await f.m.host.command("endue.database.console", { connection: "Shop" });
    await run(f.m, "select 1");
    const one = sessionOf(f.m, "select 1");

    openAt("~/rename.json");
    await f.m.host.command("endue.database.import-connections");
    await f.m.settle();
    expect(f.stored()[0]?.name).toBe("Shop main");
    expect(closed(f.m)).not.toContain(one);

    await run(f.m, "begin");
    openAt("~/move.json");
    answers.push("no");
    await expect(f.m.host.command("endue.database.import-connections")).rejects.toThrow(
      /Not imported: Shop main's sessions stay open/u,
    );
    expect(f.m.picks.at(-1)?.title).toBe("Import over Shop main?");
    expect(f.stored()[0]?.database).toBe("shop");
    expect(closed(f.m)).not.toContain(one);

    answers.push("yes");
    await f.m.host.command("endue.database.import-connections");
    await f.m.settle();
    expect(f.stored()[0]?.database).toBe("audit");
    expect(closed(f.m)).toContain(one);
  });
});
