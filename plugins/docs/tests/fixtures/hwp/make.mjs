// Regenerates the real HWP 5.0 samples here from hwplib's sample files (Apache-2.0, see NOTICE):
//   node plugins/docs/tests/fixtures/hwp/make.mjs
// Each file keeps what Hangul wrote in its FileHeader, DocInfo, BodyText and BinData streams and is
// re-packed without the summary information, preview, script and option streams (which name the
// author and the machine). picture.hwp carries the repository's own test PNG instead of a logo.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { Cfb } from "../../../ui/cfb.js";
import { makeCfb } from "../../cfb.ts";
import { PNG } from "../../zip.ts";

const COMMIT = "6746c27f17ebf5277493206284aa32044a1839c4";
const SOURCES = {
  "table.hwp": "basic/표.hwp",
  "picture.hwp": "basic/그림.hwp",
  "notes.hwp": "basic/각주미주.hwp",
  "header.hwp": "basic/머리글꼬리글.hwp",
  "numbering.hwp": "basic/문단번호 1-10 수준.hwp",
};
const KEEP = /^(FileHeader|DocInfo|BodyText\/Section\d+|BinData\/BIN[0-9A-F]{4}\.\w+)$/;

for (const [name, path] of Object.entries(SOURCES)) {
  const url = `https://raw.githubusercontent.com/neolord0/hwplib/${COMMIT}/sample_hwp/${encodeURI(path)}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  const cfb = new Cfb(new Uint8Array(await response.arrayBuffer()));
  /** @type {Record<string, Uint8Array>} */
  const streams = {};
  for (const stream of cfb.list()) {
    if (!KEEP.test(stream)) continue;
    const bytes = cfb.read(stream);
    if (bytes) streams[stream] = stream.startsWith("BinData/") ? PNG : bytes;
  }
  const out = makeCfb(streams);
  writeFileSync(join(import.meta.dirname, name), out);
  console.log(name, out.length, Object.keys(streams).join(" "));
}
