// The candidate downloads and public echo service share only container loopback.
import { createReadStream, readdirSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { serve } from "../../examples/brain-echo/server.mjs";

const dist = process.argv[2];
const files = new Set(readdirSync(dist));
await serve({ port: 8787, delayMs: 0 });
createServer((request, reply) => {
  const name = request.url?.slice(1);
  if (!files.has(name)) {
    reply.writeHead(404).end();
    return;
  }
  createReadStream(join(dist, name)).pipe(reply);
}).listen(8788, "127.0.0.1", () => console.log("CLI fixture ready"));
