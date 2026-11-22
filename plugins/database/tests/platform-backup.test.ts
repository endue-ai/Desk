// PG-102: what the backup and restore forms show on each system. The exact command line is the one a
// terminal of that system runs from the home folder: POSIX shell words on macOS and Linux,
// PowerShell on Windows (`$env:` for libpq's variables, `&` to call the program, `'` doubled),
// never the password; and the password note names the password file libpq reads there.
import { describe, expect, it } from "vitest";
import { createClients } from "../ui/clients.js";
import { commandLine, powershellWord } from "../ui/features/backup/args.js";
import { passwordNote } from "../ui/features/backup/common.js";
import { fromValues } from "../ui/settings.js";

const ENV = {
  PGHOST: "db.example",
  PGPORT: "5432",
  PGDATABASE: "shop",
  PGUSER: "app",
  PGPASSWORD: "s3cret pass",
  PGAPPNAME: "endue Desk",
};

describe("the command line on each system", () => {
  it("shows the command line as PowerShell on Windows", () => {
    const line = commandLine(
      "C:\\Program Files\\PostgreSQL\\17\\bin\\pg_dump.exe",
      ["--format=custom", "--table=public.it's", "--file=./Backups/shop.dump", "--schema=a,b"],
      ENV,
      "windows",
    );
    expect(line).not.toContain("s3cret");
    expect(line).not.toContain("PGPASSWORD");
    expect(line).toBe(
      "$env:PGHOST='db.example'; $env:PGPORT='5432'; $env:PGDATABASE='shop'; $env:PGUSER='app'; $env:PGAPPNAME='endue Desk'; " +
        "& 'C:\\Program Files\\PostgreSQL\\17\\bin\\pg_dump.exe' --format=custom '--table=public.it''s' --file=./Backups/shop.dump '--schema=a,b'",
    );
    // A bare program name, and words PowerShell would read as something else, quoted.
    expect(commandLine("pg_dump", ["--verbose"], {}, "windows")).toBe("& pg_dump --verbose");
    expect(powershellWord("@args")).toBe("'@args'");
    expect(powershellWord("$x")).toBe("'$x'");
    expect(powershellWord("a;b")).toBe("'a;b'");
    expect(powershellWord("C:\\pg\\bin\\pg_dump.exe")).toBe("C:\\pg\\bin\\pg_dump.exe");
  });

  it("keeps POSIX shell words on macOS and Linux", () => {
    const posix =
      "PGHOST=db.example PGPORT=5432 PGDATABASE=shop PGUSER=app PGAPPNAME='endue Desk' pg_dump --verbose";
    expect(commandLine("pg_dump", ["--verbose"], ENV, "linux")).toBe(posix);
    expect(commandLine("pg_dump", ["--verbose"], ENV, "mac")).toBe(posix);
    expect(commandLine("pg_dump", ["--verbose"], ENV)).toBe(posix);
  });

  it("the backup's password note names the system's password file", () => {
    expect(passwordNote(undefined, "windows")).toBe(
      "No password given: libpq reads %APPDATA%\\postgresql\\pgpass.conf, else the server must not ask for one.",
    );
    expect(passwordNote(undefined, "linux")).toBe(
      "No password given: libpq reads ~/.pgpass, else the server must not ask for one.",
    );
    expect(passwordNote("typed", "windows")).toMatch(/PGPASSWORD of the program's environment only/u);
  });

  it("the clients say which system they find programs on, for the forms", () => {
    const runner = { run: async () => ({}) as never };
    expect(createClients(runner, () => fromValues({}), "windows").platform).toBe("windows");
    expect(createClients(runner, () => fromValues({})).platform).toBe("mac");
  });
});
