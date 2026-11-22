// PG-102: paths and keys on each system. A path typed with Windows backslashes is read the way the
// bridge reads paths (forward slashes, as the desk's dialogs answer them); a file is named by its
// last part whichever separator it has; the password file is named where libpq reads it; Mod is
// Control on Windows and Linux and Command on macOS. Runs on any system.
import { describe, expect, it } from "vitest";
import type { Connection } from "../ui/engines/common.js";
import { createTls } from "../ui/engines/pg-tls.js";
import { pressOf } from "../ui/keys.js";
import { bridgePath, fileName, passwordFile } from "../ui/platform.js";

const CA = "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n";

describe("paths on each system", () => {
  it("writes a typed Windows path the way the bridge reads it", async () => {
    expect(bridgePath("C:\\certs\\ca.crt")).toBe("C:/certs/ca.crt");
    expect(bridgePath("d:\\Users\\ada\\client.key")).toBe("d:/Users/ada/client.key");
    expect(bridgePath("C:/certs/ca.crt")).toBe("C:/certs/ca.crt");
    expect(bridgePath("~/certs/ca.crt")).toBe("~/certs/ca.crt");
    expect(bridgePath("/etc/ssl/ca.crt")).toBe("/etc/ssl/ca.crt");
    // A backslash is a name's character outside a drive path; it is left alone there.
    expect(bridgePath("/tmp/a\\b")).toBe("/tmp/a\\b");

    // The CA file a Windows person typed is read, and asked for, as C:/certs/ca.crt.
    const reads: string[] = [];
    const asked: unknown[] = [];
    const bridge = {
      call: async (method: string, params: { path?: string; permission?: unknown }) => {
        if (method === "perm.request") {
          asked.push(params.permission);
          return { granted: true };
        }
        if (method !== "fs.read") return {};
        reads.push(params.path ?? "");
        if (params.path !== "C:/certs/ca.crt")
          throw Object.assign(new Error("invalid"), { code: "invalid_params" });
        if (asked.length === 0) throw Object.assign(new Error("no"), { code: "permission_denied" });
        return { content: CA };
      },
    };
    const conn = {
      id: "c-win",
      name: "Shop",
      engine: "postgresql",
      host: "db.example.test",
      ssl: "verify-ca",
      sslCa: "C:\\certs\\ca.crt",
      sslCert: "",
      sslKey: "",
    } as unknown as Connection;
    const tls = await createTls(bridge as never).of(conn);
    expect(tls).toEqual({ mode: "verify-ca", ca: CA });
    expect(reads).toEqual(["C:/certs/ca.crt", "C:/certs/ca.crt"]);
    expect(asked).toEqual([{ permission: "fs:read", paths: ["C:/certs/ca.crt"] }]);
  });

  it("names a file by its last part on every system", () => {
    expect(fileName("C:\\Users\\ada\\Downloads\\shop.dump")).toBe("shop.dump");
    expect(fileName("C:/Users/ada/Downloads/shop.dump")).toBe("shop.dump");
    expect(fileName("~/backups/shop.dir/")).toBe("shop.dir");
    expect(fileName("D:\\backups\\shop.dir\\")).toBe("shop.dir");
    expect(fileName("shop.sql")).toBe("shop.sql");
  });

  it("names the password file where libpq reads it", () => {
    expect(passwordFile("windows")).toBe("%APPDATA%\\postgresql\\pgpass.conf");
    expect(passwordFile("linux")).toBe("~/.pgpass");
    expect(passwordFile("mac")).toBe("~/.pgpass");
  });
});

describe("keys on each system", () => {
  it("Mod is Control on Windows and Linux, Command on macOS", () => {
    const key = { key: "Enter", shiftKey: false, altKey: false };
    expect(pressOf({ ...key, metaKey: false, ctrlKey: true }).mod).toBe(true);
    expect(pressOf({ ...key, metaKey: true, ctrlKey: false }).mod).toBe(true);
    expect(pressOf({ ...key, metaKey: false, ctrlKey: false }).mod).toBe(false);
  });
});
