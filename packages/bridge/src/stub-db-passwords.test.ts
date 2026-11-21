import { describe, expect, it } from "vitest";
import {
  BridgeClient,
  browserStub,
  type DbConnectPermission,
  type StubDatabase,
  stubCommands,
} from "./index";

const DB = { caller: "example.database" };
const OTHER = { caller: "example.other" };
const PASSWORD = "fixture-keychain-password";
const scope: DbConnectPermission = { permission: "db:connect", hosts: ["db.example.test"] };
const SCRIPT: StubDatabase = { password: PASSWORD, statements: [] };
const base = { engine: "postgresql", host: "db.example.test", database: "shop", user: "reader" };
const kept = { name: "c-1", host: "db.example.test", port: 5432, user: "reader" };

function setup() {
  const core = stubCommands(() => {}, {
    grants: { [DB.caller]: [scope], [OTHER.caller]: [scope] },
    db: SCRIPT,
  });
  const answers: unknown[] = [];
  const client = new BridgeClient(browserStub(core.handlers));
  const call = async (...args: Parameters<typeof client.call>) => {
    const answer = await client.call(...args);
    answers.push(answer);
    return answer;
  };
  return { call, answers, client };
}

describe("the stub's kept passwords, as the core serves db.passwords.* (ADR 0311)", () => {
  it("keeps a password by name, lists what it is for without it, and forgets it", async () => {
    const { call, answers } = setup();
    expect(await call("db.passwords.set", { ...kept, password: PASSWORD }, DB)).toEqual({});
    expect(await call("db.passwords.list", {}, DB)).toEqual({ passwords: [kept] });
    expect(await call("db.passwords.list", {}, OTHER)).toEqual({ passwords: [] });
    await call("db.passwords.delete", { name: "c-1" }, OTHER);
    expect(await call("db.passwords.list", {}, DB)).toEqual({ passwords: [kept] });
    await call("db.passwords.delete", { name: "c-1" }, DB);
    expect(await call("db.passwords.list", {}, DB)).toEqual({ passwords: [] });
    expect(JSON.stringify(answers)).not.toContain(PASSWORD);
  });

  it("signs db.open in with a kept password by passwordRef, only for its host, port and user", async () => {
    const { call, answers } = setup();
    await call("db.passwords.set", { ...kept, password: PASSWORD }, DB);
    const opened = await call("db.open", { ...base, passwordRef: "c-1", scope }, DB);
    expect(opened).toMatchObject({ sessionId: expect.any(String), auth: "scram-sha-256" });
    const needs = { needsPassword: true };
    const port = { ...base, port: 6432, passwordRef: "c-1", scope };
    expect(await call("db.open", port, DB)).toEqual(needs);
    const user = { ...base, user: "writer", passwordRef: "c-1", scope };
    expect(await call("db.open", user, DB)).toEqual(needs);
    expect(await call("db.open", { ...base, passwordRef: "c-1", scope }, OTHER)).toEqual(needs);
    await call("db.passwords.set", { ...kept, password: "a-wrong-one" }, DB);
    const wrong = await call("db.open", { ...base, passwordRef: "c-1", scope }, DB);
    expect(wrong).toMatchObject({ error: { code: "28P01" } });
    const both = { ...base, password: PASSWORD, passwordRef: "c-1", scope };
    const { client } = setup();
    await expect(client.call("db.open", both, DB)).rejects.toMatchObject({
      code: "invalid_params",
    });
    expect(JSON.stringify(answers)).not.toContain(PASSWORD);
  });

  it("refuses agents", async () => {
    const { client } = setup();
    const agent = { caller: "agent:helper" };
    for (const [method, params] of [
      ["db.passwords.set", { ...kept, password: PASSWORD }],
      ["db.passwords.delete", { name: "c-1" }],
      ["db.passwords.list", {}],
    ] as const)
      await expect(client.call(method, params as never, agent)).rejects.toMatchObject({
        code: "permission_denied",
      });
  });
});
