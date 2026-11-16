// The preview's model files: a few .gguf files with real headers in the window's models folder,
// laid out as org/repo/file the way downloads land, sparse so their sizes look real and cost nothing.
import { existsSync } from "node:fs";
import { join } from "node:path";
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
