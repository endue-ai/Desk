import { describe, expect, it } from "vitest";
import {
  BridgeClient,
  browserStub,
  type DbConnectPermission,
  type StubDatabase,
  stubCommands,
} from "./index";

// The stub's cursors (stub-db-cursor.ts): DECLARE over the script's answer, FETCH, MOVE and CLOSE
// as the server answers them, dropped at the end of the transaction.
const DB = { caller: "example.database" };
const scope: DbConnectPermission = { permission: "db:connect", hosts: ["db.example.test:5432"] };
const column = {
  name: "n",
  typeOid: 23,
  typeModifier: -1,
  typeSize: 4,
  tableOid: 0,
  columnNumber: 0,
};
const SCRIPT: StubDatabase = {
  statements: [
    { sql: "select n", columns: [column], rows: Array.from({ length: 25 }, (_, i) => [String(i)]) },
    {
      sql: "select nope",
      error: {
        severity: "ERROR",
        localSeverity: "ERROR",
        code: "42703",
        message: 'column "nope" does not exist',
        position: 8,
      },
    },
  ],
};

async function setup() {
  const core = stubCommands(() => {}, { grants: { [DB.caller]: [scope] }, db: SCRIPT });
  const client = new BridgeClient(browserStub(core.handlers));
  const params = { engine: "postgresql", host: "db.example.test", database: "shop", user: "r" };
  const opened = await client.call("db.open", { ...params, scope }, DB);
  const sessionId = opened.sessionId ?? "";
  const run = (sql: string, pageRows = 1000) =>
    client.call("db.run", { sessionId, sql, pageRows }, DB);
  return { run };
}

const values = (page: { rows: (string | null)[][] }) => page.rows.map((r) => r[0]);

describe("the stub's cursors, as the server keeps them", () => {
  it("DECLARE needs a transaction block", async () => {
    const { run } = await setup();
    const page = await run("DECLARE c SCROLL CURSOR FOR\nselect n");
    expect(page.error?.code).toBe("25P01");
  });

  it("fetches forward, moves to a row and fetches from there, moves to the end", async () => {
    const { run } = await setup();
    await run("BEGIN");
    expect((await run("DECLARE c SCROLL CURSOR FOR\nselect n")).tag).toBe("DECLARE CURSOR");
    const first = await run("FETCH FORWARD 10 FROM c");
    expect(values(first)).toEqual(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]);
    expect(first.columns?.[0]?.name).toBe("n");
    expect(first.tag).toBe("FETCH 10");
    expect((await run("MOVE ABSOLUTE 20 IN c")).tag).toBe("MOVE 1");
    const rest = await run("FETCH FORWARD 10 FROM c");
    expect(values(rest)).toEqual(["20", "21", "22", "23", "24"]);
    expect((await run("FETCH FORWARD 10 FROM c")).rows).toEqual([]);
    await run("MOVE ABSOLUTE 3 IN c");
    expect((await run("MOVE FORWARD ALL IN c")).tag).toBe("MOVE 22");
    expect((await run("CLOSE c")).tag).toBe("CLOSE CURSOR");
    expect((await run("FETCH FORWARD 1 FROM c")).error?.code).toBe("34000");
  });

  it("pages a FETCH larger than the page, and the end of the transaction drops the cursor", async () => {
    const { run } = await setup();
    await run("BEGIN");
    await run("DECLARE c SCROLL CURSOR FOR\nselect n");
    const page = await run("FETCH FORWARD 20 FROM c", 5);
    expect(page.more).toBe(true);
    expect(page.rows).toHaveLength(5);
    await run("COMMIT");
    await run("BEGIN");
    expect((await run("FETCH FORWARD 1 FROM c")).error?.code).toBe("34000");
  });

  it("an error of the query is DECLARE's, its position counted in the DECLARE", async () => {
    const { run } = await setup();
    await run("BEGIN");
    const page = await run("DECLARE c SCROLL CURSOR FOR\nselect nope");
    expect(page.error?.position).toBe(8 + "DECLARE c SCROLL CURSOR FOR\n".length);
    expect(page.transaction).toBe("failed");
  });
});
