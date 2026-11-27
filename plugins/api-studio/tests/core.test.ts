// The parts without DOM: the URL and its Params rows, variables, auth, curl's config and what
// curl writes back.
import { describe, expect, it } from "vitest";
import { applyAuth, effectiveAuth } from "../ui/auth.js";
import { curlCommand, curlConfig, quote } from "../ui/curl-config.js";
import { parseBlock, splitErr, splitOutput, timings } from "../ui/curl-parse.js";
import { newRequest, normalize, pair } from "../ui/model.js";
import { prepare } from "../ui/send.js";
import { paramsFromUrl, pathVariables, urlFromParams, wireUrl } from "../ui/url.js";
import { resolve, scope, tokens } from "../ui/vars.js";

const enc = (text: string) => new TextEncoder().encode(text);

describe("the URL and the Params rows", () => {
  it("makes rows from a typed query and keeps disabled rows", () => {
    const off = pair({ key: "debug", value: "1", on: false });
    const rows = paramsFromUrl("https://api.test/items?page=2&q=red+shoes&flag", [off]);
    expect(rows.map((r) => [r.key, r.value, r.on])).toEqual([
      ["debug", "1", false],
      ["page", "2", true],
      ["q", "red shoes", true],
      ["flag", "", true],
    ]);
  });

  it("rewrites the query from the rows, keeping {{variables}} readable", () => {
    const url = urlFromParams("{{base}}/items?old=1#top", [
      pair({ key: "page", value: "{{page}}" }),
      pair({ key: "tag", value: "a&b" }),
      pair({ key: "skip", value: "x", on: false }),
    ]);
    expect(url).toBe("{{base}}/items?page={{page}}&tag=a%26b#top");
    expect(paramsFromUrl(url, []).map((r) => r.value)).toEqual(["{{page}}", "a&b"]);
  });

  it("encodes components for the wire and adds a scheme when missing", () => {
    expect(wireUrl("api.test/a b", [{ key: "q", value: "x y/z" }])).toBe(
      "https://api.test/a%20b?q=x%20y%2Fz",
    );
    expect(wireUrl("localhost:3000/x", [])).toBe("http://localhost:3000/x");
    expect(pathVariables("https://h/users/:id/posts/:postId")).toEqual(["id", "postId"]);
  });
});

describe("variables", () => {
  const scopes = [
    scope("request", "Request", [pair({ key: "id", value: "42" })]),
    scope("env", "Local", { base: "http://localhost:{{port}}", port: "8080", id: "1" }),
  ];

  it("fills names from the narrowest scope, nested names too", () => {
    expect(resolve("{{base}}/users/{{id}}", scopes)).toBe("http://localhost:8080/users/42");
  });

  it("leaves unknown names as typed and reports them", () => {
    const missing = new Set<string>();
    expect(resolve("{{nope}}/x", scopes, missing)).toBe("{{nope}}/x");
    expect([...missing]).toEqual(["nope"]);
  });

  it("makes dynamic values and marks each token's state", () => {
    expect(resolve("{{$uuid}}", [])).toMatch(/^[0-9a-f-]{36}$/);
    const states = tokens("a {{id}} {{$timestamp}} {{gone}}", scopes)
      .filter((t) => "state" in t)
      .map((t) => ("state" in t ? t.state : ""));
    expect(states).toEqual(["set", "dynamic", "missing"]);
  });
});

describe("auth", () => {
  it("inherits from the nearest parent that sets one", () => {
    const { auth, from } = effectiveAuth({ type: "inherit" }, [
      { type: "inherit" },
      { type: "bearer", bearer: { token: "t" } },
    ]);
    expect([auth.type, from]).toEqual(["bearer", 1]);
  });

  it("puts each type where it belongs", () => {
    const fill = (t: string) => t;
    expect(
      applyAuth({ type: "basic", basic: { username: "ann", password: "pw" } }, fill).headers,
    ).toEqual([{ key: "Authorization", value: "Basic YW5uOnB3" }]);
    expect(
      applyAuth({ type: "apikey", apikey: { key: "api_key", value: "k", in: "query" } }, fill)
        .query,
    ).toEqual([{ key: "api_key", value: "k" }]);
    expect(
      applyAuth({ type: "digest", digest: { username: "a", password: "b" } }, fill).curl,
    ).toEqual({
      mode: "digest",
      user: "a:b",
    });
    expect(
      applyAuth(
        {
          type: "awsv4",
          awsv4: { accessKey: "AK", secretKey: "SK", region: "eu-west-1", service: "s3" },
        },
        fill,
      ).curl?.provider,
    ).toBe("aws:amz:eu-west-1:s3");
  });
});

describe("curl's config", () => {
  const req = normalize({
    method: "POST",
    url: "{{base}}/login",
    headers: [pair({ key: "X-Trace", value: "{{$uuid}}" })],
    body: { mode: "json", json: '{"user":"{{user}}","note":"a \\"quoted\\"\\nline"}' },
    auth: { type: "bearer", bearer: { token: "{{token}}" } },
  });
  const scopes = [scope("env", "Env", { base: "https://api.test", user: "ann", token: "s3cret" })];

  it("keeps the request out of the arguments and quotes every value", () => {
    const { prep, missing } = prepare(req, { scopes });
    expect(missing).toEqual([]);
    const config = curlConfig(prep);
    expect(config).toContain('url = "https://api.test/login"');
    expect(config).toContain('request = "POST"');
    expect(config).toContain('header = "Authorization: Bearer s3cret"');
    expect(config).toContain('header = "Content-Type: application/json"');
    expect(config).toContain(
      `data-raw = ${quote('{"user":"ann","note":"a \\"quoted\\"\\nline"}')}`,
    );
    expect(quote('a"b\\c\nd')).toBe('"a\\"b\\\\c\\nd"');
  });

  it("asks HEAD with head and copies as a pasteable command", () => {
    const { prep } = prepare(newRequest({ method: "HEAD", url: "https://h/x" }), { scopes: [] });
    expect(curlConfig(prep)).toContain("head");
    expect(curlConfig(prep)).not.toContain("dump-header");
    const { prep: post } = prepare(req, { scopes });
    expect(curlCommand(post)).toMatch(/^curl -X POST https:\/\/api\.test\/login/);
  });

  it("encodes a form body and lets a named content type stand", () => {
    const form = normalize({
      method: "POST",
      url: "https://h",
      headers: [
        pair({ key: "content-type", value: "application/x-www-form-urlencoded; charset=utf-8" }),
      ],
      body: { mode: "form", form: [pair({ key: "a b", value: "c&d" })] },
    });
    const { prep } = prepare(form, { scopes: [] });
    expect(prep.body).toEqual({ kind: "raw", text: "a+b=c%26d" });
    expect(prep.headers.filter((h) => /content-type/i.test(h.key))).toHaveLength(1);
  });
});

describe("what curl writes", () => {
  it("splits redirect blocks, the final block and the body", () => {
    const out = enc(
      "HTTP/1.1 302 Found\r\nLocation: /b\r\n\r\nHTTP/1.1 200 OK\r\nContent-Type: application/json\r\nX-A: 1\r\n\r\nHTTP/1.1 is in the body",
    );
    const { blocks, body } = splitOutput(out, { redirects: 1 });
    expect(blocks.map((b) => b.status)).toEqual([302, 200]);
    expect(new TextDecoder().decode(body)).toBe("HTTP/1.1 is in the body");
    expect(parseBlock("HTTP/2 404\r\nserver: x\r\n")?.reason).toBe("");
  });

  it("reads the report after the marker and splits the timings", () => {
    const report = {
      time_namelookup: 0.01,
      time_connect: 0.03,
      time_appconnect: 0.07,
      time_pretransfer: 0.071,
      time_starttransfer: 0.171,
      time_total: 0.2,
      time_redirect: 0,
    };
    const { log, report: read } = splitErr(
      `* Connected\n> GET / HTTP/1.1\n\n@@endue-api-studio:report@@\n${JSON.stringify(report)}`,
    );
    expect(log).toContain("Connected");
    const t = timings(read);
    expect(Math.round(t.dns)).toBe(10);
    expect(Math.round(t.tcp)).toBe(20);
    expect(Math.round(t.tls)).toBe(40);
    expect(Math.round(t.wait)).toBe(101);
    expect(Math.round(t.download)).toBe(29);
    expect(Math.round(t.total)).toBe(200);
  });
});
