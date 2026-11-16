// What keeps state between requests and what comes in from outside: a pasted curl command as a
// request, the cookie jar, and an OAuth 2.0 token fetched through the real curl and then sent.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyAuth } from "../ui/auth.js";
import { createJar, parseSetCookie } from "../ui/cookies.js";
import { fromCurl, shellWords } from "../ui/curl-import.js";
import { createEngine } from "../ui/engine.js";
import { newRequest, normalize } from "../ui/model.js";
import { createTokens } from "../ui/oauth.js";
import { bodyJson, prepare, readResponse } from "../ui/send.js";
import { scope } from "../ui/vars.js";
import { curlBridge, testServer } from "./real-curl";

describe("a pasted curl command", () => {
  it("splits words as a shell does", () => {
    expect(shellWords(`curl -H 'A: b c' "x\\"y" $'n\\tm' a\\ b \\\n --x`)).toEqual([
      "curl",
      "-H",
      "A: b c",
      'x"y',
      "n\tm",
      "a b",
      "--x",
    ]);
  });

  it("becomes a JSON POST with headers and Basic auth", () => {
    const parsed = fromCurl(
      `curl 'https://api.example.com/v1/items?limit=2' -X POST -H 'Content-Type: application/json' -H "X-Trace: 1" -u ann:pw --data-raw '{"name":"lamp"}' --compressed -k`,
    );
    const req = parsed?.req;
    expect(req?.method).toBe("POST");
    expect(req?.url).toBe("https://api.example.com/v1/items?limit=2");
    expect(req?.params.map((p) => [p.key, p.value])).toEqual([["limit", "2"]]);
    expect(req?.headers.map((h) => h.key)).toEqual(["Content-Type", "X-Trace"]);
    expect(req?.body.mode).toBe("json");
    expect(JSON.parse(req?.body.json ?? "")).toEqual({ name: "lamp" });
    expect(req?.auth).toEqual({ type: "basic", basic: { username: "ann", password: "pw" } });
    expect(req?.settings.verifyTls).toBe(false);
  });

  it("reads forms, multipart, -G and HEAD", () => {
    expect(
      fromCurl("curl https://h/x -d a=1 -d 'b=two+words'")?.req.body.form.map((p) => [
        p.key,
        p.value,
      ]),
    ).toEqual([
      ["a", "1"],
      ["b", "two words"],
    ]);
    const multi = fromCurl("curl https://h/up -F name=x -F file=@/tmp/a.png")?.req;
    expect(multi?.method).toBe("POST");
    expect(multi?.body.multipart.map((p) => [p.key, p.value, p.kind])).toEqual([
      ["name", "x", "text"],
      ["file", "/tmp/a.png", "file"],
    ]);
    expect(fromCurl("curl -G https://h/s -d q=red")?.req.url).toBe("https://h/s?q=red");
    expect(fromCurl("curl -I https://h")?.req.method).toBe("HEAD");
    expect(fromCurl("wget https://h")).toBeUndefined();
  });
});

describe("the cookie jar", () => {
  it("keeps what servers set and sends it back where it matches", () => {
    let saved: unknown[] = [];
    const jar = createJar({ load: async () => [], save: (l) => (saved = l) });
    const now = Date.UTC(2026, 10, 17);
    jar.take(
      "https://shop.example.com/v1/login",
      [
        ["Set-Cookie", "session=abc; Path=/; HttpOnly; Secure"],
        ["Set-Cookie", "pref=dark; Domain=example.com; Path=/v1; Max-Age=60"],
        ["Set-Cookie", "old=x; Expires=Thu, 01 Jan 2020 00:00:00 GMT"],
      ],
      now,
    );
    expect(saved).toHaveLength(2);
    expect(jar.header("https://shop.example.com/v1/orders", now)).toBe("pref=dark; session=abc");
    expect(jar.header("http://shop.example.com/v1/orders", now)).toBe("pref=dark");
    expect(jar.header("https://api.example.com/v2", now)).toBe("");
    expect(jar.header("https://shop.example.com/v1", now + 61_000)).toBe("session=abc");
    expect(
      parseSetCookie("x=1; Domain=other.com", new URL("https://shop.example.com/")),
    ).toBeUndefined();
  });
});

describe("OAuth 2.0", () => {
  let server: Awaited<ReturnType<typeof testServer>>;
  beforeAll(async () => {
    server = await testServer();
  });
  afterAll(() => server.close());

  it("fetches a token with client credentials and sends it", async () => {
    const base = curlBridge();
    const store = new Map<string, unknown>();
    const bridge = {
      onEvent: base.onEvent,
      call: async (method: string, params: Record<string, unknown>): Promise<unknown> => {
        if (method === "store.get") return { value: store.get(String(params.key)) };
        if (method === "store.set") {
          store.set(String(params.key), params.value);
          return {};
        }
        return base.call(method, params);
      },
    };
    const req = normalize({
      url: `${server.url}/echo`,
      auth: {
        type: "oauth2",
        oauth2: {
          grant: "client_credentials",
          tokenUrl: "{{base}}/token",
          clientId: "app",
          clientSecret: "{{secret}}",
        },
      },
    });
    const scopes = [scope("env", "Env", { base: server.url, secret: "shh" })];
    const tab = { id: "t", req, saved: null, reqTab: "auth", resTab: "body" };
    const S = {
      ctx: { bridge },
      engine: createEngine(bridge),
      scopes: () => scopes,
      parentAuth: () => [],
    };
    const tokens = createTokens(S as never);
    await tokens.ensure(tab as never);
    expect(tokens.heldFor(tab as never)?.token).toBe("tok-1");
    expect(applyAuth(req.auth, (t) => t, tokens.lookup(tab as never)).headers).toEqual([
      { key: "Authorization", value: "Bearer tok-1" },
    ]);
    const { prep, bodyText } = prepare(req, { scopes, tokenFor: tokens.lookup(tab as never) });
    const res = readResponse(await S.engine.send(prep).promise, prep, bodyText, []);
    const echoed = bodyJson(res)?.value as { headers: Record<string, string> } | undefined;
    expect(echoed?.headers.authorization).toBe("Bearer tok-1");
    expect(JSON.stringify(store.get("oauth"))).toContain("tok-1");
    expect(JSON.stringify(newRequest())).not.toContain("tok-1");
  });
});
