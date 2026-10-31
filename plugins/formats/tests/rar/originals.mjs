// The files the RAR fixtures hold, made by a seeded generator so the tests can make them again and
// compare bytes; no personal data. For make-fixtures.sh: `node originals.mjs <dir>` writes them,
// `--hashes` prints their sizes and SHA-256, `--large <dir>` writes a 200 MB mix for the speed check.
import { createHash } from "node:crypto";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

/** A seeded generator of 32-bit numbers (mulberry32). @param {number} seed */
export function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
}

const WORDS = `the of and a to in is you that it he was for on are as with his they at be this from
have or by one had not but what all were when we there can an your which their said if do will each
about how up out them then she many some so these would other into has more her two like him see time
could no make than first been its who now people my made over did down only way find use may water
long little very after words called just where most know get through back much before go good new
write our used me man too any day same right look think also around another came come work three word
must because does part even place well such here take why things help put years different away again
off went old number great tell men say small every found still between name should home big give air
line set own under read last never us left end along while might next sound below saw something thought
both few those always looked show large often together asked house world going want school important
until form food keep children feet land side without boy once animals life enough took sometimes four
head above kind began almost live page got earth need far hand high year mother light parts country
father let night following picture being study second eyes soon times story boys since white days ever
paper hard near sentence better best across during today others however sure means knew try told young
river mountain window garden morning letter music table winter summer number desk lamp archive ribbon`
  .split(/\s+/)
  .filter(Boolean);

/** Paragraphs of plain English-like text, `size` bytes. @param {number} seed @param {number} size */
export function prose(seed, size) {
  const next = random(seed);
  const parts = [];
  let length = 0;
  while (length < size) {
    const sentences = 3 + (next() % 5);
    let paragraph = "";
    for (let s = 0; s < sentences; s++) {
      const count = 6 + (next() % 11);
      const words = [];
      for (let w = 0; w < count; w++) words.push(WORDS[next() % WORDS.length]);
      const first = /** @type {string} */ (words[0]);
      words[0] = first.charAt(0).toUpperCase() + first.slice(1);
      if (count > 9 && next() % 3 === 0) words[4] += ",";
      paragraph += `${words.join(" ")}${next() % 7 === 0 ? "?" : "."} `;
    }
    const line = `${paragraph.trimEnd()}\n\n`;
    parts.push(line);
    length += line.length;
  }
  return new TextEncoder().encode(parts.join("")).subarray(0, size);
}

/** Bytes with no structure. @param {number} seed @param {number} size */
export function noise(seed, size) {
  const next = random(seed);
  const out = new Uint8Array(size);
  for (let i = 0; i < size; i += 4) {
    const v = next();
    for (let k = 0; k < 4 && i + k < size; k++) out[i + k] = (v >>> (8 * k)) & 0xff;
  }
  return out;
}

/** Records of a binary log: some repeat, some are noise. @param {number} seed @param {number} size */
export function records(seed, size) {
  const next = random(seed);
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  for (let at = 0, id = 0; at + 16 <= size; at += 16, id++) {
    view.setUint32(at, id, true);
    view.setUint32(at + 4, 0x50000000 + (next() % 64) * 0x1000, true);
    view.setUint16(at + 8, next() % 5 === 0 ? next() & 0xffff : 0x2020, true);
    view.setUint16(at + 10, id % 37, true);
    view.setUint32(at + 12, next() % 3 === 0 ? next() : 0, true);
  }
  return out;
}

/** Something shaped like x86 code: prologues, moves, and calls and jumps to a few functions. @param {number} seed @param {number} size */
export function x86(seed, size) {
  const next = random(seed);
  const out = new Uint8Array(size);
  out.set([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00, 0xff, 0xff]);
  const targets = Array.from({ length: 48 }, () => 0x1000 + (next() % (size - 0x1000)));
  let at = 0x400;
  const put = (/** @type {number[]} */ bytes) => {
    for (const b of bytes) if (at < size) out[at++] = b;
  };
  const rel = (/** @type {number} */ target) => {
    const v = (target - (at + 4)) | 0;
    put([v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff]);
  };
  while (at < size - 16) {
    const op = next() % 10;
    if (op < 2) put([0x55, 0x8b, 0xec, 0x83, 0xec, (next() % 16) * 4]);
    else if (op < 5) {
      put([0xe8]);
      rel(/** @type {number} */ (targets[next() % targets.length]));
    } else if (op === 5) {
      put([0xe9]);
      rel(/** @type {number} */ (targets[next() % targets.length]));
    } else if (op < 8) put([0x8b, 0x45, (next() % 32) * 4, 0x89, 0x45, (next() % 32) * 4]);
    else if (op === 8) put([0x5d, 0xc3, 0xcc, 0xcc]);
    else put([0x6a, next() & 0x7f, 0x90]);
  }
  return out;
}

/** A 24-bit BMP of smooth colour gradients with a little grain. @param {number} width @param {number} height */
export function bmp(width, height) {
  const next = random(7);
  const stride = (width * 3 + 3) & ~3;
  const out = new Uint8Array(54 + stride * height);
  const view = new DataView(out.buffer);
  out.set([0x42, 0x4d]);
  view.setUint32(2, out.length, true);
  view.setUint32(10, 54, true);
  view.setUint32(14, 40, true);
  view.setInt32(18, width, true);
  view.setInt32(22, height, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 24, true);
  view.setUint32(34, stride * height, true);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const at = 54 + y * stride + x * 3;
      const grain = (next() % 7) - 3;
      out[at] = Math.max(0, Math.min(255, Math.round(128 + 100 * Math.sin(x / 17)) + grain));
      out[at + 1] = Math.max(0, Math.min(255, Math.round((y * 255) / height) + grain));
      out[at + 2] = Math.max(
        0,
        Math.min(255, Math.round(((x + y) * 255) / (width + height)) + grain),
      );
    }
  return out;
}

/** A 16-bit stereo WAV of two tones with a little hiss. @param {number} frames */
export function wav(frames) {
  const next = random(11);
  const out = new Uint8Array(44 + frames * 4);
  const view = new DataView(out.buffer);
  out.set(new TextEncoder().encode("RIFF"), 0);
  view.setUint32(4, out.length - 8, true);
  out.set(new TextEncoder().encode("WAVEfmt "), 8);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 2, true);
  view.setUint32(24, 22050, true);
  view.setUint32(28, 22050 * 4, true);
  view.setUint16(32, 4, true);
  view.setUint16(34, 16, true);
  out.set(new TextEncoder().encode("data"), 36);
  view.setUint32(40, frames * 4, true);
  for (let i = 0; i < frames; i++) {
    const t = i / 22050;
    const hiss = () => (next() % 41) - 20;
    view.setInt16(44 + i * 4, Math.round(9000 * Math.sin(2 * Math.PI * 440 * t)) + hiss(), true);
    view.setInt16(46 + i * 4, Math.round(7000 * Math.sin(2 * Math.PI * 660 * t)) + hiss(), true);
  }
  return out;
}

/** A block of noise, `gap` bytes of a short repeated pattern, the same block again. @param {number} block @param {number} gap */
export function far(block, gap) {
  const head = noise(99, block);
  const pattern = prose(5, 997);
  const out = new Uint8Array(block * 2 + gap);
  out.set(head, 0);
  for (let at = block; at < block + gap; at += pattern.length)
    out.set(pattern.subarray(0, Math.min(pattern.length, block + gap - at)), at);
  out.set(head, block + gap);
  return out;
}

const encoder = new TextEncoder();
/** Every file by its path in the fixtures' tree. */
export const ORIGINALS = {
  "text.txt": () => prose(1, 96 * 1024),
  "data.bin": () => records(2, 48 * 1024),
  "empty.txt": () => new Uint8Array(0),
  "docs/notes/readme.md": () => encoder.encode("# Notes\n\nA small file in a nested folder.\n"),
  "unicode/Ünïcödé.txt": () => encoder.encode("Latin letters with marks.\n"),
  "unicode/日本語.txt": () => encoder.encode("日本語のテキスト。\n"),
  "unicode/한국어 이름.txt": () => encoder.encode("안녕하세요\n"),
  "chapters/one.txt": () => prose(21, 40 * 1024),
  "chapters/two.txt": () => prose(21, 52 * 1024),
  "chapters/three.txt": () => prose(23, 44 * 1024),
  "tool.exe": () => x86(3, 96 * 1024),
  "tool-e8.exe": () => x86(13, 64 * 1024),
  "table.dat": () => records(4, 64 * 1024),
  "image.bmp": () => bmp(128, 96),
  "sound.wav": () => wav(16000),
  "noise.bin": () => noise(8, 72 * 1024),
  "far.bin": () => far(80 * 1024, 6 * 1024 * 1024),
  "far4.bin": () => far(64 * 1024, 3 * 1024 * 1024 + 512 * 1024),
};
/** The symbolic links in the tree: path and target. */
export const LINKS = { "link.txt": "text.txt" };

/** About 200 MB of text, records, code and noise. */
export function* large() {
  for (let part = 0; part < 50; part++) {
    yield prose(1000 + part, 2 * 1024 * 1024);
    yield records(2000 + part, 1024 * 1024);
    yield x86(3000 + part, 768 * 1024);
    yield noise(4000 + part, 256 * 1024);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [mode, dir] = process.argv.slice(2);
  if (mode === "--hashes") {
    /** @type {Record<string, { size: number, sha256: string }>} */
    const out = {};
    for (const [path, make] of Object.entries(ORIGINALS)) {
      const bytes = make();
      out[path] = { size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
    }
    process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
  } else if (mode === "--large" && dir) {
    mkdirSync(dir, { recursive: true });
    const parts = [...large()];
    writeFileSync(join(dir, "large.bin"), Buffer.concat(parts));
  } else if (mode && !mode.startsWith("--")) {
    for (const [path, make] of Object.entries(ORIGINALS)) {
      mkdirSync(dirname(join(mode, path)), { recursive: true });
      writeFileSync(join(mode, path), make());
    }
    mkdirSync(join(mode, "empty-folder"), { recursive: true });
    for (const [path, target] of Object.entries(LINKS)) symlinkSync(target, join(mode, path));
  } else throw new Error("usage: node originals.mjs <dir> | --hashes | --large <dir>");
}
