import { describe, expect, it } from "vitest";
import { mount } from "./harness";

describe("terminal session protection", () => {
  it("refuses unforced commands on a live program and asks once for force", async () => {
    const answers = ["cancel", "end"];
    const m = await mount({ commands: { "desk.palette.pick": () => answers.shift() } });
    const opened = (await m.host.command("endue.terminal.run", { command: "editor" })) as {
      session: string;
    };
    const id = opened.session;
    await expect(m.host.command("endue.terminal.close", { session: id })).rejects.toThrow(
      /running/,
    );
    await expect(m.host.command("endue.terminal.restart", { session: id })).rejects.toThrow(
      /running/,
    );
    expect(m.ran("desk.palette.pick")).toHaveLength(0);
    expect(m.params("proc.kill")).toEqual([]);

    await m.host.command("endue.terminal.restart", { session: id, force: true });
    expect(m.params("proc.kill")).toEqual([]);
    expect(m.ran("desk.palette.pick")).toHaveLength(1);
    await m.app.close(id);
    await m.settle();
    expect(m.params("proc.kill")).toHaveLength(1);
    expect(m.ran("desk.palette.pick")).toHaveLength(2);
    expect(m.app.sessions().map((s) => s.id)).not.toContain(id);
  });

  it("protects a shell's foreground work and clears it on an idle prompt", async () => {
    const m = await mount();
    m.app.osc("t-1", 133, "C");
    await m.settle();
    await expect(m.host.command("endue.terminal.close", {})).rejects.toThrow(/running/);
    expect(m.ran("desk.buffers.update")).toContainEqual({ id: "endue.terminal:1", modified: true });
    m.app.osc("t-1", 133, "D;0");
    m.app.osc("t-1", 133, "A");
    await m.settle();
    expect(m.ran("desk.buffers.update")).toContainEqual({
      id: "endue.terminal:1",
      modified: false,
    });
    await m.host.command("endue.terminal.close", {});
    await m.settle();
    expect(m.app.sessions()).toEqual([]);
  });
});
