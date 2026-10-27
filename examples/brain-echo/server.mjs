#!/usr/bin/env node
// brain-echo: the smallest brain. Serves specs/brain/v0/openapi.yaml under /v0 with Node's standard
// library only; the answers come from brain.mjs.
//
//   node examples/brain-echo/server.mjs [--port 8787]     --port 0 picks a free port
//
// BRAIN_ECHO_DELAY_MS   pause between streamed events (default 40, so the streaming shows)
// BRAIN_ECHO_SECOND_MS  real milliseconds in one lease second (default 1000; tests use 20)
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { BrainError, EchoBrain, scaledClock } from "./brain.mjs";

const PREFIX = "/v0";
const MAX_BODY = 1024 * 1024;

// [method, path pattern, handler(brain, params, body) -> [status, body] or ["stream", events]]
const ROUTES = [
  ["POST", /^\/sessions$/, (b, _params, body) => [201, b.createSession(body)]],
  ["GET", /^\/sessions\/([^/]+)$/, (b, [s]) => [200, b.getSession(s)]],
  ["POST", /^\/sessions\/([^/]+)\/turns$/, (b, [s], body) => ["stream", b.startTurn(s, body)]],
  [
    "POST",
    /^\/sessions\/([^/]+)\/turns\/([^/]+)\/tool-results$/,
    (b, [s, t], body) => ["stream", b.submitToolResult(s, t, body)],
  ],
  ["GET", /^\/sessions\/([^/]+)\/lease$/, (b, [s]) => [200, b.getLease(s)]],
  ["POST", /^\/sessions\/([^/]+)\/lease$/, (b, [s], body) => [200, b.acquireLease(s, body)]],
  [
    "PUT",
    /^\/sessions\/([^/]+)\/lease\/([^/]+)$/,
    (b, [s, l], body) => [200, b.renewLease(s, l, body)],
  ],
  ["DELETE", /^\/sessions\/([^/]+)\/lease\/([^/]+)$/, (b, [s, l]) => [204, b.releaseLease(s, l)]],
];

function route(method, path) {
  if (!path.startsWith(`${PREFIX}/`)) return undefined;
  const rest = path.slice(PREFIX.length);
  for (const [m, pattern, handler] of ROUTES) {
    const match = m === method && pattern.exec(rest);
    if (match) return { handler, params: match.slice(1).map(decodeURIComponent) };
  }
  return undefined;
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY) throw new BrainError(400, "invalid_request", "The body is too large.");
    chunks.push(chunk);
  }
  if (size === 0) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new BrainError(400, "invalid_request", "The body is not JSON.");
  }
}

function sendJson(response, status, body) {
  if (status === 204) {
    response.writeHead(204).end();
    return;
  }
  response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
}

async function stream(response, events, delayMs) {
  response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store" });
  for (const [i, event] of events.entries()) {
    if (i > 0 && delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    response.write(`data: ${JSON.stringify(event)}\n\n`);
  }
  response.end();
}

async function handle(brain, request, response, delayMs) {
  try {
    const path = new URL(request.url ?? "/", "http://brain-echo").pathname;
    const found = route(request.method, path);
    if (!found) throw new BrainError(404, "not_found", `Nothing at ${request.method} ${path}.`);
    const body = await readJson(request);
    const [status, result] = found.handler(brain, found.params, body);
    if (status === "stream") await stream(response, result, delayMs);
    else sendJson(response, status, result);
  } catch (error) {
    if (error instanceof BrainError) sendJson(response, error.status, error.toJSON());
    else sendJson(response, 500, { code: "internal", message: String(error?.message ?? error) });
  }
}

/** Start brain-echo; resolves with the listening server. */
export function serve({ port = 8787, host = "127.0.0.1", delayMs = 40, secondMs = 1000 } = {}) {
  const brain = new EchoBrain({ now: scaledClock(secondMs) });
  const server = createServer(
    (request, response) => void handle(brain, request, response, delayMs),
  );
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve(server));
  });
}

function option(name, fallback) {
  const at = process.argv.indexOf(name);
  return at > 0 && process.argv[at + 1] !== undefined ? process.argv[at + 1] : fallback;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const server = await serve({
    port: Number(option("--port", "8787")),
    delayMs: Number(process.env.BRAIN_ECHO_DELAY_MS ?? 40),
    secondMs: Number(process.env.BRAIN_ECHO_SECOND_MS ?? 1000),
  });
  const { port } = server.address();
  console.log(`brain-echo listening on http://127.0.0.1:${port}${PREFIX}`);
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => server.close(() => process.exit(0)));
}
