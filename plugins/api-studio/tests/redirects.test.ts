// Redirects of a request that carries a secret, through the real curl to two local servers (two
// origins): secret headers stay on the same origin and are dropped for another, a cookie of one
// origin is never taken on to the next, and a body with a secret stops at a 307 elsewhere.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Prepared } from "../ui/curl-config.js";
import { createEngine } from "../ui/engine.js";
import { normalize, pair } from "../ui/model.js";
import { followsItself, nextHop, sendFollowing } from "../ui/redirects.js";
import { bodyJson, prepare, readResponse } from "../ui/send.js";
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

  it("takes no cookie of one origin on to the next, nor any when the jar is off", async () => {
    const seen: { url: string; cookie?: string }[] = [];
    const hops: [string, number, string][] = [
      ["https://a.test/x", 302, "https://bank.test/out"],
      ["https://bank.test/out", 302, "https://evil.test/in"],
      ["https://evil.test/in", 200, ""],
    ];
    const engine = {
      send: (prep: Prepared) => {
        seen.push({ url: prep.url, cookie: prep.headers.find((h) => h.key === "Cookie")?.value });
        const hop = hops.find(([u]) => u === prep.url) ?? ["", 500, ""];
        const head = `HTTP/1.1 ${hop[1]} X\r\n${hop[2] ? `Location: ${hop[2]}\r\n` : ""}\r\n`;
        return {
          promise: Promise.resolve({
            code: 0,
            signal: null,
            stdout: new TextEncoder().encode(head),
            stderr: "",
            cancelled: false,
          }),
          cancel: () => {},
        };
      },
    };
    const jar = (url: string) => (url.includes("bank.test") ? "bank_session=VICTIM" : "");
    const prep = prepare(
      normalize({ url: "https://a.test/x", headers: [pair({ key: "X-API-Key", value: "k1" })] }),
      { scopes: [] },
    ).prep;
    await sendFollowing(engine, prep, { cookies: jar }).promise;
    expect(seen.map((s) => [s.url, s.cookie])).toEqual([
      ["https://a.test/x", undefined],
      ["https://bank.test/out", "bank_session=VICTIM"],
      ["https://evil.test/in", undefined],
    ]);
    seen.length = 0;
    prep.settings = { ...prep.settings, cookies: false };
    await sendFollowing(engine, prep, { cookies: jar }).promise;
    expect(seen.every((s) => s.cookie === undefined)).toBe(true);
  });

  it("stops at a 307 to another origin when the body holds a secret", async () => {
    const url = `${one.url}/away?status=307&to=${encodeURIComponent(`${other.url}/echo`)}`;
    const req = normalize({
      method: "POST",
      url,
      params: paramsFromUrl(url, []),
      body: { mode: "json", json: '{"password":"{{key}}"}' },
    });
    const { prep } = prepare(req, { scopes: scopesIn(["key-SECRET"]) });
    expect(followsItself(prep)).toBe(true);
    const followed = await sendFollowing(createEngine(curlBridge()), prep).promise;
    expect(readResponse(followed.run, followed.prep, "", []).status).toBe(307);
    expect(followed.hops).toEqual([]);
  });

  it("takes no body with a secret to another origin on a 302 of a PUT, nor a typed password", async () => {
    const url = `${one.url}/away?status=302&to=${encodeURIComponent(`${other.url}/echo`)}`;
    const put = prepare(
      normalize({
        method: "PUT",
        url,
        params: paramsFromUrl(url, []),
        body: { mode: "json", json: '{"password":"{{key}}"}' },
      }),
      { scopes: scopesIn(["key-SECRET"]) },
    ).prep;
    const followed = await sendFollowing(createEngine(curlBridge()), put).promise;
    expect(readResponse(followed.run, followed.prep, "", []).status).toBe(302);

    const typedUrl = `${one.url}/away?status=307&to=${encodeURIComponent(`${other.url}/echo`)}`;
    const typed = prepare(
      normalize({
        method: "POST",
        url: typedUrl,
        params: paramsFromUrl(typedUrl, []),
        body: { mode: "form", form: [pair({ key: "password", value: "hunter2" })] },
      }),
      { scopes: [] },
    ).prep;
    expect(followsItself(typed)).toBe(true);
    const stopped = await sendFollowing(createEngine(curlBridge()), typed).promise;
    expect(readResponse(stopped.run, stopped.prep, "", []).status).toBe(307);
  });
});
