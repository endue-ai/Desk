import { afterEach, describe, expect, it } from "vitest";
import { APP_VAR, appPid } from "./driver";

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
