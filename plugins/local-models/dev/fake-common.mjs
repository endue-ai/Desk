// What the made-up servers share: a pause, reading a JSON body, answering JSON, the JSON answer a
// model held to a schema gives, and listening on a port.
import { createServer } from "node:http";

export const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));

/** What a model held to JSON answers. @param {{ role: string, content: unknown }[]} messages */
export function jsonAnswer(messages) {
  const asked = String(messages.findLast((m) => m.role === "user")?.content ?? "");
  return JSON.stringify({
    answer: `A structured answer to: ${asked.slice(0, 60)}`,
    confidence: 0.82,
    tags: ["local", "structured"],
  });
}

/** @param {import("node:http").IncomingMessage} req */
export async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const text = Buffer.concat(chunks).toString("utf8");
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}

/** @param {import("node:http").ServerResponse} res @param {number} status @param {unknown} body */
export function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

/** @param {number} port @param {(req: any, res: any) => void} handler */
export function listen(port, handler) {
  return new Promise((resolve) => {
    const server = createServer((req, res) => void handler(req, res));
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}
