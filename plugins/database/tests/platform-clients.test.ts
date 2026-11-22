// PG-102: PostgreSQL's programs (pg_dump, pg_restore) found where each system installs them, the
// missing-program sentence in the system's own words, a version line with Windows line endings, and
// the platform told from navigator.platform. Runs on any system: the platform is a parameter.
import { describe, expect, it } from "vitest";
import {
  createClients,
  INSTALL_FOLDERS,
  installHint,
  parseProgram,
  parseVersion,
  platformOf,
  searchPath,
} from "../ui/clients.js";
import { fromValues } from "../ui/settings.js";

const MAJORS = [19, 18, 17, 16, 15, 14, 13];

/** A runner whose program answers `--version` with `text`, or is missing. */
function runnerSaying(text: string | undefined, seen: string[] = []) {
  return {
    run: async (invocation: { command: string }) => {
      seen.push(invocation.command);
      if (text === undefined)
        throw Object.assign(new Error(`${invocation.command} was not found.`), { kind: "missing" });
      return { stdout: text, stderr: "", code: 0 } as never;
    },
  };
}

describe("PostgreSQL's programs on each system", () => {
  it("finds PostgreSQL's programs in each system's usual folders", () => {
    const windows = MAJORS.map((n) => `C:\\Program Files\\PostgreSQL\\${n}\\bin`);
    expect(INSTALL_FOLDERS.windows.filter((f) => f.includes("PostgreSQL"))).toEqual(windows);
    const debian = MAJORS.map((n) => `/usr/lib/postgresql/${n}/bin`);
    const redHat = MAJORS.map((n) => `/usr/pgsql-${n}/bin`);
    expect(INSTALL_FOLDERS.linux.filter((f) => f.startsWith("/usr/lib/postgresql/"))).toEqual(
      debian,
    );
    expect(INSTALL_FOLDERS.linux.filter((f) => f.startsWith("/usr/pgsql-"))).toEqual(redHat);
    const kegs = MAJORS.map((n) => `/opt/homebrew/opt/postgresql@${n}/bin`);
    expect(INSTALL_FOLDERS.mac.filter((f) => f.startsWith("/opt/homebrew/opt/postgresql@"))).toEqual(
      kegs,
    );
    // The settings' folders first; Windows separates PATH with `;`, the others with `:`.
    const path = searchPath("windows", ["D:\\pg\\bin"]).split(";");
    expect(path[0]).toBe("D:\\pg\\bin");
    expect(path.slice(1, 3)).toEqual(windows.slice(0, 2));
    expect(searchPath("linux", ["/opt/pg/bin"]).split(":")[0]).toBe("/opt/pg/bin");
    expect(searchPath("linux", [])).not.toContain(";");
  });

  it("says how to install a program in the words of the system", async () => {
    const windows = installHint("pg_dump", "windows");
    expect(windows).toContain("C:\\Program Files\\PostgreSQL\\<version>\\bin");
    expect(windows).not.toMatch(/brew|apt/u);
    expect(installHint("pg_restore", "linux")).toBe(
      "Install pg_restore: brew install libpq, or apt install postgresql-client.",
    );
    expect(installHint("pg_dump", "mac")).toBe(
      "Install pg_dump: brew install libpq, or apt install postgresql-client.",
    );
    // The clients say it: a missing pg_dump on Windows.
    const clients = createClients(runnerSaying(undefined), () => fromValues({}), "windows");
    await expect(clients.program("pg_dump")).rejects.toThrow(windows);
  });

  it("reads a version line ending in CRLF", async () => {
    expect(parseProgram("pg_dump (PostgreSQL) 17.2\r")).toEqual({
      flavor: "postgresql",
      version: "17.2",
    });
    expect(parseVersion("3.45.1 2024-01-30 16:01:20 e876e51a0ed5c5b3126f52e532044363a014bc594cfefa87ffb5b82257ccalt1\r")).toEqual({
      flavor: "sqlite",
      version: "3.45.1",
    });
    const seen: string[] = [];
    const clients = createClients(
      runnerSaying("pg_dump (PostgreSQL) 17.2\r\nmore\r\n", seen),
      () => fromValues({ "endue.database.pg-dump": "C:\\Program Files\\PostgreSQL\\17\\bin\\pg_dump.exe" }),
      "windows",
    );
    expect(await clients.program("pg_dump")).toEqual({
      command: "C:\\Program Files\\PostgreSQL\\17\\bin\\pg_dump.exe",
      flavor: "postgresql",
      version: "17.2",
    });
    // A full path with .exe from the setting is run as it is, nothing added.
    expect(seen).toEqual(["C:\\Program Files\\PostgreSQL\\17\\bin\\pg_dump.exe"]);
  });

  it("tells the platform from navigator.platform", () => {
    expect(platformOf("Win32")).toBe("windows");
    expect(platformOf("Windows")).toBe("windows");
    expect(platformOf("Linux x86_64")).toBe("linux");
    expect(platformOf("Linux aarch64")).toBe("linux");
    expect(platformOf("MacIntel")).toBe("mac");
    expect(platformOf("")).toBe("linux");
    expect(platformOf(undefined)).toBe("linux");
  });
});
