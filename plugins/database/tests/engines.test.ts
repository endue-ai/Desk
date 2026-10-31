// Each engine's plan and reading, on output captured from the real clients (psql 17, mysql 8.4 and
// mariadb 11, sqlite3 3.50).
import { describe, expect, it } from "vitest";
import type { Connection, Invocation, Outcome } from "../ui/engines/common.js";
import { mysql, sslArgs } from "../ui/engines/mysql.js";
import { postgres, sqlError } from "../ui/engines/postgres.js";
import { readMysqlXml, readQuoted } from "../ui/engines/readers.js";
import { sqlite, sqliteError } from "../ui/engines/sqlite.js";
import { readCsv } from "../ui/engines/text.js";
import { split } from "../ui/sql/split.js";

const conn = (fields: Partial<Connection>): Connection => ({
  id: "c-1",
  name: "t",
  engine: "postgresql",
  host: "db",
  port: 5432,
  database: "app",
  user: "me",
  ssl: "default",
  sslCa: "",
  file: "",
  tag: "none",
  readOnly: false,
  ...fields,
});
const outcome = (fields: Partial<Outcome>): Outcome => ({
  code: 0,
  signal: null,
  stdout: "",
  stderr: "",
  stopped: false,
  cancelled: false,
  timedOut: false,
  overflow: false,
  ms: 5,
  ...fields,
});
const plan = (
  engine: typeof postgres | typeof mysql | typeof sqlite,
  c: Connection,
  sql: string,
  single = false,
): Invocation =>
  engine.plan(c, {
    statements: split(sql, engine.dialect),
    maxRows: 2,
    timeoutMs: 0,
    password: "pw",
    mode: "run",
    nonce: "n0nce",
    single,
  });

describe("postgres", () => {
  it("passes each statement as its own -c, connection values as environment, never as options", () => {
    const run = plan(
      postgres,
      conn({ readOnly: true, ssl: "require", host: "-oops" }),
      "select 1; select 2",
    );
    expect(run.args).toEqual([
      "-X",
      "-w",
      "-q",
      "--csv",
      "-P",
      "null=@@null:n0nce",
      "-v",
      "ON_ERROR_STOP=1",
      "-v",
      "FETCH_COUNT=3",
      "-c",
      "select 1",
      "-c",
      "\\echo @@endue:n0nce:0 :ROW_COUNT",
      "-c",
      "\\warn @@endue:n0nce:0",
      "-c",
      "select 2",
      "-c",
      "\\echo @@endue:n0nce:1 :ROW_COUNT",
      "-c",
      "\\warn @@endue:n0nce:1",
    ]);
    expect(run.env).toMatchObject({
      PGHOST: "-oops",
      PGPASSWORD: "pw",
      PGSSLMODE: "require",
      PGOPTIONS: "-c default_transaction_read_only=on",
    });
  });

  it("reads rows, NULL apart from '', notices by statement, and the error with its position", () => {
    const run = plan(
      postgres,
      conn({}),
      "select 1 as a, null as b, '' as c, 'x,\"y\"' as d;\nupdate t set a = 1;\nselec 1;\nselect 4",
    );
    const read = postgres.parse(
      outcome({
        code: 1,
        stdout: 'a,b,c,d\n1,@@null:n0nce,,"x,""y"""\n@@endue:n0nce:0 1\n@@endue:n0nce:1 7\n',
        stderr:
          '@@endue:n0nce:0\nNOTICE:  touched\n@@endue:n0nce:1\nERROR:  syntax error at or near "selec"\nLINE 1: selec 1\n        ^\n',
      }),
      run,
      0,
    );
    const [select, update, wrong, after] = read.statements;
    expect(select?.sets[0]).toEqual({
      columns: ["a", "b", "c", "d"],
      rows: [["1", null, "", 'x,"y"']],
      truncated: false,
    });
    expect(update).toMatchObject({ affected: 7, notices: ["NOTICE:  touched"] });
    expect(wrong?.error).toEqual({
      kind: "sql",
      message: 'syntax error at or near "selec"',
      position: 0,
    });
    expect(after?.ran).toBe(false);
  });

  it("finds the caret in a later line and keeps DETAIL and HINT", () => {
    const error = sqlError(
      'ERROR:  column "nope" does not exist\nLINE 2:   where nope = 1\n                ^\nHINT:  Perhaps you meant "note".\n',
      "select *\n  where nope = 1",
    );
    expect(error).toEqual({
      kind: "sql",
      message: 'column "nope" does not exist',
      detail: 'HINT:  Perhaps you meant "note".',
      position: 17,
    });
  });

  it("says a connection that never stood up, and an authentication failure as such", () => {
    const run = plan(postgres, conn({}), "select 1");
    const read = postgres.parse(
      outcome({
        code: 2,
        stderr:
          'psql: error: connection to server at "db" (10.0.0.1), port 5432 failed: FATAL:  password authentication failed for user "me"\n',
      }),
      run,
      0,
    );
    expect(read.error).toMatchObject({ kind: "auth" });
    expect(read.statements[0]?.ran).toBe(false);
  });

  it("keeps the rows of a single read it stopped, marked as more", () => {
    const run = plan(postgres, conn({}), "select g from big", true);
    expect(run.stopAfter).toBe(4);
    const read = postgres.parse(
      outcome({ code: null, signal: "int", stopped: true, stdout: "g\n1\n2\n3\n4" }),
      run,
      0,
    );
    expect(read.statements[0]?.sets[0]).toEqual({
      columns: ["g"],
      rows: [["1"], ["2"]],
      truncated: true,
    });
    expect(read.statements[0]?.error).toBeUndefined();
  });
});

describe("mysql", () => {
  const xml = [
    '<?xml version="1.0"?>\n\n<resultset statement="select 1 as a, null as b" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">',
    '  <row>\n\t<field name="a">1</field>\n\t<field name="b" xsi:nil="true" />\n\t<field name="c"></field>\n\t<field name="d">NULL</field>\n\t<field name="e">&lt;&amp;&quot;x</field>\n  </row>\n</resultset>',
    '<?xml version="1.0"?>\n\n<resultset statement="select row_count()" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">\n  <row>\n\t<field name="@@endue:n0nce:0">-1</field>\n\t<field name="w">0</field>\n  </row>\n</resultset>',
    '<?xml version="1.0"?>\n\n<resultset statement="select row_count()" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">\n  <row>\n\t<field name="@@endue:n0nce:1">3</field>\n\t<field name="w">1</field>\n  </row>\n</resultset>',
  ].join("\n");

  it("writes one -e script under a short DELIMITER, with the client's commands off", () => {
    const run = plan(mysql, conn({ engine: "mysql", port: 3306 }), "select 1;\nupdate t set a = 1");
    expect(run.args.slice(0, 9)).toEqual([
      "--batch",
      "--xml",
      "--binary-as-hex",
      "--binary-mode",
      "--local-infile=0",
      "--skip-reconnect",
      "--comments",
      "--default-character-set=utf8mb4",
      "--connect-timeout=10",
    ]);
    expect(run.args).toContain("--host=db");
    const script = run.args.at(-1) ?? "";
    const delimiter = /^DELIMITER (\S+)$/mu.exec(script)?.[1] ?? "";
    expect(delimiter.length).toBeLessThanOrEqual(15);
    expect(script).toContain(`SET SESSION sql_select_limit = 3 ${delimiter}`);
    expect(script).toContain(`update t set a = 1\n${delimiter}`);
    expect(run.env).toEqual({ MYSQL_PWD: "pw" });
  });

  it("reads NULL, '', 'NULL' and entities apart, and rows affected and warnings by marker", () => {
    const [first] = readMysqlXml(xml);
    expect(first?.table.rows).toEqual([["1", null, "", "NULL", '<&"x']]);
    const run = plan(
      mysql,
      conn({ engine: "mysql" }),
      "select 1 as a, null as b;\nupdate t set a = 1",
    );
    const read = mysql.parse(outcome({ stdout: xml }), run, 0);
    expect(read.statements[0]?.sets[0]?.columns).toEqual(["a", "b", "c", "d", "e"]);
    expect(read.statements[1]).toMatchObject({ affected: 3, warnings: 1, sets: [] });
  });

  it("puts the client's error on the statement, and a refused connection on the run", () => {
    const run = plan(mysql, conn({ engine: "mysql" }), "select 1;\nselec 2");
    const head = xml.split("\n<?xml")[0] ?? "";
    const marker = `${head.replace(/<resultset[\s\S]*/u, "")}<resultset statement="x">\n  <row>\n\t<field name="@@endue:n0nce:0">-1</field>\n\t<field name="w">0</field>\n  </row>\n</resultset>`;
    const failed = mysql.parse(
      outcome({
        code: 1,
        stdout: marker,
        stderr:
          "ERROR 1064 (42000) at line 6: You have an error in your SQL syntax; check the manual that corresponds to your MySQL server version for the right syntax to use near 'selec 2' at line 1\n",
      }),
      run,
      0,
    );
    expect(failed.statements[1]?.error).toMatchObject({
      kind: "sql",
      code: "1064 (42000)",
      position: 0,
    });
    const denied = mysql.parse(
      outcome({
        code: 1,
        stderr: "ERROR 1045 (28000): Access denied for user 'me'@'10.0.0.2' (using password: NO)\n",
      }),
      run,
      0,
    );
    expect(denied.error).toMatchObject({ kind: "auth", code: "1045" });
  });

  it("maps TLS modes to each client's options", () => {
    expect(sslArgs(conn({ ssl: "verify-full", sslCa: "/ca.pem" }), "mysql")).toEqual([
      "--ssl-mode=VERIFY_IDENTITY",
      "--ssl-ca=/ca.pem",
    ]);
    expect(sslArgs(conn({ ssl: "require" }), "mariadb")).toEqual([
      "--ssl",
      "--skip-ssl-verify-server-cert",
    ]);
    expect(sslArgs(conn({ ssl: "disable" }), "mariadb")).toEqual(["--skip-ssl"]);
    expect(sslArgs(conn({}), "mysql")).toEqual([]);
  });
});

describe("sqlite", () => {
  it("runs in safe mode, each statement its own argument with a total_changes() marker", () => {
    const run = plan(
      sqlite,
      conn({ engine: "sqlite", file: "~/data/app.db", readOnly: true }),
      "select 1; delete from t where id = 1",
    );
    expect(run.args).toEqual([
      "-safe",
      "-batch",
      "-bail",
      "-readonly",
      "./data/app.db",
      ".mode quote",
      ".headers on",
      ".timeout 5000",
      "select 1",
      'SELECT total_changes() AS "@@endue:n0nce:0"',
      "delete from t where id = 1",
      'SELECT total_changes() AS "@@endue:n0nce:1"',
    ]);
  });

  it("reads literals: NULL, text, reals shortened, blobs as hex, unistr() and replace()", () => {
    expect(
      readQuoted(
        "'a','b','c','d','e'\nNULL,'it''s',0.1000000000000000055,X'00ff',unistr('x\ny\\u000d')\nreplace('a\\nb','\\n',char(10)),'',12345678901234567170.0,2.0,-0.5\n",
      ),
    ).toEqual([
      ["a", "b", "c", "d", "e"],
      [null, "it's", "0.1", "0x00FF", "x\ny\r"],
      ["a\nb", "", "12345678901234567000", "2.0", "-0.5"],
    ]);
  });

  it("counts changed rows from the totals and reads the error under -bail", () => {
    const run = plan(
      sqlite,
      conn({ engine: "sqlite", file: "/a.db" }),
      "update t set a = 1;\nselec 2;\nselect 3",
    );
    const read = sqlite.parse(
      outcome({
        code: 1,
        stdout: "'@@endue:n0nce:0'\n4\n",
        stderr: 'Error: in prepare, near "selec": syntax error\n  selec 2\n  ^--- error here\n',
      }),
      run,
      0,
    );
    expect(read.statements[0]).toMatchObject({ affected: 4, sets: [] });
    expect(read.statements[1]?.error).toEqual({
      kind: "sql",
      message: 'near "selec": syntax error',
      position: 0,
    });
    expect(read.statements[2]?.ran).toBe(false);
    expect(sqliteError("Runtime error: UNIQUE constraint failed: t.id (19)\n")).toEqual({
      kind: "sql",
      message: "UNIQUE constraint failed: t.id",
      code: "19",
    });
  });
});

describe("readCsv", () => {
  it("keeps quoted line breaks and drops a cut record when asked", () => {
    expect(readCsv('a,b\n"x\ny",2\n')).toEqual([
      ["a", "b"],
      ["x\ny", "2"],
    ]);
    expect(readCsv('a\n1\n"cut', true)).toEqual([["a"], ["1"]]);
  });
});
