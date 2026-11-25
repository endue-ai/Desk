import { describe, expect, it, vi } from "vitest";
import { spawnProgram } from "../ui/spawn.js";

const program = { command: "fixture-program", args: ["example"], cwd: "~" };
const size = { env: {}, cols: 80, rows: 24 };

describe("an approved terminal invocation", () => {
  it("supplies the invocation only to the initial spawn", async () => {
    const call = vi.fn(async () => ({ procId: "p-1" }));
    await spawnProgram({ call }, program, { ...size, invocationId: "i-1" });
    expect(call).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledWith(
      "proc.spawn",
      expect.objectContaining({
        invocationId: "i-1",
        command: program.command,
        args: program.args,
      }),
    );
  });

  it("reports an expired approval without asking for a separate permission", async () => {
    const refused = Object.assign(new Error("approval expired"), { code: "permission_denied" });
    const call = vi.fn(async () => {
      throw refused;
    });
    await expect(spawnProgram({ call }, program, { ...size, invocationId: "i-2" })).rejects.toBe(
      refused,
    );
    expect(call).toHaveBeenCalledTimes(1);
  });
});
