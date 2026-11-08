import { describe, expect, it } from "vitest";
import { denied, ENV, mount, scope } from "./harness";

describe("new terminal working directory", () => {
  it.each(["/tmp/Work one;$(not-a-command)", "C:/Work one & data"])(
    "passes %s directly while preserving the configured shell and arguments",
    async (cwd) => {
      const d = await mount({
        settings: {
          "endue.terminal.shell": "fish",
          "endue.terminal.args": ["-i"],
          "endue.terminal.login": "no",
          "endue.terminal.cwd": "~/Default",
        },
      });
      expect(await d.host.command("endue.terminal.new", { cwd })).toBe("t-2");
      expect(d.params("proc.spawn")[1]).toEqual({
        command: "fish",
        args: ["-i"],
        cwd,
        env: ENV,
        pty: { cols: 80, rows: 24 },
        scope: scope("fish"),
      });
      await d.host.command("endue.terminal.new");
      expect(d.params("proc.spawn")[2]).toMatchObject({ cwd: "~/Default", args: ["-i"] });
      expect(d.params("proc.write")).toEqual([]);
    },
  );

  it("rejects malformed cwd before opening a tab or spawning", async () => {
    const d = await mount();
    for (const cwd of ["", "relative", "https://example.test", "/bad\0path", null, 42, []]) {
      await expect(d.host.command("endue.terminal.new", { cwd })).rejects.toThrow(
        /working directory/i,
      );
    }
    expect(d.params("proc.spawn")).toHaveLength(1);
    expect(d.view.opened).toHaveLength(1);
  });

  it("preserves the normal spawn grant and returns a declined permission as a failure", async () => {
    const d = await mount({
      handlers: {
        "proc.spawn": ({ cwd }) => {
          if (cwd === "/private/work") throw denied("spawn");
          return { procId: "p1" };
        },
        "perm.request": () => ({ granted: false }),
      },
    });
    await expect(d.host.command("endue.terminal.new", { cwd: "/private/work" })).rejects.toThrow(
      /not allowed/i,
    );
    expect(d.params("perm.request")).toEqual([
      {
        permission: scope("zsh"),
        reason: "To run zsh in a terminal",
      },
    ]);
    expect(d.params("proc.spawn")).toHaveLength(2);
    expect(d.app.sessions().at(-1)?.procId).toBeNull();
  });
});
