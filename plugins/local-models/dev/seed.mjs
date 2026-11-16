// The preview's model files: a few .gguf files with real headers in the window's models folder,
// laid out as org/repo/file the way downloads land, sparse so their sizes look real and cost nothing.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { modelMeta, writeGguf } from "./gguf-write.mjs";

const FILES = [
  {
    path: "Qwen/Qwen3-4B-Instruct-2507-GGUF/Qwen3-4B-Instruct-2507-Q4_K_M.gguf",
    size: 2_497_280_256,
    meta: {
      arch: "qwen3",
      name: "Qwen3 4B Instruct 2507",
      sizeLabel: "4B",
      fileType: 15,
      ctx: 262144,
      layers: 36,
      embd: 2560,
      heads: 32,
      kvHeads: 8,
      org: "Qwen",
    },
  },
  {
    path: "google/gemma-3-12b-it-GGUF/gemma-3-12b-it-Q4_K_M.gguf",
    size: 7_300_574_976,
    meta: {
      arch: "gemma3",
      name: "Gemma 3 12B IT",
      sizeLabel: "12B",
      fileType: 15,
      ctx: 131072,
      layers: 48,
      embd: 3840,
      heads: 16,
      kvHeads: 8,
      license: "gemma",
      org: "Google",
    },
  },
  {
    path: "google/gemma-3-12b-it-GGUF/mmproj-model-f16.gguf",
    size: 854_200_224,
    meta: {
      arch: "clip",
      name: "Gemma 3 12B IT mmproj",
      sizeLabel: "400M",
      fileType: 1,
      ctx: 0,
      layers: 27,
      embd: 1152,
      heads: 16,
      kvHeads: 16,
    },
  },
  {
    path: "mistralai/Devstral-Small-2507-GGUF/Devstral-Small-2507-Q5_K_M.gguf",
    size: 16_763_982_848,
    meta: {
      arch: "llama",
      name: "Devstral Small 2507",
      sizeLabel: "24B",
      fileType: 17,
      ctx: 131072,
      layers: 40,
      embd: 5120,
      heads: 32,
      kvHeads: 8,
      org: "Mistral AI",
    },
  },
  {
    path: "openai/gpt-oss-120b-GGUF/gpt-oss-120b-MXFP4.gguf",
    size: 63_387_346_112,
    meta: {
      arch: "gpt-oss",
      name: "gpt-oss 120b",
      sizeLabel: "120B",
      fileType: 38,
      ctx: 131072,
      layers: 36,
      embd: 2880,
      heads: 64,
      kvHeads: 8,
      org: "OpenAI",
    },
  },
];

/** Write the files that are not there yet. @param {string} root */
export async function seedModels(root) {
  const dir = join(root, ".endue/local-models/models");
  for (const f of FILES) {
    const path = join(dir, f.path);
    if (existsSync(path)) continue;
    writeGguf(path, modelMeta(f.meta), f.size);
  }
}

/** A PNG of a calm gradient with a few shapes, for the image a person attaches. */
function picture(width = 480, height = 300) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    for (let x = 0; x < width; x++) {
      const i = y * (width * 3 + 1) + 1 + x * 3;
      const sun = Math.hypot(x - 340, y - 90) < 46;
      const hill = y > 210 - 40 * Math.sin(x / 70);
      raw[i] = sun ? 250 : hill ? 60 + y / 6 : 120 + (y / height) * 90;
      raw[i + 1] = sun ? 200 : hill ? 120 + y / 8 : 150 + (y / height) * 60;
      raw[i + 2] = sun ? 90 : hill ? 80 : 220 - (y / height) * 40;
    }
  }
  const crc = (/** @type {Buffer} */ b) => {
    let c = ~0;
    for (const byte of b) {
      c ^= byte;
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return ~c >>> 0;
  };
  const chunk = (/** @type {string} */ type, /** @type {Buffer} */ data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const GUIDE = [
  "# Running language models at home",
  "",
  ...Array.from({ length: 160 }, (_, i) =>
    i === 47
      ? "## Context length\n\nThe context length decides how much of a conversation the model can see at once. A longer context needs more memory for its key-value cache, so a 32K context on a 7B model can need several gigabytes on top of the weights."
      : i === 115
        ? "## Quantization\n\nA quantized file stores each weight in fewer bits. Q4_K_M keeps most of the quality at about a quarter of the original size, which is why it is the usual choice."
        : `## Note ${i}\n\nLocal models run on this computer, so the words you write are never sent to a server. Keep the drivers current and close other heavy programs while a model loads.`,
  ),
].join("\n\n");

/** The documents and the picture the preview attaches. @param {string} root */
export function seedFiles(root) {
  const dir = join(root, "Documents");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "home-models-guide.md"), GUIDE);
  writeFileSync(
    join(dir, "meeting-notes.txt"),
    "Monday: decide which model the team runs locally.\nAction: try Qwen3 8B and Gemma 3 12B on the M4.\n",
  );
  writeFileSync(join(dir, "valley.png"), picture());
}
