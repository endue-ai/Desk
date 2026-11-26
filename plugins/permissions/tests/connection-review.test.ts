import { expect, it } from "vitest";
import type { Permission, PermPromptData } from "../../../packages/bridge/src/index";
import { MANAGE, mount, plugin } from "./harness";

const caller = "endue.database";
const reason =
  "[database-connect:example-review-001]\nConnect to db.example:5432 with the configured password command.";
const ask = (promptId: string, permission: Permission): PermPromptData => ({
  promptId,
  caller,
  permission,
  reason,
  duration: "session",
});

it("reviews a saved database and its helper together and answers only their two scopes", async () => {
  const { host, app, view, settle, params } = await mount({
    "plugin.list": () => ({
      plugins: [{ ...plugin(caller, "Database", "ui"), builtIn: true }],
    }),
    "perm.list": () => ({ grants: [] }),
    "perm.answer": () => ({}),
  });
  host.emit({
    event: "perm.prompt",
    data: ask("server", { permission: "db:connect", hosts: ["db.example:5432"] }),
  });
  host.emit({
    event: "perm.prompt",
    data: ask("helper", { permission: "proc:spawn", commands: ["example-helper"] }),
  });
  await settle();
  expect(view.prompts.at(-1)).toMatchObject({
    promptId: "server",
    scope: "db.example:5432",
    related: [{ scope: "example-helper" }],
    reason: "Connect to db.example:5432 with the configured password command.",
    waiting: 0,
  });
  await app.answer("session");
  await settle();
  expect(params("perm.answer")).toEqual([
    { promptId: "server", granted: true, duration: "session", scope: MANAGE },
    { promptId: "helper", granted: true, duration: "session", scope: MANAGE },
  ]);
  expect(view.prompts.at(-1)).toBeNull();
});
