// The codec fixtures plugins/archives/tests/make-fixtures.py wrote with the real tools: the same
// 210 KB of generated text through each compressor, and a gzipped line.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const dir = join(import.meta.dirname, "fixtures");

export const fixture = (name: string) => new Uint8Array(readFileSync(join(dir, name)));
export const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
/** The size and SHA-256 of the text every stream holds. */
export const expected = JSON.parse(readFileSync(join(dir, "expected.json"), "utf8")) as {
  text: { size: number; sha256: string };
};
