import { afterEach, describe, expect, it } from "vitest";
import { DRIVER_VAR, driverPid } from "./driver";

// The spec files load their own copy of driver.ts, apart from the one wdio.conf.ts starts the
// driver with: the pid reaches them through the environment, as the app's HOME and log do.
describe("the running tauri-driver's pid", () => {
  afterEach(() => {
    delete process.env[DRIVER_VAR];
  });

  it("driverPid reads the pid startDriver leaves in E2E_DRIVER_PID", () => {
    expect(DRIVER_VAR).toBe("E2E_DRIVER_PID");
    process.env[DRIVER_VAR] = "4242";
    expect(driverPid()).toBe(4242);
    for (const value of ["", "none", "0", "-1", "1.5"]) {
      process.env[DRIVER_VAR] = value;
      expect(driverPid()).toBeUndefined();
    }
    delete process.env[DRIVER_VAR];
    expect(driverPid()).toBeUndefined();
  });
});
