// The engine end to end: a request goes through the real curl to a local server, and what comes
// back is read as a response (status, headers, body, redirects, timings, the timeline).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createEngine } from "../ui/engine.js";
import { normalize, pair } from "../ui/model.js";
import { bodyJson, prepare, readResponse } from "../ui/send.js";
import { scope } from "../ui/vars.js";
import { curlBridge, testServer } from "./real-curl";

let server: Awaited<ReturnType<typeof testServer>>;
beforeAll(async () => {
  server = await testServer();
});
afterAll(() => server.close());

async function send(raw: Record<string, unknown>, vars: Record<string, string> = {}) {
  const bridge = curlBridge();
  const engine = createEngine(bridge);
  const req = normalize(raw);
  const { prep, missing, bodyText } = prepare(req, {
    scopes: [scope("env", "Env", { base: server.url, ...vars })],
  });
  const run = await engine.send(prep).promise;
  return { res: readResponse(run, prep, bodyText, missing), bridge };
}

describe("the engine", () => {
  it("sends a JSON POST and reads the answer, with the config on stdin only", async () => {
    const { res, bridge } = await send(
      {
        method: "POST",
        url: "{{base}}/echo?x=1",
        params: [pair({ key: "x", value: "1" })],
        headers: [pair({ key: "X-Secret", value: "{{secret}}" })],
        body: { mode: "json", json: '{"hello":"world"}' },
      },
      { secret: "s3cret" },
    );
    expect(res.error).toBeUndefined();
    expect(res.status).toBe(200);
    expect(res.reason).toBe("OK");
    const echoed = bodyJson(res)?.value;
    expect(echoed.method).toBe("POST");
    expect(echoed.query).toEqual({ x: "1" });
    expect(echoed.body).toBe('{"hello":"world"}');
    expect(echoed.headers["x-secret"]).toBe("s3cret");
    expect(echoed.headers["content-type"]).toBe("application/json");
    expect(echoed.headers.expect).toBeUndefined();
    expect(res.headers.filter(([k]) => k.toLowerCase() === "set-cookie")).toHaveLength(2);
    expect(res.timings.total).toBeGreaterThan(0);
    expect(res.sent.headers.some(([k]) => k === "X-Secret")).toBe(true);
    const spawn = bridge.calls.find((c) => c.method === "proc.spawn");
    expect(JSON.stringify(spawn?.params.args)).not.toContain("s3cret");
  });

  it("follows a redirect and keeps the hop", async () => {
    const { res } = await send({ url: "{{base}}/redirect" });
    expect(res.status).toBe(200);
    expect(res.hops).toEqual([{ status: 302, reason: "Found", location: "/echo?from=redirect" }]);
    expect(bodyJson(res)?.value.query).toEqual({ from: "redirect" });
  });

  it("stops at a redirect when asked not to follow", async () => {
    const { res } = await send({ url: "{{base}}/redirect", settings: { followRedirects: false } });
    expect(res.status).toBe(302);
    expect(res.headers.find(([k]) => k.toLowerCase() === "location")?.[1]).toBe(
      "/echo?from=redirect",
    );
  });

  it("reads an error status as a response and a dead port as an error", async () => {
    const { res } = await send({ url: "{{base}}/status/418" });
    expect(res.status).toBe(418);
    expect(res.reason.toLowerCase()).toBe("i'm a teapot");
    const dead = await send({ url: "http://127.0.0.1:9/x", settings: { timeoutMs: 3000 } });
    expect(dead.res.status).toBe(0);
    expect(dead.res.error).toMatch(/connect|refused|Failed/i);
  });

  it("times out as asked", async () => {
    const { res } = await send({ url: "{{base}}/slow", settings: { timeoutMs: 300 } });
    expect(res.error).toMatch(/timed out|Timeout/i);
  });

  it("cancels a request in flight", async () => {
    const bridge = curlBridge();
    const engine = createEngine(bridge);
    const { prep, bodyText } = prepare(normalize({ url: `${server.url}/slow` }), { scopes: [] });
    const running = engine.send(prep);
    setTimeout(() => running.cancel(), 200);
    const res = readResponse(await running.promise, prep, bodyText, []);
    expect(res.cancelled).toBe(true);
    expect(res.error).toBe("Cancelled.");
  });
});
