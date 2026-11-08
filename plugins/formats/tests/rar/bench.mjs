// The speed check: decodes a large RAR from disk in Node, reading it in ranges as the desk does,
// and prints MB/s, peak memory and the longest the event loop waited. Usage:
//   node bench.mjs <archive.rar> [original]   (make-fixtures.sh --large <dir> makes both)
import { createHash } from "node:crypto";
import { open, readFile } from "node:fs/promises";
import { openRar } from "../../lib/rar/index.js";

const [path, originalPath] = process.argv.slice(2);
if (!path) throw new Error("usage: node bench.mjs <archive.rar> [original]");
const file = await open(path);
const { size } = await file.stat();
const source = {
  size,
  read: async (/** @type {number} */ offset, /** @type {number} */ length) => {
    const buffer = new Uint8Array(Math.max(0, Math.min(length, size - offset)));
    await file.read(buffer, 0, buffer.length, offset);
    return buffer;
  },
};
let longest = 0;
let last = performance.now();
const timer = setInterval(() => {
  const now = performance.now();
  longest = Math.max(longest, now - last);
  last = now;
}, 1);
const archive = await openRar(source);
for (const entry of archive.entries.filter((e) => e.kind === "file")) {
  const start = performance.now();
  const bytes = await archive.read(entry);
  const seconds = (performance.now() - start) / 1000;
  const mb = bytes.length / 1048576;
  console.log(
    `${archive.format} ${entry.path} (${entry.method}): ${mb.toFixed(0)} MB in ${seconds.toFixed(2)} s, ` +
      `${(mb / seconds).toFixed(1)} MB/s, CRC checked`,
  );
  if (originalPath) {
    const want = createHash("sha256")
      .update(await readFile(originalPath))
      .digest("hex");
    const got = createHash("sha256").update(bytes).digest("hex");
    console.log(got === want ? "matches the original" : "DIFFERS from the original");
  }
}
clearInterval(timer);
await file.close();
console.log(
  `peak memory ${(process.resourceUsage().maxRSS / 1024).toFixed(0)} MB (resident), ` +
    `longest event-loop wait ${longest.toFixed(1)} ms`,
);
