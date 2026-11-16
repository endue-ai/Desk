// HTTP over bridge sockets against a real server: chunked, sized and until-close bodies, errors in
// words, aborts; the line, event-stream and NDJSON readers; and the socket limit.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fetchJson, HttpError, request, target } from "../ui/http.js";
import { createSockets, MAX_OPEN, scopeFor } from "../ui/net.js";
import { lines, ndjson, sse } from "../ui/streams.js";
import { mayOpen, splitThink } from "../ui/think.js";
import { type NodeBridge, nodeBridge } from "./node-bridge.js";

let server: Server;
let port = 0;
let bridge: NodeBridge;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === "/chunked") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.write("hello ");
      setTimeout(() => res.end("world"), 20);
    } else if (req.url === "/sized") {
      res.writeHead(200, { "content-length": "5" });
      res.end("12345");
    } else if (req.url === "/close") {
      res.socket?.write("HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n\r\nuntil the end");
      res.socket?.end();
    } else if (req.url === "/echo") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ method: req.method, body, type: req.headers["content-type"] }));
      });
    } else if (req.url === "/error") {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "model failed to load" } }));
    } else if (req.url === "/slow") {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write("data: 1\n\n");
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  port = (server.address() as AddressInfo).port;
  bridge = nodeBridge();
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  bridge.close();
});

const bytes = (text: string) => new TextEncoder().encode(text);
async function* from(parts: string[]) {
  for (const p of parts) yield bytes(p);
}

describe("http over sockets", () => {
  it("reads a chunked body as it streams", async () => {
    const sockets = createSockets(bridge);
    const res = await request(sockets, `http://127.0.0.1:${port}/chunked`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("text/plain");
    expect(await res.text()).toBe("hello world");
  });

  it("reads a sized body and one that runs to the connection's end", async () => {
    const sockets = createSockets(bridge);
    expect(await (await request(sockets, `http://127.0.0.1:${port}/sized`)).text()).toBe("12345");
    expect(await (await request(sockets, `http://127.0.0.1:${port}/close`)).text()).toBe(
      "until the end",
    );
  });

  it("sends JSON and reads it back", async () => {
    const sockets = createSockets(bridge);
    const answer = await fetchJson(sockets, `http://127.0.0.1:${port}/echo`, { json: { a: 1 } });
    expect(answer).toEqual({ method: "POST", body: '{"a":1}', type: "application/json" });
  });

  it("turns an error status into the server's words", async () => {
    const sockets = createSockets(bridge);
    await expect(fetchJson(sockets, `http://127.0.0.1:${port}/error`)).rejects.toMatchObject({
      message: "model failed to load",
      status: 500,
    });
  });

  it("refuses a closed port with io_error, and https", async () => {
    const sockets = createSockets(bridge);
    await expect(request(sockets, "http://127.0.0.1:1/")).rejects.toMatchObject({
      code: "io_error",
    });
    expect(() => target("https://example.com/")).toThrow(HttpError);
  });

  it("stops a stream when aborted and frees its socket", async () => {
    const sockets = createSockets(bridge);
    const controller = new AbortController();
    const res = await request(sockets, `http://127.0.0.1:${port}/slow`, {
      signal: controller.signal,
    });
    const events: string[] = [];
    const reading = (async () => {
      for await (const e of sse(res.body)) {
        events.push(e.data);
        controller.abort();
      }
    })();
    await expect(reading).rejects.toMatchObject({ code: "aborted" });
    expect(events).toEqual(["1"]);
    expect(sockets.active).toBe(0);
  });

  it("keeps at most MAX_OPEN sockets and queues the rest", async () => {
    const sockets = createSockets(bridge);
    const opened = await Promise.all(
      Array.from({ length: MAX_OPEN }, () => sockets.connect({ host: "127.0.0.1", port })),
    );
    let late = false;
    const waiting = sockets.connect({ host: "127.0.0.1", port }).then((s) => {
      late = true;
      return s;
    });
    await new Promise((r) => setTimeout(r, 60));
    expect(late).toBe(false);
    opened[0].close();
    const s = await waiting;
    expect(late).toBe(true);
    for (const o of [...opened, s]) o.close();
  });

  it("scopes local hosts by the manifest and others by host and port", () => {
    expect(scopeFor("127.0.0.1", 1234)).toEqual({
      permission: "net:connect",
      hosts: ["localhost", "127.0.0.1"],
    });
    expect(scopeFor("Studio.local", 11434)).toEqual({
      permission: "net:connect",
      hosts: ["studio.local:11434"],
    });
  });

  it("asks once for a computer on the network", async () => {
    const asking = nodeBridge({ grant: false });
    const sockets = createSockets(asking);
    await expect(sockets.connect({ host: "studio.local", port: 11434 })).rejects.toMatchObject({
      code: "permission_denied",
    });
    expect(asking.calls.filter((c) => c.method === "perm.request")).toHaveLength(1);
    await expect(sockets.connect({ host: "studio.local", port: 11434 })).rejects.toMatchObject({
      code: "permission_denied",
    });
    expect(asking.calls.filter((c) => c.method === "perm.request")).toHaveLength(1);
    asking.close();
  });
});

describe("stream readers", () => {
  it("splits lines across chunks", async () => {
    const out: string[] = [];
    for await (const l of lines(from(["a\r\nb", "c\n", "d"]))) out.push(l);
    expect(out).toEqual(["a", "bc", "d"]);
  });

  it("reads server-sent events with multi-line data and comments", async () => {
    const out: { event: string; data: string }[] = [];
    for await (const e of sse(
      from([": ping\n", 'data: {"a":', "1}\n\n", "event: done\ndata: x\ndata: y\n\n"]),
    ))
      out.push(e);
    expect(out).toEqual([
      { event: "message", data: '{"a":1}' },
      { event: "done", data: "x\ny" },
    ]);
  });

  it("reads one JSON value per line", async () => {
    const out: unknown[] = [];
    for await (const v of ndjson(from(['{"a":1}\n\n{"b"', ":2}\n"]))) out.push(v);
    expect(out).toEqual([{ a: 1 }, { b: 2 }]);
  });
});

describe("inline reasoning", () => {
  it("takes <think> out of an answer, open while it streams", () => {
    expect(splitThink("<think>\nplan it")).toEqual({
      reasoning: "plan it",
      content: "",
      open: true,
    });
    expect(splitThink("<think>plan</think>\n\nThe answer")).toEqual({
      reasoning: "plan",
      content: "The answer",
      open: false,
    });
    expect(splitThink("plan</think>answer")).toEqual({
      reasoning: "plan",
      content: "answer",
      open: false,
    });
    expect(splitThink("Plain answer")).toEqual({
      reasoning: "",
      content: "Plain answer",
      open: false,
    });
    expect(mayOpen("<thi")).toBe(true);
    expect(mayOpen("Hello")).toBe(false);
  });
});
