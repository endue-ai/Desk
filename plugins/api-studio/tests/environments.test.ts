// Environments and reading values out of responses: the active environment's variables become a
// scope, secrets stay out of files and in the store, captures land where they should, and
// expressions read status, headers, cookies and JSON paths.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { failure } from "../ui/actions.js";
import type { Tab } from "../ui/app.js";
import { createApp } from "../ui/app.js";
import type { Collection } from "../ui/collection-fs.js";
import { createCollections } from "../ui/collections.js";
import { createEnvironments, hashKey } from "../ui/environments.js";
import { read, steps } from "../ui/expr.js";
import { pair } from "../ui/model.js";
import type { Response } from "../ui/send.js";
import { resolve, type Scope, scope } from "../ui/vars.js";
import { fsBridge } from "./fs-bridge";

function response(body: unknown, headers: [string, string][] = []): Response {
  const res = failure("");
  delete res.error;
  return {
    ...res,
    status: 201,
    reason: "Created",
    headers: [["Content-Type", "application/json"], ...headers],
    contentType: "application/json",
    body: new TextEncoder().encode(JSON.stringify(body)),
    timings: { ...res.timings, total: 42.4 },
  };
}

describe("reading a response", () => {
  const res = response(
    { data: [{ id: 7, tags: ["a", "b"] }, { id: 8 }], "odd key": true, token: "t-1" },
    [
      ["Set-Cookie", "session=abc; Path=/; HttpOnly"],
      ["ETag", '"v2"'],
    ],
  );

  it("reads status, time, headers and cookies", () => {
    expect(read("res.status", res)).toBe(201);
    expect(read("res.time", res)).toBe(42);
    expect(read("res.headers.etag", res)).toBe('"v2"');
    expect(read("res.headers.content-type", res)).toBe("application/json");
    expect(read("res.cookies.session", res)).toBe("abc");
  });

  it("follows body paths and JSONPath-like paths", () => {
    expect(read("res.body.token", res)).toBe("t-1");
    expect(read("res.body.data[0].tags[1]", res)).toBe("b");
    expect(read('res.body["odd key"]', res)).toBe(true);
    expect(read("res.body.data.length", res)).toBe(2);
    expect(read("$.data[*].id", res)).toEqual([7, 8]);
    expect(read("res.body.data[5].id", res)).toBeUndefined();
  });

  it("says what it cannot read", () => {
    expect(() => read("body.x", res)).toThrow(/Start with res\./);
    expect(() => read("res.nothing", res)).toThrow(/not something a response has/);
    expect(() => steps(".a..b")).toThrow();
  });
});

describe("environments", () => {
  let bridge: Awaited<ReturnType<typeof fsBridge>>;
  beforeEach(async () => {
    bridge = await fsBridge();
  });
  afterEach(() => bridge.cleanup());

  type Studio = {
    ctx: { bridge: typeof bridge };
    app: ReturnType<typeof createApp>;
    collections: ReturnType<typeof createCollections>;
    envs: ReturnType<typeof createEnvironments>;
    runtime: Scope;
    scopeProviders: ((tab: Tab) => Scope[])[];
    envScopes(tab: Tab): Scope[];
    globalScopes(): Scope[];
  };

  it("keep secret values in the store, give the active one as a scope, and take captures", async () => {
    const S = {
      ctx: { bridge },
      app: createApp(),
      runtime: scope("runtime", "Runtime", {}),
      scopeProviders: [],
      envScopes: () => [],
      globalScopes: () => [],
    } as unknown as Studio;
    S.collections = createCollections(S as never);
    S.envs = createEnvironments(S as never);
    const made = (await S.collections.create("~", "Shop")) as Collection;
    const env = await S.envs.create(made, "Local");
    if (!env) throw new Error("no environment");
    const coll = S.collections.byPath(made.path) as Collection;
    await S.envs.save(coll, env, [
      { ...pair({ key: "baseUrl", value: "http://localhost:4339" }) },
      { ...pair({ key: "token", value: "s3cret-token" }), secret: true },
    ]);
    const file = readFileSync(bridge.real(env.path), "utf8");
    expect(file).not.toContain("s3cret-token");
    expect(file).toContain('"secret": true');

    const fresh = S.collections.byPath(made.path) as Collection;
    await S.envs.use(fresh, "Local");
    const tab = S.app.open(pair() as never, {
      collection: made.path,
      path: "~/shop/x.request.json",
    });
    const scopes = S.envScopes(tab);
    expect(resolve("{{baseUrl}}/{{token}}", scopes)).toBe("http://localhost:4339/s3cret-token");
    const stored = await bridge.call("store.get", { key: `secrets.${hashKey(made.path)}` });
    expect(stored).toEqual({ value: { Local: { token: "s3cret-token" } } });

    // A capture into a secret goes with the secrets; any other name lives at runtime.
    S.envs.setFromRun(tab, "token", "fresh-token");
    S.envs.setFromRun(tab, "orderId", "ord_1");
    expect(resolve("{{token}}", S.envScopes(tab))).toBe("fresh-token");
    expect(S.runtime.values.get("orderId")).toBe("ord_1");
    expect(S.runtime.values.has("token")).toBe(false);
  });
});
