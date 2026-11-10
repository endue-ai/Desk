#!/usr/bin/env node
// A release origin on this machine for the update smoke (update-two-hops.sh): the files under
// <folder> over plain HTTP on 127.0.0.1, read-only, with their lengths so a download's progress and
// a cut-short body both show, and keep-alive as R2 answers.
//   node e2e/smoke/serve-origin.mjs <folder> <port>
import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { join, normalize, resolve, sep } from "node:path";

const [folder, port] = process.argv.slice(2);
const root = resolve(folder);

createServer((request, response) => {
  const path = decodeURIComponent(new URL(request.url, "http://origin").pathname);
  const file = normalize(join(root, path));
  let size;
  try {
    size =
      file.startsWith(`${root}${sep}`) && request.method === "GET"
        ? statSync(file).size
        : undefined;
  } catch {
    size = undefined;
  }
  if (size === undefined) {
    response.writeHead(404, { "content-length": 0 }).end();
    return;
  }
  response.writeHead(200, { "content-length": size, "content-type": "application/octet-stream" });
  createReadStream(file).pipe(response);
}).listen(Number(port), "127.0.0.1", () => console.log(`serving ${root} on 127.0.0.1:${port}`));
