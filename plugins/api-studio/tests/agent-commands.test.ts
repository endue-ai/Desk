import { describe, expect, it, vi } from "vitest";
import { createActions, failure, SEND_HOOKS } from "../ui/actions.js";
import { createFiles } from "../ui/collection-fs.js";
import { wireCommands } from "../ui/commands.js";
import { newRequest, pair } from "../ui/model.js";
import { scope } from "../ui/vars.js";

const SAVED = "~/shop/read.request.json";
const ROOT = "~/shop";
const PRIVATE = "private-fixture-token";

function fixture() {
  const req = newRequest({
    name: "Read things",
    url: `https://sample.test/things?api_key=${PRIVATE}`,
    headers: [pair({ key: "Authorization", value: `Bearer ${PRIVATE}` })],
  });
  const post = newRequest({ name: "Write things", method: "POST", url: "https://sample.test/x" });
  const env = {
    name: "Desk",
    vars: [pair({ key: "token", value: PRIVATE, secret: true })],
  };
  const coll = {
    name: "Shop",
    path: ROOT,
    envs: [env],
    children: [
      { type: "request", path: SAVED, req, name: req.name, method: req.method },
      {
        type: "request",
        path: `${ROOT}/write.request.json`,
        req: post,
        name: post.name,
        method: post.method,
      },
    ],
  };
  const response = {
    ...failure(""),
    status: 200,
    headers: [
      ["Set-Cookie", `session=${PRIVATE}`],
      ["X-Example", "ordinary"],
    ],
    body: new TextEncoder().encode(`{"token":"${PRIVATE}","answer":42}`),
    contentType: "application/json",
  };
  const tab = {
    id: "request-tab",
    req,
    ref: { collection: ROOT, path: SAVED },
    response,
    saved: null,
    reqTab: "params",
    resTab: "body",
  };
  const S = {
    collections: { list: [coll] },
    app: { state: { tabs: [tab], history: [], active: tab.id }, dirty: () => false },
    scopes: () => [scope("env", "Desk", env.vars)],
    parentAuth: () => [],
    parentHeaders: () => [],
    save: vi.fn(async () => true),
    send: vi.fn(async (sending) => {
      sending.response = response;
    }),
    envs: {
      activeEnv: () => env,
      varsOf: () => env.vars,
      use: vi.fn(async () => {}),
      save: vi.fn(async () => {}),
    },
    importFile: vi.fn(async () => ({ imported: 1 })),
  };
  const handlers = new Map<string, (args: unknown) => unknown>();
  const ctx = {
    commands: {
      on: (id: string, handler: (args: unknown) => unknown) => handlers.set(id, handler),
    },
  };
  wireCommands(ctx, S as never);
  return {
    coll,
    env,
    req,
    tab,
    S,
    async invoke(name: string, args: object) {
      const handler = handlers.get(`endue.api-studio.${name}`);
      if (!handler) throw new Error(`No API Studio command named ${name}`);
      return await handler(args);
    },
  };
}

describe("API Studio agent commands", () => {
  it("reads saved requests, tabs and generated code without leaking stored values or sending", async () => {
    const f = fixture();
    const request = await f.invoke("request", { name: SAVED });
    const tab = await f.invoke("tab", { name: f.req.name });
    const code = await f.invoke("codegen", { request: SAVED, lang: "fetch" });
    expect(request).toMatchObject({ request: { method: "GET", name: f.req.name } });
    expect(tab).toMatchObject({ response: { status: 200, body: expect.stringContaining("42") } });
    expect(code).toMatchObject({ code: expect.stringContaining("fetch(") });
    expect(JSON.stringify([request, tab, code])).not.toContain(PRIVATE);
    expect(f.S.send).not.toHaveBeenCalled();
  });

  it("saves a request, sets a non-secret variable and opens local import", async () => {
    const f = fixture();
    await f.invoke("save-request", { name: f.req.name });
    expect(f.S.save).toHaveBeenCalledWith(f.tab, undefined);
    await f.invoke("use-environment", { collection: ROOT, name: "Desk" });
    expect(f.S.envs.use).toHaveBeenCalledWith(f.coll, "Desk");
    await expect(
      f.invoke("set-variable", { collection: ROOT, key: "token", value: "attempt" }),
    ).rejects.toThrow(/secret/i);
    await f.invoke("set-variable", { collection: ROOT, key: "host", value: "sample.test" });
    expect(f.S.envs.save).toHaveBeenCalledWith(f.coll, f.env, [
      expect.objectContaining({ key: "token", value: PRIVATE, secret: true }),
      expect.objectContaining({ key: "host", value: "sample.test" }),
    ]);
    await expect(f.invoke("import", { path: "~/schema.yml", kind: "openapi" })).resolves.toEqual({
      imported: 1,
    });
    expect(f.S.importFile).toHaveBeenCalledWith("~/schema.yml", "openapi");
  });

  it("only runs named saved GET, HEAD or OPTIONS through the safe send", async () => {
    const f = fixture();
    await expect(f.invoke("send-read", { request: "Write things" })).rejects.toThrow(/GET/i);
    await expect(f.invoke("send-read", { url: "https://sample.test" })).rejects.toThrow(/saved/i);
    await expect(f.invoke("send-read", { request: SAVED })).resolves.toMatchObject({ status: 200 });
    expect(f.S.send).toHaveBeenCalledOnce();
  });

  it("checks the effective method again before a safe request reaches curl", async () => {
    const f = fixture();
    const engine = { send: vi.fn() };
    const S = { ...f.S, app: { emit: vi.fn(), remember: vi.fn() }, engine };
    const tab = { ...f.tab, response: undefined };
    const hook = {
      prepared: (_studio: unknown, prep: { method: string }) => (prep.method = "POST"),
    };
    SEND_HOOKS.push(hook as never);
    try {
      await createActions(S as never).send(tab as never, { readOnly: true });
    } finally {
      SEND_HOOKS.splice(SEND_HOOKS.indexOf(hook as never), 1);
    }
    expect(engine.send).not.toHaveBeenCalled();
    expect(tab.response).toMatchObject({ error: expect.stringMatching(/GET.*HEAD.*OPTIONS/) });
  });
});

it("shares one folder permission prompt and can retry after a denial", async () => {
  let approved = false;
  const call = vi.fn(async (method: string) => {
    if (method === "perm.request") return { granted: approved };
    if (!approved)
      throw Object.assign(new Error("permission denied"), { code: "permission_denied" });
    return {};
  });
  const files = createFiles({ call } as never);
  const first = await Promise.allSettled([
    files.write("/outside/shop/a.json", "a", "/outside/shop"),
    files.write("/outside/shop/b.json", "b", "/outside/shop"),
  ]);
  expect(first.map((x) => x.status)).toEqual(["rejected", "rejected"]);
  expect(call.mock.calls.filter(([m]) => m === "perm.request")).toHaveLength(1);
  approved = true;
  call.mockImplementation(async (method) => {
    if (method === "perm.request") return { granted: true };
    if (call.mock.calls.filter(([m]) => m === "perm.request").length < 2)
      throw Object.assign(new Error("permission denied"), { code: "permission_denied" });
    return {};
  });
  await expect(files.write("/outside/shop/a.json", "a", "/outside/shop")).resolves.toEqual({});
  expect(call.mock.calls.filter(([m]) => m === "perm.request")).toHaveLength(2);
});
