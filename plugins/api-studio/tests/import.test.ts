// Bringing requests in and taking them out: YAML read as values, an OpenAPI description and a HAR
// file as collections (written to disk), and a request as code in other languages.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createApp } from "../ui/app.js";
import { GENERATORS, hideSecrets } from "../ui/codegen.js";
import type { Collection } from "../ui/collection-fs.js";
import { createCollections } from "../ui/collections.js";
import type { Prepared } from "../ui/curl-config.js";
import { understand, writeImport } from "../ui/features-import.js";
import { parseYaml } from "../ui/yaml.js";
import { fsBridge } from "./fs-bridge";

const spec = readFileSync(join(import.meta.dirname, "../dev/demo-openapi.yaml"), "utf8");

describe("YAML", () => {
  it("reads mappings, sequences, flow collections, block scalars and types", () => {
    expect(
      parseYaml(`# a comment
name: "Shop" # trailing
count: 3
ratio: 0.5
on: true
none: ~
list:
  - a
  - b: 1
    c: [x, 'y z', {k: v}]
text: |
  line one
  line two
folded: >-
  one
  two
empty:
`),
    ).toEqual({
      name: "Shop",
      count: 3,
      ratio: 0.5,
      on: true,
      none: null,
      list: ["a", { b: 1, c: ["x", "y z", { k: "v" }] }],
      text: "line one\nline two\n",
      folded: "one two",
      empty: null,
    });
  });
});

describe("an API description", () => {
  it("becomes folders by tag, requests with params, bodies and auth, servers as environments", () => {
    const imp = understand(spec);
    expect(imp.name).toBe("Shop API (described)");
    expect(
      imp.folders.map((f) => [f.name, f.requests.map((r) => `${r.method} ${r.name}`)]),
    ).toEqual([
      ["Auth", ["POST Log in"]],
      ["Users", ["GET List users", "POST Create a user", "GET Get a user", "DELETE Delete a user"]],
      ["Orders", ["GET List orders"]],
    ]);
    expect(imp.requests.map((r) => r.name)).toEqual(["Health"]);
    expect(imp.envs.map((e) => [e.name, e.vars.find((v) => v.key === "baseUrl")?.value])).toEqual([
      ["Local", "http://127.0.0.1:4339/v1"],
      ["Staging", "https://staging.shop.example.com/v1"],
    ]);
    expect(imp.auth).toEqual({ type: "bearer", bearer: { token: "{{token}}" } });
    const list = imp.folders[1]?.requests[0];
    expect(list?.url).toBe("{{baseUrl}}/users?page=1");
    expect(list?.params.map((p) => [p.key, p.value, p.on])).toEqual([
      ["page", "1", true],
      ["limit", "5", false],
      ["role", "admin", false],
    ]);
    const login = imp.folders[0]?.requests[0];
    expect(login?.auth).toEqual({ type: "none" });
    expect(JSON.parse(login?.body.json ?? "")).toEqual({
      email: "user@example.com",
      password: "{{password}}",
    });
    const create = imp.folders[1]?.requests[1];
    expect(JSON.parse(create?.body.json ?? "")).toEqual({
      name: "Mina Kim",
      email: "user@example.com",
      role: "member",
    });
    expect(imp.folders[1]?.requests[2]?.url).toBe("{{baseUrl}}/users/:id");
    expect(imp.folders[1]?.requests[2]?.pathParams.map((p) => [p.key, p.value])).toEqual([
      ["id", "1003"],
    ]);
  });

  it("is written to disk as a collection the studio reads back", async () => {
    const bridge = await fsBridge();
    try {
      const S = {
        ctx: { bridge },
        app: createApp(),
        scopeProviders: [],
        envScopes: () => [],
        globalScopes: () => [],
      } as unknown as { collections: ReturnType<typeof createCollections> };
      S.collections = createCollections(S as never);
      const coll = (await writeImport(S as never, "~", understand(spec))) as Collection | undefined;
      expect(coll?.children.map((n) => n.name)).toEqual(["Auth", "Users", "Orders", "Health"]);
      expect(coll?.envs.map((e) => e.name)).toEqual(["Local", "Staging"]);
      expect(existsSync(bridge.real("~/shop-api-described/users/list-users.request.json"))).toBe(
        true,
      );
      expect(readdirSync(bridge.real("~/shop-api-described/environments"))).toEqual([
        "local.env.json",
        "staging.env.json",
      ]);
    } finally {
      await bridge.cleanup();
    }
  });

  it("reads a HAR file's requests", () => {
    const imp = understand(
      JSON.stringify({
        log: {
          entries: [
            {
              request: {
                method: "POST",
                url: "https://h.example/api/x?y=1",
                headers: [
                  { name: ":authority", value: "h" },
                  { name: "Content-Type", value: "application/json" },
                ],
                postData: { mimeType: "application/json", text: '{"a":1}' },
              },
            },
          ],
        },
      }),
    );
    const req = imp.requests[0];
    expect([req?.method, req?.name, req?.headers.map((h) => h.key), req?.body.mode]).toEqual([
      "POST",
      "h.example/api/x",
      ["Content-Type"],
      "json",
    ]);
  });
});

describe("code", () => {
  const prep: Prepared = {
    method: "POST",
    url: "https://api.example.com/v1/items",
    headers: [
      { key: "Content-Type", value: "application/json" },
      { key: "Authorization", value: "Bearer s3cret" },
    ],
    body: { kind: "raw", text: '{"name":"lamp","ok":true,"tags":null}' },
    settings: {
      followRedirects: true,
      maxRedirects: 10,
      verifyTls: true,
      timeoutMs: 30000,
      httpVersion: "auto",
      decompress: false,
      cookies: true,
      encodeUrl: true,
    },
  };
  it("is made in each language, secrets hidden when asked", () => {
    for (const [id, gen] of Object.entries(GENERATORS))
      expect(gen.make(prep).length, id).toBeGreaterThan(20);
    expect(GENERATORS.python?.make(prep)).toContain('"ok": True');
    expect(GENERATORS.python?.make(prep)).toContain('"tags": None');
    expect(GENERATORS.fetch?.make(prep)).toContain("body: JSON.stringify({");
    expect(GENERATORS.go?.make(prep)).toContain('http.NewRequest("POST"');
    const hidden = GENERATORS.curl?.make(hideSecrets(prep, /^authorization$/i)) ?? "";
    expect(hidden).toContain("Bearer <token>");
    expect(hidden).not.toContain("s3cret");
  });
});
