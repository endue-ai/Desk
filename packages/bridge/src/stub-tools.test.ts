import { describe, expect, it } from "vitest";
import { BridgeClient } from "./client";
import { browserStub, stubCommands } from "./index";

const GIT = { caller: "endue.git" };
const STATE = {
  id: "endue.git.state",
  title: "Git: state",
  description: "The branch and the changed files.",
  keywords: ["branch"],
  argsSchema: { type: "object" },
  resultSchema: { type: "object" },
  agent: true,
  readOnly: true,
};

async function setup() {
  const commands = stubCommands((event) => stub.emit(event), {
    grants: { "example.notes": [{ permission: "cmd:invoke", ids: ["endue.git.state"] }] },
  });
  const stub = browserStub({ ...commands.handlers });
  const client = new BridgeClient(stub);
  await client.call("cmd.register", STATE, GIT);
  const push = { id: "endue.git.push", title: "Git: push", description: "Push.", agent: true };
  await client.call("cmd.register", push, GIT);
  await client.call("cmd.register", { id: "endue.git.open", title: "Git: open" }, GIT);
  return client;
}

describe("the stub's cmd.tools (ADR 0084)", () => {
  it("lists agent commands as tools, named with underscores, for the runtime", async () => {
    const client = await setup();
    const { tools } = await client.call("cmd.tools", {});
    expect(tools.map((t) => t.command)).toEqual(["endue.git.state", "endue.git.push"]);
    expect(tools[0]).toEqual({
      name: "endue_git_state",
      command: "endue.git.state",
      title: "Git: state",
      description: "The branch and the changed files.",
      argsSchema: { type: "object" },
      resultSchema: { type: "object" },
      readOnly: true,
      provider: "endue.git",
      granted: true,
    });
    const found = await client.call("cmd.tools", { query: "BRANCH changed" });
    expect(found.tools.map((t) => t.command)).toEqual(["endue.git.state"]);
    expect((await client.call("cmd.tools", { limit: 1 })).tools).toHaveLength(1);
  });

  it("shows a plugin what its grants cover and an agent every one, with what it holds", async () => {
    const client = await setup();
    const notes = await client.call("cmd.tools", {}, { caller: "example.notes" });
    expect(notes.tools.map((t) => t.command)).toEqual(["endue.git.state"]);
    const agent = await client.call("cmd.tools", {}, { caller: "agent:mira" });
    expect(agent.tools.map((t) => [t.command, t.granted])).toEqual([
      ["endue.git.state", false],
      ["endue.git.push", false],
    ]);
  });

  it("refuses an agent command without a description", async () => {
    const client = await setup();
    const bare = { id: "endue.git.blame", title: "Blame", agent: true };
    await expect(client.call("cmd.register", bare, GIT)).rejects.toMatchObject({
      code: "invalid_params",
    });
  });
});
