// Scripts and assertions: a script's source runs as the worker would run it (here in a vm
// context), sees req, res, api, test and expect, and hands back logs, tests, variables and the
// changed request; declarative assertions check a response without code.
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { failure } from "../ui/actions.js";
import { check, expected } from "../ui/assert.js";
import { runScript, type Spawn } from "../ui/scripts.js";
import type { Response } from "../ui/send.js";

const vmSpawn: Spawn = (source, timeoutMs) =>
  new Promise((resolve) => {
    const context = vm.createContext({
      postMessage: (data: unknown) => resolve(structuredClone(data)),
      console: {},
      crypto: globalThis.crypto,
      TextEncoder,
      TextDecoder,
      setTimeout,
      btoa,
      atob,
    });
    try {
      vm.runInContext(source, context, { timeout: timeoutMs });
    } catch (error) {
      const stack = String((error as Error).stack ?? "");
      const line = /evalmachine\.<anonymous>:(\d+)/.exec(stack)?.[1];
      resolve({ fatal: String((error as Error).message), line: line ? Number(line) : undefined });
    }
  });

function response(body: unknown, status = 200): Response {
  return {
    ...failure(""),
    error: undefined,
    status,
    reason: "OK",
    headers: [
      ["Content-Type", "application/json"],
      ["X-Id", "abc"],
    ],
    contentType: "application/json",
    body: new TextEncoder().encode(JSON.stringify(body)),
    timings: { dns: 0, tcp: 0, tls: 0, wait: 0, download: 0, redirect: 0, total: 120 },
  };
}

describe("a script", () => {
  const request = {
    method: "POST",
    url: "https://api.test/items",
    headers: [["Accept", "*/*"]] as [string, string][],
    body: '{"n":1}',
  };

  it("changes the request, sets variables and logs before sending", async () => {
    const out = await runScript(
      `const sig = await api.sha256(req.url);
req.setHeader("X-Signature", sig.slice(0, 8));
req.setBody({ ...req.body, n: 2 });
api.set("startedAt", "123");
console.log("signing", req.method, { n: 2 });`,
      {
        phase: "pre",
        name: "Create",
        vars: { base: "https://api.test" },
        request: structuredClone(request),
      },
      { spawn: vmSpawn },
    );
    expect(out.error).toBeUndefined();
    expect(out.request?.headers.find(([k]) => k === "X-Signature")?.[1]).toMatch(/^[0-9a-f]{8}$/);
    expect(JSON.parse(out.request?.body ?? "")).toEqual({ n: 2 });
    expect(out.vars).toEqual({ startedAt: "123" });
    expect(out.logs).toEqual([{ level: "log", text: 'signing POST {"n":2}' }]);
  });

  it("runs tests with expect after a response, async ones too", async () => {
    const out = await runScript(
      `test("status is 200", () => expect(res.status).to.equal(200));
test("has items", () => expect(res.body.items).to.be.an("array").and.have.lengthOf(2));
test("first is deep", () => expect(res.body.items[0]).to.eql({ id: 1 }));
test("header", () => expect(res).to.have.header("x-id", "abc"));
test("fails clearly", () => expect(res.time).to.be.below(50));
test("async", async () => { await api.sleep(5); expect(true).to.be.true; });
test("not", () => expect(res.body.items).to.not.include(3));
api.env.set("lastId", res.body.items[1].id);`,
      {
        phase: "tests",
        name: "List",
        vars: {},
        response: {
          status: 200,
          reason: "OK",
          headers: [["X-Id", "abc"]],
          text: JSON.stringify({ items: [{ id: 1 }, { id: 2 }] }),
          time: 120,
          size: 30,
          url: "",
        },
      },
      { spawn: vmSpawn },
    );
    expect(out.tests.map((t) => [t.name, t.ok])).toEqual([
      ["status is 200", true],
      ["has items", true],
      ["first is deep", true],
      ["header", true],
      ["fails clearly", false],
      ["async", true],
      ["not", true],
    ]);
    expect(out.tests[4]?.error).toBe("expected 120 below 50".replace("below", "to be below"));
    expect(out.env).toEqual({ lastId: "2" });
  });

  it("reports a throw and a syntax error with the script's line", async () => {
    const thrown = await runScript(
      `\nthrow new Error("nope");`,
      { phase: "post", name: "x", vars: {} },
      { spawn: vmSpawn },
    );
    expect(thrown.error).toBe("Error: nope");
    const broken = await runScript(
      `let a = ;`,
      { phase: "post", name: "x", vars: {} },
      { spawn: vmSpawn },
    );
    expect(broken.error).toMatch(/Unexpected token/);
  });
});

describe("assertions", () => {
  const res = response({ data: [{ id: 1, email: "a@x.io" }], total: 1, next: null });
  const fill = (t: string) => t.replace("{{min}}", "1");
  const run = (target: string, op: string, value = "") =>
    check({ id: "a", on: true, target, op, value }, res, fill);

  it("reads expected values as typed", () => {
    expect(expected("200")).toBe(200);
    expect(expected("true")).toBe(true);
    expect(expected('["a"]')).toEqual(["a"]);
    expect(expected("text")).toBe("text");
  });

  it("pass and fail with words", () => {
    expect(run("res.status", "eq", "200").ok).toBe(true);
    expect(run("res.status", "eq", "201").message).toBe("expected 201, got 200");
    expect(run("res.body.total", "gte", "{{min}}").ok).toBe(true);
    expect(run("res.body.data", "isArray").ok).toBe(true);
    expect(run("res.body.data", "length", "1").ok).toBe(true);
    expect(run("res.body.data[0].email", "matches", "/@x\\.io$/").ok).toBe(true);
    expect(run("res.body.next", "isNull").ok).toBe(true);
    expect(run("res.headers.content-type", "contains", "json").ok).toBe(true);
    expect(run("res.status", "in", "200, 204").ok).toBe(true);
    expect(run("res.time", "lt", "100").message).toBe("expected < 100, got 120");
    expect(run("res.body.missing", "isUndefined").ok).toBe(true);
  });
});
