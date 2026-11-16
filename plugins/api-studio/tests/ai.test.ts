// The assistant: what it is told carries the request, the response and the collection's outline
// but never a secret's value; its answer's actions change the studio only when applied.
import { describe, expect, it } from "vitest";
import { failure } from "../ui/actions.js";
import { applyAction, requestFrom } from "../ui/ai-actions.js";
import { ANSWER_TOOL, promptFor } from "../ui/ai-context.js";
import { createApp } from "../ui/app.js";
import { normalize, pair } from "../ui/model.js";
import { scope } from "../ui/vars.js";

function studio() {
  const app = createApp();
  const coll = {
    path: "/c",
    name: "Shop",
    meta: { vars: [pair({ key: "apiVersion", value: "v1" })] },
    envs: [
      {
        name: "Local",
        path: "/c/environments/local.env.json",
        vars: [
          { ...pair({ key: "token", value: "tok-SECRET" }), secret: true },
          pair({ key: "baseUrl", value: "http://localhost" }),
        ],
      },
    ],
    children: [
      {
        type: "request",
        path: "/c/a.request.json",
        name: "List",
        method: "GET",
        seq: 1,
        req: normalize({ url: "{{baseUrl}}/users" }),
      },
    ],
  };
  const S = {
    app,
    runtime: scope("runtime", "Runtime", {}),
    collections: { byPath: () => coll, list: [coll] },
    envs: { activeEnv: () => coll.envs[0] },
  };
  return S;
}

describe("the assistant", () => {
  it("is told the request, the response and the outline, but no secret", () => {
    const S = studio();
    const tab = S.app.open(
      normalize({
        name: "List",
        url: "{{baseUrl}}/users",
        headers: [
          pair({ key: "Authorization", value: "Bearer tok-SECRET" }),
          pair({ key: "X-Trace", value: "abc" }),
        ],
        auth: { type: "basic", basic: { username: "ann", password: "pw-SECRET" } },
      }),
      { collection: "/c", path: "/c/a.request.json" },
    );
    tab.response = {
      ...failure(""),
      error: undefined,
      status: 200,
      reason: "OK",
      headers: [["Set-Cookie", "session=cookie-SECRET; Path=/"]],
      body: new TextEncoder().encode('{"items":[1,2]}'),
    };
    const prompt = promptFor(S as never, tab, "Why so slow?");
    expect(prompt).toContain("GET {{baseUrl}}/users");
    expect(prompt).toContain("X-Trace: abc");
    expect(prompt).toContain("Authorization: (secret)");
    expect(prompt).toContain('{"items":[1,2]}');
    expect(prompt).toContain("token (secret)");
    expect(prompt).toContain("GET List — {{baseUrl}}/users");
    expect(prompt).toContain("The person asks: Why so slow?");
    expect(prompt).not.toMatch(/SECRET/);
    expect(ANSWER_TOOL.schema.required).toEqual(["reply"]);
  });

  it("applies actions only to what they name", () => {
    const S = studio();
    const tab = S.app.open(normalize({ name: "List", url: "https://x/users" }));
    expect(
      applyAction(S as never, tab, {
        kind: "add_tests",
        title: "t",
        code: 'test("ok", () => {});',
      }),
    ).toMatch(/Added/);
    expect(tab.req.tests).toBe('test("ok", () => {});\n');
    applyAction(S as never, tab, {
      kind: "add_checks",
      title: "c",
      checks: [{ target: "res.status", op: "eq", value: "200" }],
    });
    expect(tab.req.asserts.map((a) => [a.target, a.op, a.value])).toEqual([
      ["res.status", "eq", "200"],
    ]);
    applyAction(S as never, tab, {
      kind: "update_request",
      title: "u",
      request: { method: "post", headers: [{ key: "Accept", value: "application/json" }] },
    });
    expect([tab.req.method, tab.req.url, tab.req.headers.map((h) => h.key)]).toEqual([
      "POST",
      "https://x/users",
      ["Accept"],
    ]);
    applyAction(S as never, tab, {
      kind: "set_variable",
      title: "v",
      variable: { name: "userId", value: "7" },
    });
    expect(S.runtime.values.get("userId")).toBe("7");
    const before = S.app.state.tabs.length;
    applyAction(S as never, tab, {
      kind: "create_request",
      title: "n",
      request: {
        name: "Search",
        method: "GET",
        url: "https://x/search",
        query: [{ key: "q", value: "red" }],
      },
    });
    expect(S.app.state.tabs.length).toBe(before + 1);
    expect(
      requestFrom({ method: "POST", url: "https://x", body: { mode: "json", text: "{}" } }).body,
    ).toMatchObject({ mode: "json", json: "{}" });
  });
});
