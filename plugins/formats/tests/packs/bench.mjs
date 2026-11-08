// Times the pack readers on a real file: open (list) it, then read every file, reporting the entry
// count, the bytes decoded and the speed. The kind comes from the name or the first bytes.
// Run: node plugins/formats/tests/packs/bench.mjs <image.snap|.squashfs|.AppImage|.wim|.esd>
import { open } from "node:fs/promises";
import { openAppImage, openSquashfs, openWim } from "../../lib/packs/index.js";

const path = process.argv[2];
if (!path) {
  console.error("usage: node bench.mjs <image>");
  process.exit(2);
}
const file = await open(path, "r");
const { size } = await file.stat();
const source = {
  size,
  read: async (/** @type {number} */ offset, /** @type {number} */ length) => {
    const n = Math.max(0, Math.min(length, size - offset));
    const buffer = new Uint8Array(n);
    let done = 0;
    while (done < n) {
      const { bytesRead } = await file.read(buffer, done, n - done, offset + done);
      if (!bytesRead) break;
      done += bytesRead;
    }
    return buffer.subarray(0, done);
  },
};
const head = await source.read(0, 8);
const ascii = new TextDecoder("latin1").decode(head);
const opener = ascii.startsWith("MSWIM")
  ? openWim
  : ascii.startsWith("\x7fELF")
    ? openAppImage
    : openSquashfs;
const mib = (/** @type {number} */ n) => (n / 1048576).toFixed(1);

let start = performance.now();
const archive = await opener(source, {});
const listed = performance.now() - start;
console.log(
  `${archive.format}: ${archive.entries.length} entries listed in ${listed.toFixed(0)} ms`,
);
for (const d of archive.details) console.log(`  ${d.label}: ${d.value}`);
if (archive.refusal) console.log(`  refusal: ${archive.refusal}`);

start = performance.now();
let bytes = 0;
let files = 0;
const failures = new Map();
for (const entry of archive.entries) {
  if (entry.kind !== "file" || entry.refusal) continue;
  try {
    bytes += (await archive.read(entry)).length;
    files++;
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    failures.set(why, (failures.get(why) ?? 0) + 1);
  }
}
const seconds = (performance.now() - start) / 1000;
console.log(
  `read ${files} files, ${mib(bytes)} MiB in ${seconds.toFixed(2)} s (${mib(bytes / seconds)} MiB/s)`,
);
for (const [why, n] of failures) console.log(`  ${n} failed: ${why}`);
await file.close();
