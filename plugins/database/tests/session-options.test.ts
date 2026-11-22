// A PostgreSQL connection's session options (PG-12): the search path, a role, the time zone, the lock
// and idle-in-transaction timeouts, the application name and a startup script, kept only when set
// and checked field by field; a URI's `options` and `application_name` read and written; and the
// startup script held to a console statement's guards on a read-only or production connection.
import { describe, expect, it } from "vitest";
import { formatUri, normalize, parseUri, SIGN_IN } from "../ui/connections.js";
import type { Connection } from "../ui/engines/common.js";
import { headerOf, pathOf, sessionSettings, startupStatements } from "../ui/engines/pg-options.js";

const base = {
  id: "c-shop",
  name: "Shop",
  engine: "postgresql" as const,
  host: "db.example",
  database: "shop",
  user: "app",
};
const conn = (more: Record<string, unknown> = {}) =>
  normalize({ ...base, ...more } as Partial<Connection>) as Connection & Record<string, unknown>;

describe("a connection's session options", () => {
  it("keeps each option a PostgreSQL connection sets, and nothing when none is set", () => {
    const plain = conn();
    for (const key of [
      "searchPath",
      "role",
      "timeZone",
      "lockTimeout",
      "idleTimeout",
      "applicationName",
      "startup",
    ])
      expect(key in plain, key).toBe(false);
    const full = conn({
      searchPath: ' app,  "Sales Data" , public ',
      role: "reporting",
      timeZone: "Asia/Seoul",
      lockTimeout: "5 s",
      idleTimeout: "60000",
      applicationName: "shop report",
      startup: "set work_mem = '64MB';\nselect set_config('app.tenant', '7', false);",
      group: "",
    });
    expect(full).toMatchObject({
      searchPath: 'app, "Sales Data", public',
      role: "reporting",
      timeZone: "Asia/Seoul",
      lockTimeout: "5s",
      idleTimeout: "60000",
      applicationName: "shop report",
      startup: "set work_mem = '64MB';\nselect set_config('app.tenant', '7', false);",
    });
    // Empty fields are not kept, so the connection reads as one that never set them.
    expect("role" in conn({ role: "  ", searchPath: "" })).toBe(false);
  });

  it("leaves them off other engines", () => {
    const mysql = normalize({
      ...base,
      engine: "mysql",
      searchPath: "app",
      role: "x",
    } as Partial<Connection>);
    expect("searchPath" in mysql || "role" in mysql).toBe(false);
  });

  it("names the field that is wrong", () => {
    expect(() => conn({ searchPath: "app,,public" })).toThrow(/^Search path:/u);
    expect(() => conn({ searchPath: '"open' })).toThrow(/^Search path:/u);
    expect(() => conn({ role: "a\nb" })).toThrow(/^Role:/u);
    expect(() => conn({ role: "r".repeat(64) })).toThrow(/^Role: at most 63/u);
    expect(() => conn({ timeZone: "Asia Seoul" })).toThrow(/^Time zone:/u);
    expect(() => conn({ lockTimeout: "soon" })).toThrow(/^Lock timeout:/u);
    expect(() => conn({ idleTimeout: "5 weeks" })).toThrow(/^Idle in transaction timeout:/u);
    expect(() => conn({ applicationName: "a".repeat(64) })).toThrow(/^Application name:/u);
    expect(() => conn({ startup: "x".repeat(8001) })).toThrow(/^Startup script: at most/u);
  });

  it("a changed option closes the connection's sessions on Save", () => {
    for (const key of ["searchPath", "role", "timeZone", "lockTimeout", "idleTimeout"])
      expect(SIGN_IN as readonly string[]).toContain(key);
    expect(SIGN_IN as readonly string[]).toContain("applicationName");
    expect(SIGN_IN as readonly string[]).toContain("startup");
  });
});

describe("the startup script's guards", () => {
  it("refuses a statement that writes on a read-only connection, naming it", () => {
    expect(() =>
      conn({ readOnly: true, startup: "set search_path = app;\ninsert into log values (1)" }),
    ).toThrow(/^Startup script: statement 2 \(INSERT\) may change data, and Shop is read-only\./u);
    expect(conn({ readOnly: true, startup: "set work_mem = '8MB'" }).startup).toBe(
      "set work_mem = '8MB'",
    );
  });

  it("refuses a statement that writes on a production connection", () => {
    expect(() => conn({ tag: "production", startup: "create table t (id int)" })).toThrow(
      /^Startup script: statement 1 \(CREATE\) may change data, and Shop is tagged production\./u,
    );
    expect(conn({ tag: "staging", startup: "create temp table t (id int)" }).startup).toBe(
      "create temp table t (id int)",
    );
  });

  it("refuses BEGIN, COMMIT and what no run may send, on any connection", () => {
    expect(() => conn({ startup: "begin" })).toThrow(/^Startup script: statement 1 \(BEGIN\)/u);
    expect(() => conn({ startup: "set a.b = 1; commit" })).toThrow(/statement 2 \(COMMIT\)/u);
    expect(() => conn({ startup: "copy t from stdin" })).toThrow(/^Startup script: statement 1:/u);
  });

  it("splits the script into the statements each session runs first", () => {
    const statements = startupStatements(
      conn({ startup: "set work_mem = '8MB';\n\n-- tenant\nselect set_config('a.t', '7', false)" }),
    );
    expect(statements.map((s) => s.text)).toEqual([
      "set work_mem = '8MB'",
      "-- tenant\nselect set_config('a.t', '7', false)",
    ]);
    expect(startupStatements(conn())).toEqual([]);
  });
});

describe("the options as the session's startup parameters", () => {
  it("names each one as PostgreSQL does", () => {
    expect(
      sessionSettings(
        conn({
          searchPath: "app, public",
          role: "reporting",
          timeZone: "UTC",
          lockTimeout: "5s",
          idleTimeout: "1min",
          applicationName: "shop report",
        }),
      ),
    ).toEqual({
      search_path: "app, public",
      role: "reporting",
      TimeZone: "UTC",
      lock_timeout: "5s",
      idle_in_transaction_session_timeout: "1min",
      application_name: "shop report",
    });
    expect(sessionSettings(conn())).toEqual({});
  });

  it("reads unqualified names on the connection's search path, as its role", () => {
    expect(pathOf(conn())).toEqual({ searchPath: ["$user", "public"], user: "app" });
    expect(pathOf(conn({ searchPath: 'App, "Sales Data", $user', role: "Reporting" }))).toEqual({
      searchPath: ["app", "Sales Data", "$user"],
      user: "Reporting",
    });
  });

  it("the header says the role and the search path when the connection sets them", () => {
    expect(headerOf(conn())).toBe("");
    expect(headerOf(conn({ role: "reporting" }))).toBe("as reporting");
    expect(headerOf(conn({ searchPath: "app, public", role: "reporting" }))).toBe(
      "as reporting · app, public",
    );
    expect(headerOf(conn({ searchPath: "app" }))).toBe("app");
  });
});

describe("a URI's options and application name", () => {
  it("reads -c settings and application_name into the fields", () => {
    const { fields } = parseUri(
      "postgresql://app@db.example/shop?application_name=shop%20report&options=-c%20search_path%3Dapp%2Cpublic%20-c%20role%3Dreporting%20--TimeZone%3DUTC%20-c%20lock_timeout%3D5s%20-c%20idle_in_transaction_session_timeout%3D1min",
    );
    expect(fields).toMatchObject({
      applicationName: "shop report",
      searchPath: "app,public",
      role: "reporting",
      timeZone: "UTC",
      lockTimeout: "5s",
      idleTimeout: "1min",
    });
  });

  it("reads a backslash-escaped space inside a value", () => {
    const options = encodeURIComponent(String.raw`-c search_path=app,"Sales\ Data"`);
    const { fields } = parseUri(`postgresql://app@db.example/shop?options=${options}`);
    // The quotes go through to the server: the search path holds a quoted name.
    expect(fields.searchPath).toBe('app,"Sales Data"');
  });

  it("refuses a setting it does not keep, naming it", () => {
    expect(() =>
      parseUri("postgresql://app@db.example/shop?options=-c%20work_mem%3D64MB"),
    ).toThrow(/options: work_mem is not one of the connection's session options/u);
  });

  it("writes them back, and a round trip keeps them", () => {
    const c = conn({
      searchPath: 'app, "Sales Data"',
      role: "reporting",
      timeZone: "UTC",
      lockTimeout: "5s",
      idleTimeout: "1min",
      applicationName: "shop report",
    });
    const uri = formatUri(c);
    expect(new URL(uri).searchParams.get("application_name")).toBe("shop report");
    expect(new URL(uri).searchParams.get("options")).toBe(
      String.raw`-c search_path=app,\ "Sales\ Data" -c role=reporting -c TimeZone=UTC -c lock_timeout=5s -c idle_in_transaction_session_timeout=1min`,
    );
    const back = conn(parseUri(uri).fields);
    for (const key of ["role", "timeZone", "lockTimeout", "idleTimeout", "applicationName"])
      expect(back[key], key).toBe(c[key]);
    expect(pathOf(back).searchPath).toEqual(["app", "Sales Data"]);
    expect(formatUri(conn())).toBe("postgresql://app@db.example/shop");
  });
});
