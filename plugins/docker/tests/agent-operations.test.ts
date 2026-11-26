import { describe, expect, it } from "vitest";
import { mount } from "./harness";

describe("Docker agent operations", () => {
  it("reads the active list and its choices without moving the view", async () => {
    const m = await mount();
    await m.host.command("endue.docker.filter", { view: "containers", query: "project:shop" });
    const web = {
      kind: "container",
      id: "aaaa",
      name: "shop-web-1",
      state: "running",
      project: "shop",
    } as const;
    m.view.selected = web;
    m.view.marks = [web];
    await expect(m.host.command("endue.docker.view", {})).resolves.toMatchObject({
      list: "containers",
      query: "project:shop",
      selection: web,
      marks: [web],
    });
    expect(m.view.selected).toBe(web);
  });

  it("keeps the person's review and reuses a core approval for the named action", async () => {
    const m = await mount({ commands: { "desk.palette.pick": () => "yes" } });
    const args = { container: "shop-web-1" };
    await m.host.command("endue.docker.kill", args);
    expect(m.ran("desk.palette.pick")).toHaveLength(1);
    m.host.emit({
      event: "cmd.invoked",
      data: {
        id: "endue.docker.kill",
        invocationId: "reviewed-kill",
        caller: "agent:eris",
        approved: true,
        args,
      },
    });
    await m.settle();
    expect(m.docker.of("kill")).toEqual([
      ["kill", "--", "shop-web-1"],
      ["kill", "--", "shop-web-1"],
    ]);
    expect(m.ran("desk.palette.pick")).toHaveLength(1);
  });

  it("marks only the person's shell as a shell opened by the Docker surface", async () => {
    const m = await mount();
    await m.host.command("endue.docker.containers", {});
    m.view.selected = {
      kind: "container",
      id: "aaaa",
      name: "shop-web-1",
      state: "running",
      project: "shop",
    };
    await m.keys.shell?.();
    expect(m.ran("endue.terminal.run").at(-1)).toMatchObject({
      command: "docker",
      dockerShell: true,
    });
    m.host.emit({
      event: "cmd.invoked",
      data: {
        id: "endue.docker.shell",
        invocationId: "agent-shell",
        caller: "agent:eris",
        args: { container: "shop-web-1", command: ["printf", "hello"] },
      },
    });
    await m.settle();
    expect(m.ran("endue.terminal.run")).toHaveLength(2);
    expect(m.ran("endue.terminal.run").at(-1)).not.toHaveProperty("dockerShell");
  });
});
