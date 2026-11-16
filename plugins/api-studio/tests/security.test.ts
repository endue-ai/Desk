// What keeps a request from carrying more than the person meant, without DOM: curl speaks only
// HTTP(S), header names cannot reach curl's @file form, only plain paths count as inside a
// collection, generated code cannot run what a value holds, secret names and values are hidden
// from what an assistant or agent reads, and the hashes scripts are allowed by are SHA-256.
// Redirects are in redirects.test.ts, typed secrets and HAR files in literals.test.ts.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { GENERATORS, hideSecrets } from "../ui/codegen.js";
import { curlCommand, curlConfig, headerLine } from "../ui/curl-config.js";
import { createEngine } from "../ui/engine.js";
import { filesRead, inside, segments } from "../ui/file-guard.js";
import { normalize, pair } from "../ui/model.js";
import {
  hideFailure,
  hideText,
  hideUrl,
  hideValues,
  isSecretName,
  varName,
  withoutSecrets,
} from "../ui/secret-names.js";
import { prepare } from "../ui/send.js";
import { sha256 } from "../ui/sha256.js";
import { curlBridge } from "./real-curl";
import { scopesIn } from "./scopes";

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
    expect(segments("/a/b/c")).toEqual(["", "a", "b", "c"]);
    expect(segments("C:\\Users\\a")).toEqual(["C:", "Users", "a"]);
    // curl resolves . and .. through symlinks, so a path naming them is never taken as inside.
    expect(segments("/a/./b")).toBeUndefined();
    expect(segments("~/x/../y")).toBeUndefined();
    expect(segments("data.bin")).toBeUndefined();
    // A backslash is a name's own character on macOS and Linux, not a separator.
    expect(segments("/c/a\\b/x")).toEqual(["", "c", "a\\b", "x"]);
    expect(inside("/c/l/../hosts", "/c")).toBe(false);
    expect(inside("~/api/data/in.bin", "~/api")).toBe(true);
    expect(inside("~/api/../.ssh/id_rsa", "~/api")).toBe(false);
    expect(inside("~/api-other/x", "~/api")).toBe(false);
    expect(inside("~/api", "~/api")).toBe(false);
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
    for (const name of [
      "Content-Type",
      "Accept",
      "author",
      "monkey",
      "WWW-Authenticate",
      "page",
      "Idempotency-Key",
      "Sec-WebSocket-Key",
      "page_token",
      "nextPageToken",
      "sort_key",
      "X-Session-Language",
      "tokenUrl",
      "token_type",
    ])
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
    expect(hideValues("q=Ab%2BcD%2FeF%3D%3D&n=a+b", ["Ab+cD/eF==", "a b c"])).toBe(
      "q=(hidden)&n=a+b",
    );
    expect(hideFailure("res.body.access_token", "res.body.access_token isEmpty: at1", [])).toBe(
      "res.body.access_token: failed (its value is hidden)",
    );
    expect(hideFailure("res.status", 'res.status eq "sk-SECRET", got 200', ["sk-SECRET"])).toBe(
      'res.status eq "(hidden)", got 200',
    );
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

describe("the hash scripts are allowed by", () => {
  it("is SHA-256", () => {
    for (const text of ["", "abc", "a".repeat(64), 'test("ok", () => {}); // ✓ 한글'])
      expect(sha256(text)).toBe(createHash("sha256").update(text).digest("hex"));
  });
});
