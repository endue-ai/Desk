import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { APP_VAR, appPid, saveData } from "./driver";

// The spec files load their own copy of driver.ts, apart from the one wdio.conf.ts starts the
// app with: the pid reaches them through the environment, as the app's HOME and log do.
describe("the running app's pid", () => {
  afterEach(() => {
    delete process.env[APP_VAR];
  });

  it("appPid reads the pid startDriver leaves in E2E_APP_PID", () => {
    expect(APP_VAR).toBe("E2E_APP_PID");
    process.env[APP_VAR] = "4242";
    expect(appPid()).toBe(4242);
    for (const value of ["", "none", "0", "-1", "1.5"]) {
      process.env[APP_VAR] = value;
      expect(appPid()).toBeUndefined();
    }
    delete process.env[APP_VAR];
    expect(appPid()).toBeUndefined();
  });
});

describe("native failure data", () => {
  let root: string | undefined;
  function paths() {
    root = mkdtempSync(join(tmpdir(), "endue-test-data-"));
    const source = join(root, "state");
    mkdirSync(source);
    return { source, copy: join(root, "copy") };
  }

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it("keeps the app state and omits the browser profile and sockets", () => {
    const { source, copy } = paths();
    mkdirSync(join(source, "cef"));
    writeFileSync(join(source, "cef", "Preferences"), '{"fixture":"endue"}');
    writeFileSync(join(source, "store.json"), '{"fixture":"endue"}');
    writeFileSync(join(source, "endue.sock"), "");
    mkdirSync(join(copy, "cef"), { recursive: true });
    writeFileSync(join(copy, "cef", "Preferences"), "endue");
    saveData(copy, source);
    expect(readFileSync(join(copy, "store.json"), "utf8")).toBe('{"fixture":"endue"}');
    expect(readdirSync(copy)).toEqual(["store.json"]);
  });

  it.skipIf(process.platform === "win32")("omits links from a failed native run", () => {
    const { source, copy } = paths();
    mkdirSync(join(source, "cef"));
    symlinkSync("endue-missing", join(source, "cef", "SingletonLock"));
    symlinkSync("endue-missing", join(source, "plugins.json"));
    saveData(copy, source);
    expect(existsSync(copy)).toBe(true);
    expect(readdirSync(copy)).toEqual([]);
  });
});
