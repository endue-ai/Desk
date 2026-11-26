// What Eris reads through Projects (ADR 0088): the tasks of every tracker as data, narrowed as she
// asks, and one task with its text, leaving the screen as it is; and the commands she acts with,
// offered to agents in the manifest without requiring what the palette leaves out.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { PluginManifest } from "../../../packages/bridge/src/index";
import { JIRA } from "./fixtures";
import { mount } from "./harness";

type Task = { source: unknown; id: string; ref: string | null; title: string; status: string };

describe("an agent's projects commands", () => {
  it("answers the open tasks of every tracker, with their statuses, leaving the screen alone", async () => {
    const m = await mount();
    const before = m.view.last();
    const all = (await m.host.command("endue.projects.tasks")) as {
      tasks: Task[];
      total: number;
      statuses: string[];
    };
    expect(all.tasks.map((t) => t.ref)).toContain("PAY-12");
    expect(all.tasks.map((t) => t.ref)).not.toContain("PAY-9");
    expect(all.tasks.find((t) => t.ref === "PAY-12")).toMatchObject({
      source: { connector: JIRA, instance: "work" },
      id: "10001",
      status: "In Progress",
      assignee: "Ada Lovelace",
    });
    expect(all.statuses).toContain("Done");
    const done = (await m.host.command("endue.projects.tasks", { done: true })) as {
      total: number;
    };
    expect(done.total).toBe(all.total + 1);
    expect(m.view.last()).toBe(before);
  });

  it("narrows by words, assignee and status, and refuses a due date it cannot read", async () => {
    const m = await mount();
    const words = (await m.host.command("endue.projects.tasks", { query: "payments" })) as {
      tasks: Task[];
    };
    expect(words.tasks.map((t) => t.ref)).toEqual(["PAY-12"]);
    const ada = (await m.host.command("endue.projects.tasks", { assignee: "ada" })) as {
      tasks: Task[];
    };
    expect(ada.tasks.map((t) => t.ref)).toContain("PAY-12");
    const progress = (await m.host.command("endue.projects.tasks", { status: "in progress" })) as {
      tasks: Task[];
    };
    expect(progress.tasks.every((t) => t.status.toLowerCase() === "in progress")).toBe(true);
    await expect(m.host.command("endue.projects.tasks", { dueBefore: "soon" })).rejects.toThrow(
      "dueBefore is a date",
    );
  });

  it("reads one task with its text", async () => {
    const m = await mount();
    const task = (await m.host.command("endue.projects.task", {
      source: { connector: JIRA, instance: "work" },
      id: "10001",
    })) as Task & { type?: string; url?: string; truncated: boolean };
    expect(task).toMatchObject({
      ref: "PAY-12",
      type: "Bug",
      url: "https://acme.atlassian.net/browse/PAY-12",
      truncated: false,
    });
  });

  it("steers the visible projects view and answers its state", async () => {
    const m = await mount();
    const source = `${JIRA}/work`;
    for (const [command, args] of [
      ["view", { view: "timeline" }],
      ["group", { by: "source" }],
      ["source", { source }],
      ["show-done", { on: false }],
      ["zoom", { zoom: "week" }],
      ["search", { text: "payments" }],
      ["go", { to: "next" }],
    ] as const)
      await m.host.command(`endue.projects.${command}`, args);
    expect(await m.host.command("endue.projects.tasks")).toMatchObject({
      screen: {
        view: "timeline",
        group: "source",
        source,
        showDone: false,
        zoom: "week",
        search: "payments",
        period: m.view.last().period,
      },
    });
  });

  it("requires a status for a named move and leaves the palette alone", async () => {
    const m = await mount();
    await expect(
      m.host.command("endue.projects.move", {
        source: { connector: JIRA, instance: "work" },
        id: "10001",
      }),
    ).rejects.toThrow(/status/i);
    expect(m.host.ran.filter(({ name }) => name === "desk.palette.pick")).toEqual([]);
  });
});

describe("the manifest offers them to agents", () => {
  const manifest = JSON.parse(
    readFileSync(join(import.meta.dirname, "../plugin.json"), "utf8"),
  ) as PluginManifest;
  const byId = (id: string) =>
    manifest.contributes?.commands?.find((c) => c.id === `endue.projects.${id}`);

  it("marks the reads read-only and leaves what the palette omits optional", () => {
    for (const id of ["tasks", "task"])
      expect(byId(id), id).toMatchObject({ agent: true, readOnly: true });
    for (const id of ["show", "move", "update", "view", "search", "refresh", "open-original"]) {
      expect(byId(id), id).toMatchObject({ agent: true, args: { additionalProperties: false } });
      expect(byId(id)?.args?.required, id).toBeUndefined();
    }
    for (const id of ["group", "source", "show-done", "zoom", "go"])
      expect(byId(id), id).toMatchObject({
        agent: true,
        description: expect.any(String),
        args: { additionalProperties: false },
      });
    expect(byId("update")).toMatchObject({ irreversible: true });
  });
});
