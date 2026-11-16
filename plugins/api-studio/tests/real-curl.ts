// A bridge whose proc.spawn runs the real curl (only curl, without a shell), and a small HTTP
// server to send to, for the tests that go end to end.
import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

type Listener = (event: { event: string; data: Record<string, unknown> }) => void;

export function curlBridge() {
  const listeners = new Set<Listener>();
  const emit: Listener = (event) => {
    for (const l of listeners) l(event);
  };
  const children = new Map<string, ReturnType<typeof spawn>>();
  let next = 0;
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  return {
    calls,
    onEvent: (l: Listener) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    call: async (method: string, params: Record<string, unknown>) => {
      calls.push({ method, params });
      if (method === "proc.spawn") {
        if (params.command !== "curl")
          throw Object.assign(new Error("denied"), { code: "permission_denied" });
        const procId = `p${++next}`;
        const child = spawn("curl", params.args as string[], { shell: false });
        children.set(procId, child);
        const out = (stream: "stdout" | "stderr") => (chunk: Buffer) =>
          emit({
            event: "proc.output",
            data: { procId, stream, data: chunk.toString("base64"), encoding: "base64" },
          });
        child.stdout?.on("data", out("stdout"));
        child.stderr?.on("data", out("stderr"));
        child.on("close", (code, signal) =>
          emit({
            event: "proc.exit",
            data: { procId, code: code ?? undefined, signal: signal ? "kill" : undefined },
          }),
        );
        return { procId };
      }
      if (method === "proc.write") {
        const child = children.get(String(params.procId));
        child?.stdin?.write(String(params.data));
        if (params.close) child?.stdin?.end();
        return {};
      }
      if (method === "proc.kill") {
        children.get(String(params.procId))?.kill("SIGKILL");
        return {};
      }
      throw Object.assign(new Error(method), { code: "unsupported" });
    },
  };
}

async function readBody(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

/** A server that echoes what it got, redirects, waits and answers any status. */
export async function testServer(): Promise<{
  url: string;
  close(): Promise<void>;
  server: Server;
}> {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const body = await readBody(req);
    if (url.pathname === "/redirect") {
      res.writeHead(302, { location: "/echo?from=redirect" });
      res.end();
      return;
    }
    if (url.pathname === "/away") {
      res.writeHead(Number(url.searchParams.get("status") ?? 302), {
        location: url.searchParams.get("to") ?? "/echo",
      });
      res.end();
      return;
    }
    if (url.pathname === "/slow") {
      setTimeout(() => res.end("late"), 5000);
      return;
    }
    if (url.pathname === "/token") {
      const ok =
        req.headers.authorization === `Basic ${Buffer.from("app:shh").toString("base64")}` &&
        /grant_type=client_credentials/.test(body);
      res.writeHead(ok ? 200 : 401, { "content-type": "application/json" });
      res.end(
        JSON.stringify(
          ok
            ? { access_token: "tok-1", token_type: "Bearer", expires_in: 60 }
            : { error: "invalid_client" },
        ),
      );
      return;
    }
    if (url.pathname.startsWith("/status/")) {
      res.writeHead(Number(url.pathname.slice(8)), { "content-type": "text/plain" });
      res.end("status");
      return;
    }
    res.writeHead(200, {
      "content-type": "application/json",
      "set-cookie": ["a=1; Path=/", "b=2; Path=/"],
    });
    res.end(
      JSON.stringify({
        method: req.method,
        path: url.pathname,
        query: Object.fromEntries(url.searchParams),
        headers: req.headers,
        body,
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    server,
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
