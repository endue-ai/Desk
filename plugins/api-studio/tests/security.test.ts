// What keeps a request from carrying more than the person meant, without DOM: curl speaks only
// HTTP(S), header names cannot reach curl's @file form, secrets do not follow a redirect to
// another host, generated code cannot run what a value holds, secret names and values are hidden
// from what an assistant or agent reads, typed secrets are found before they reach a file, a HAR
// file's session goes to secrets, and the hashes scripts are allowed by are SHA-256.
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GENERATORS, hideSecrets } from "../ui/codegen.js";
import { curlCommand, curlConfig, headerLine } from "../ui/curl-config.js";
import { createEngine } from "../ui/engine.js";
import { filesRead, inside, segments } from "../ui/file-guard.js";
import { fromHar } from "../ui/har.js";
import { literalSecrets, withoutLiterals } from "../ui/literals.js";
import { normalize, pair } from "../ui/model.js";
import { followsItself, nextHop, sendFollowing } from "../ui/redirects.js";
import { hideText, hideUrl, isSecretName, varName, withoutSecrets } from "../ui/secret-names.js";
import { bodyJson, prepare, readResponse } from "../ui/send.js";
import { sha256 } from "../ui/sha256.js";
import { paramsFromUrl } from "../ui/url.js";
import { curlBridge, testServer } from "./real-curl";
import { scopesIn } from "./scopes";

let one: Awaited<ReturnType<typeof testServer>>;
let other: Awaited<ReturnType<typeof testServer>>;
beforeAll(async () => {
  one = await testServer();
  other = await testServer();
});
afterAll(async () => {
  await one.close();
  await other.close();
});

const settings = normalize({}).settings;

describe("curl's config", () => {
  it("lets curl speak HTTP and HTTPS only, redirects included", () => {
    const config = curlConfig({
      method: "GET",
      url: "https://api.test/",
      headers: [],
      body: { kind: "none" },
      settings,
    });
    expect(config).toContain('proto = "=http,https"');
    expect(config).toContain('proto-redir = "=http,https"');
  });

  it("keeps a header's name to a token, so it never reads a file", () => {
    expect(headerLine({ key: "@/etc/passwd", value: "" })).toBe("etcpasswd;");
    expect(headerLine({ key: "X-A\nB:", value: "v\r\nInjected: 1" })).toBe("X-AB: v Injected: 1");
    expect(headerLine({ key: "@@", value: "x" })).toBe("");
  });

  it("refuses a file URL in the real curl even if one got this far", async () => {
    const engine = createEngine(curlBridge());
    const run = await engine.send({
      method: "GET",
      url: "file:///etc/hosts",
      headers: [],
      body: { kind: "none" },
      settings,
    }).promise;
    expect(run.code).not.toBe(0);
    expect(new TextDecoder().decode(run.stdout)).not.toMatch(/localhost/);
  });

  it("lists the files a body makes curl read", () => {
    expect(
      filesRead({
        method: "POST",
        url: "https://x",
        headers: [],
        settings,
        body: { kind: "multipart", parts: [{ name: "a", value: '/tmp/a;type=x"', file: true }] },
      }),
    ).toEqual(["/tmp/atype=x"]);
  });
});

describe("paths inside a collection", () => {
  it("works out . and .. and needs an absolute path", () => {
    expect(segments("/a/./b/../c")).toEqual(["", "a", "c"]);
    expect(segments("~/x/../y")).toEqual(["~", "y"]);
    expect(segments("C:\\Users\\a")).toEqual(["C:", "Users", "a"]);
    expect(segments("data.bin")).toBeUndefined();
    expect(inside("~/api/data/in.bin", "~/api")).toBe(true);
    expect(inside("~/api/../.ssh/id_rsa", "~/api")).toBe(false);
    expect(inside("~/api-other/x", "~/api")).toBe(false);
    expect(inside("~/api", "~/api")).toBe(false);
  });
});

describe("redirects", () => {
  const send = async (
    url: string,
    headers: { key: string; value: string }[],
    secrets: string[],
  ) => {
    const req = normalize({
      url,
      params: paramsFromUrl(url, []),
      headers: headers.map((h) => pair(h)),
    });
    const { prep } = prepare(req, { scopes: scopesIn(secrets) });
    expect(followsItself(prep)).toBe(true);
    const followed = await sendFollowing(createEngine(curlBridge()), prep).promise;
    const res = readResponse(followed.run, followed.prep, "", []);
    return { res, followed, echoed: bodyJson(res)?.value };
  };

  it("keeps secret headers on the same origin and drops them for another", async () => {
    const same = await send(
      `${one.url}/away?to=/echo`,
      [
        { key: "X-API-Key", value: "{{key}}" },
        { key: "X-Trace", value: "t1" },
      ],
      ["key-SECRET"],
    );
    expect(same.echoed.headers["x-api-key"]).toBe("key-SECRET");
    expect(same.followed.hops).toEqual([{ status: 302, reason: "Found", location: "/echo" }]);

    const away = await send(
      `${one.url}/away?to=${encodeURIComponent(`${other.url}/echo`)}`,
      [
        { key: "X-Custom", value: "{{key}}" },
        { key: "X-Trace", value: "t1" },
      ],
      ["key-SECRET"],
    );
    expect(away.res.status).toBe(200);
    expect(away.echoed.headers["x-custom"]).toBeUndefined();
    expect(away.echoed.headers["x-trace"]).toBe("t1");
    expect(away.followed.hops).toHaveLength(1);
  });

  it("turns a POST into a GET on 303 and keeps the body on 307", () => {
    const prep = prepare(
      normalize({
        method: "POST",
        url: "https://a.test/x",
        body: { mode: "json", json: "{}" },
        headers: [pair({ key: "Authorization", value: "Bearer t" })],
      }),
      { scopes: [] },
    ).prep;
    const seeOther = nextHop(prep, 303, "https://a.test/y", false, undefined);
    expect([seeOther.method, seeOther.body.kind]).toEqual(["GET", "none"]);
    const again = nextHop(prep, 307, "https://b.test/y", true, () => "c=1");
    expect([again.method, again.body.kind]).toEqual(["POST", "raw"]);
    expect(again.headers.map((h) => h.key)).toEqual(["Content-Type", "Cookie"]);
  });
});

describe("generated code", () => {
  const prep = (over: Record<string, unknown>) => ({
    method: "GET",
    url: "https://x.test/",
    headers: [],
    body: { kind: "none" as const },
    settings,
    ...over,
  });

  it("escapes Kotlin templates, PowerShell's other quotes, and a method in shell commands", () => {
    const kotlin = GENERATORS.kotlin?.make(
      prep({ headers: [{ key: "X", value: ["$", "{Runtime.getRuntime().exec('id')}"].join("") }] }),
    );
    expect(kotlin).toContain('"\\${Runtime');
    expect(kotlin).not.toMatch(/[^\\]\$\{Runtime/);
    const ps = GENERATORS.powershell?.make(
      prep({ method: "GET;rm", url: "https://x.test/’;Remove-Item ~ -Recurse;’" }),
    );
    expect(ps).toContain("-Uri 'https://x.test/’’;Remove-Item ~ -Recurse;’’'");
    expect(ps).toContain("-Method 'GET;rm'");
    expect(curlCommand(prep({ method: "GET;ID" }))).toContain("-X 'GET;ID'");
    expect(GENERATORS.httpie?.make(prep({ method: "GET;ID" }))).toContain("http 'GET;ID'");
  });

  it("hides secrets by name, by value and in the query", () => {
    const hidden = hideSecrets(
      prep({
        url: "https://x.test/?api_key=k-SECRET&page=1",
        headers: [
          { key: "X-Custom", value: "c-SECRET", secret: true },
          { key: "Private-Token", value: "p-SECRET" },
        ],
        body: { kind: "raw", text: '{"password":"pw-SECRET","user":"ann"}' },
        secrets: ["k-SECRET"],
      }),
    );
    for (const gen of Object.values(GENERATORS)) expect(gen.make(hidden)).not.toMatch(/SECRET/);
  });
});

describe("secret names and values", () => {
  it("knows secret names in every spelling", () => {
    for (const name of [
      "Authorization",
      "Cookie",
      "X-API-Key",
      "api_key",
      "apiKey",
      "Private-Token",
      "X-Access-Token",
      "access_token",
      "client_secret",
      "clientSecret",
      "password",
      "key",
      "Ocp-Apim-Subscription-Key",
    ])
      expect(isSecretName(name), name).toBe(true);
    for (const name of ["Content-Type", "Accept", "author", "monkey", "WWW-Authenticate", "page"])
      expect(isSecretName(name), name).toBe(false);
    expect(varName("X-API-Key")).toBe("xApiKey");
  });

  it("hides JSON fields, name=value pairs and known values, but keeps {{references}}", () => {
    expect(hideText('{"token":"a","id":1,"ref":"{{t}}","password":"{{pw}}"}')).toBe(
      '{"token":"(hidden)","id":1,"ref":"{{t}}","password":"{{pw}}"}',
    );
    expect(hideText("password=hunter2&user=ann")).toBe("password=(hidden)&user=ann");
    expect(hideText("Authorization: Bearer abc def\nX: 1")).toBe("Authorization: (hidden)\nX: 1");
    expect(hideText("echo v-SECRET here", ["v-SECRET"])).toBe("echo (hidden) here");
    expect(hideUrl("https://x/?token=abc&q=1&key={{k}}")).toBe(
      "https://x/?token=(hidden)&q=1&key={{k}}",
    );
  });

  it("leaves secrets out of what an agent's own request can fill in", () => {
    const [s] = withoutSecrets(scopesIn(["s-SECRET"], { token: "captured", base: "https://x" }));
    expect([...(s?.values.keys() ?? [])]).toEqual(["base"]);
    expect([...(s?.secret ?? [])].sort()).toEqual(["key", "token"]);
    const { prep, missing } = prepare(
      normalize({ url: "{{base}}/?k={{key}}", headers: [pair({ key: "A", value: "{{token}}" })] }),
      { scopes: withoutSecrets(scopesIn(["s-SECRET"], { token: "captured", base: "https://x" })) },
    );
    expect(JSON.stringify(prep)).not.toMatch(/SECRET|captured/);
    expect(missing.sort()).toEqual(["key", "token"]);
  });
});

describe("typed secrets", () => {
  it("finds them in auth, headers, the query, form fields and variables, and empties them", () => {
    const req = normalize({
      url: "https://x/?api_key=k1&page=2",
      params: [pair({ key: "api_key", value: "k1" }), pair({ key: "page", value: "2" })],
      headers: [
        pair({ key: "Authorization", value: "Bearer t1" }),
        pair({ key: "X-Token", value: "{{token}}" }),
      ],
      auth: { type: "basic", basic: { username: "ann", password: "pw" } },
      body: { mode: "form", form: [pair({ key: "client_secret", value: "cs" })] },
      vars: { pre: [pair({ key: "token", value: "v1" })], post: [] },
    });
    const found = literalSecrets(req);
    expect(found.map((l) => [l.label, l.value])).toEqual([
      ["Basic auth password", "pw"],
      ["Header Authorization", "t1"],
      ["Query api_key", "k1"],
      ["Body field client_secret", "cs"],
      ["Variable token", "v1"],
    ]);
    for (const l of found) l.put(`{{${l.name}}}`);
    expect(req.headers[0]?.value).toBe("Bearer {{authorization}}");
    expect(req.url).toBe("https://x/?api_key={{apiKey}}&page=2");
    expect(req.vars.pre).toHaveLength(0);
    const kept = withoutLiterals(
      normalize({ auth: { type: "bearer", bearer: { token: "b-SECRET" } } }),
    );
    expect(JSON.stringify(kept)).not.toContain("b-SECRET");
  });

  it("takes a HAR file's session out of its requests", () => {
    const imp = fromHar({
      log: {
        entries: [
          {
            request: {
              method: "POST",
              url: "https://shop.test/api?access_token=at1&page=1",
              headers: [
                { name: "Authorization", value: "Bearer jwt1" },
                { name: "Cookie", value: "sid=s1" },
                { name: "Accept", value: "*/*" },
              ],
              postData: { mimeType: "application/json", text: '{"password":"pw1","n":1}' },
            },
          },
          {
            request: {
              method: "GET",
              url: "https://shop.test/me",
              headers: [{ name: "Authorization", value: "Bearer jwt1" }],
            },
          },
        ],
      },
    });
    const files = JSON.stringify(imp.requests);
    for (const value of ["at1", "jwt1", "sid=s1", "pw1"]) expect(files).not.toContain(value);
    expect(imp.requests[0]?.headers.map((h) => h.value)).toEqual([
      "Bearer {{authorization}}",
      "{{cookie}}",
      "*/*",
    ]);
    expect(imp.requests[1]?.headers[0]?.value).toBe("Bearer {{authorization}}");
    expect(imp.envs[0]?.name).toBe("Recorded");
    expect(imp.envs[0]?.vars.map((v) => [v.key, v.value, v.secret])).toEqual([
      ["accessToken", "at1", true],
      ["authorization", "jwt1", true],
      ["cookie", "sid=s1", true],
      ["password", "pw1", true],
    ]);
  });
});

describe("the hash scripts are allowed by", () => {
  it("is SHA-256", () => {
    for (const text of ["", "abc", "a".repeat(64), 'test("ok", () => {}); // ✓ 한글'])
      expect(sha256(text)).toBe(createHash("sha256").update(text).digest("hex"));
  });
});
