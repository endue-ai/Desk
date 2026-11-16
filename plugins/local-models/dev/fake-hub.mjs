// A made-up Hugging Face for the preview and the tests: a few GGUF repositories with their files,
// sizes, header facts and model cards, answering the three requests the window makes (search,
// a repository with ?blobs=true, its README). Downloads of its files write real GGUF headers.
import { modelMeta } from "./gguf-write.mjs";

const GB = 1_000_000_000;
const DAY = 86_400_000;
const NOW = Date.parse("2026-11-17T08:00:00Z");

/** @type {{ id: string, downloads: number, likes: number, days: number, task: string, tags: string[], files: [string, number][], gguf: { total: number, architecture: string, context_length: number }, license: string, base?: string, layers: number, heads: number, kvHeads: number, embd: number }[]} */
export const REPOS = [
  {
    id: "Qwen/Qwen3-4B-GGUF",
    downloads: 2_418_031,
    likes: 512,
    days: 3,
    task: "text-generation",
    tags: ["gguf", "conversational"],
    files: [
      ["Qwen3-4B-Q4_K_M.gguf", 2.5 * GB],
      ["Qwen3-4B-Q5_K_M.gguf", 2.89 * GB],
      ["Qwen3-4B-Q6_K.gguf", 3.31 * GB],
      ["Qwen3-4B-Q8_0.gguf", 4.28 * GB],
    ],
    gguf: { total: 4_022_468_096, architecture: "qwen3", context_length: 40960 },
    license: "apache-2.0",
    base: "Qwen/Qwen3-4B",
    layers: 36,
    heads: 32,
    kvHeads: 8,
    embd: 2560,
  },
  {
    id: "unsloth/gemma-3-12b-it-GGUF",
    downloads: 1_904_552,
    likes: 433,
    days: 9,
    task: "image-text-to-text",
    tags: ["gguf", "vision", "multimodal"],
    files: [
      ["gemma-3-12b-it-Q4_K_M.gguf", 7.3 * GB],
      ["gemma-3-12b-it-Q6_K.gguf", 9.66 * GB],
      ["gemma-3-12b-it-Q8_0.gguf", 12.5 * GB],
      ["gemma-3-12b-it-BF16.gguf", 23.5 * GB],
      ["mmproj-F16.gguf", 0.854 * GB],
    ],
    gguf: { total: 11_766_034_176, architecture: "gemma3", context_length: 131072 },
    license: "gemma",
    base: "google/gemma-3-12b-it",
    layers: 48,
    heads: 16,
    kvHeads: 8,
    embd: 3840,
  },
  {
    id: "unsloth/DeepSeek-R1-0528-Qwen3-8B-GGUF",
    downloads: 1_211_870,
    likes: 389,
    days: 21,
    task: "text-generation",
    tags: ["gguf", "reasoning"],
    files: [
      ["DeepSeek-R1-0528-Qwen3-8B-Q4_K_M.gguf", 5.03 * GB],
      ["DeepSeek-R1-0528-Qwen3-8B-Q6_K.gguf", 6.73 * GB],
      ["DeepSeek-R1-0528-Qwen3-8B-Q8_0.gguf", 8.71 * GB],
    ],
    gguf: { total: 8_190_735_360, architecture: "qwen3", context_length: 131072 },
    license: "mit",
    base: "deepseek-ai/DeepSeek-R1-0528-Qwen3-8B",
    layers: 36,
    heads: 32,
    kvHeads: 8,
    embd: 4096,
  },
  {
    id: "bartowski/Qwen2.5-Coder-7B-Instruct-GGUF",
    downloads: 987_120,
    likes: 301,
    days: 40,
    task: "text-generation",
    tags: ["gguf", "code"],
    files: [
      ["Qwen2.5-Coder-7B-Instruct-Q4_K_M.gguf", 4.68 * GB],
      ["Qwen2.5-Coder-7B-Instruct-Q5_K_M.gguf", 5.44 * GB],
      ["Qwen2.5-Coder-7B-Instruct-Q6_K.gguf", 6.25 * GB],
      ["Qwen2.5-Coder-7B-Instruct-Q8_0.gguf", 8.1 * GB],
    ],
    gguf: { total: 7_615_616_512, architecture: "qwen2", context_length: 32768 },
    license: "apache-2.0",
    layers: 28,
    heads: 28,
    kvHeads: 4,
    embd: 3584,
  },
  {
    id: "unsloth/Qwen3-30B-A3B-Instruct-2507-GGUF",
    downloads: 856_004,
    likes: 276,
    days: 12,
    task: "text-generation",
    tags: ["gguf", "moe"],
    files: [
      ["Qwen3-30B-A3B-Instruct-2507-Q4_K_M.gguf", 18.6 * GB],
      ["Q8_0/Qwen3-30B-A3B-Instruct-2507-Q8_0-00001-of-00002.gguf", 16.3 * GB],
      ["Q8_0/Qwen3-30B-A3B-Instruct-2507-Q8_0-00002-of-00002.gguf", 16.2 * GB],
    ],
    gguf: { total: 30_532_122_624, architecture: "qwen3moe", context_length: 262144 },
    license: "apache-2.0",
    layers: 48,
    heads: 32,
    kvHeads: 4,
    embd: 2048,
  },
  {
    id: "ggml-org/SmolLM3-3B-GGUF",
    downloads: 402_310,
    likes: 158,
    days: 30,
    task: "text-generation",
    tags: ["gguf"],
    files: [
      ["SmolLM3-Q4_K_M.gguf", 1.92 * GB],
      ["SmolLM3-Q8_0.gguf", 3.27 * GB],
    ],
    gguf: { total: 3_075_098_624, architecture: "smollm3", context_length: 65536 },
    license: "apache-2.0",
    layers: 36,
    heads: 16,
    kvHeads: 4,
    embd: 2048,
  },
  {
    id: "unsloth/gpt-oss-20b-GGUF",
    downloads: 1_533_901,
    likes: 498,
    days: 6,
    task: "text-generation",
    tags: ["gguf", "reasoning"],
    files: [
      ["gpt-oss-20b-Q4_K_M.gguf", 11.6 * GB],
      ["gpt-oss-20b-F16.gguf", 13.8 * GB],
    ],
    gguf: { total: 20_914_757_184, architecture: "gpt-oss", context_length: 131072 },
    license: "apache-2.0",
    layers: 24,
    heads: 64,
    kvHeads: 8,
    embd: 2880,
  },
  {
    id: "nomic-ai/nomic-embed-text-v1.5-GGUF",
    downloads: 301_442,
    likes: 120,
    days: 90,
    task: "feature-extraction",
    tags: ["gguf", "embeddings"],
    files: [
      ["nomic-embed-text-v1.5.Q8_0.gguf", 0.146 * GB],
      ["nomic-embed-text-v1.5.f16.gguf", 0.274 * GB],
    ],
    gguf: { total: 136_731_648, architecture: "nomic-bert", context_length: 2048 },
    license: "apache-2.0",
    layers: 12,
    heads: 12,
    kvHeads: 12,
    embd: 768,
  },
];

/** A repository's model card. @param {(typeof REPOS)[number]} r */
function card(r) {
  const name = r.id.split("/")[1].replace(/-GGUF$/i, "");
  return `---
license: ${r.license}
library_name: gguf
---

# ${name} GGUF

<div align="center"><img src="banner.png" /></div>

**${name}** in GGUF files for llama.cpp and the tools built on it.

## Highlights

- ${(r.gguf.total / 1e9).toFixed(1)}B parameters, **${r.gguf.context_length.toLocaleString()} tokens** of context
- Quantized with an importance matrix: quality close to the original at a fraction of the size
- Works with the chat template stored in the file

## Which file should I pick?

| Quantization | Use it when |
| --- | --- |
| Q4_K_M | Best balance of size and quality for most computers |
| Q5_K_M / Q6_K | You have memory to spare and want a little more quality |
| Q8_0 | Almost the original quality; twice the size of Q4 |

\`\`\`bash
llama-server -m ${r.files[0][0]} -c 8192 -ngl 99
\`\`\`

> Quantized files are a little less accurate than the original weights. Larger files are closer to it.
`;
}

/** @param {(typeof REPOS)[number]} r @param {boolean} full */
const listing = (r, full) => ({
  _id: r.id,
  id: r.id,
  modelId: r.id,
  author: r.id.split("/")[0],
  downloads: r.downloads,
  likes: r.likes,
  lastModified: new Date(NOW - r.days * DAY).toISOString(),
  pipeline_tag: r.task,
  tags: r.tags,
  gated: false,
  ...(full
    ? {
        siblings: [
          { rfilename: ".gitattributes", size: 1798 },
          { rfilename: "README.md", size: 4096 },
          ...r.files.map(([f, s]) => ({ rfilename: f, size: Math.round(s) })),
        ],
        gguf: { ...r.gguf, chat_template: "{{ messages }}" },
        cardData: { license: r.license, ...(r.base ? { base_model: r.base } : {}) },
      }
    : {}),
});

/**
 * Answer one request to huggingface.co.
 * @param {string} url @returns {{ status: number, headers: Record<string, string>, body: string, bodyEncoding: "utf8" }}
 */
export function hubAnswer(url) {
  const u = new URL(url);
  const json = (/** @type {unknown} */ v, status = 200) => ({
    status,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(v),
    bodyEncoding: /** @type {const} */ ("utf8"),
  });
  if (u.pathname === "/api/models") {
    const q = (u.searchParams.get("search") ?? "").toLowerCase().split(/\s+/).filter(Boolean);
    const sort = u.searchParams.get("sort") ?? "downloads";
    const found = REPOS.filter((r) => q.every((w) => r.id.toLowerCase().includes(w)));
    const key = (/** @type {(typeof REPOS)[number]} */ r) =>
      sort === "likes"
        ? r.likes
        : sort === "lastModified"
          ? -r.days
          : sort === "trendingScore"
            ? r.likes / (r.days + 2)
            : r.downloads;
    return json(found.sort((a, b) => key(b) - key(a)).map((r) => listing(r, false)));
  }
  const model = /^\/api\/models\/(.+)$/.exec(u.pathname);
  if (model) {
    const r = REPOS.find((x) => x.id === model[1]);
    return r ? json(listing(r, true)) : json({ error: "Repository not found" }, 404);
  }
  const readme = /^\/(.+)\/resolve\/main\/README\.md$/.exec(u.pathname);
  if (readme) {
    const r = REPOS.find((x) => x.id === readme[1]);
    return r
      ? {
          status: 200,
          headers: { "content-type": "text/plain" },
          body: card(r),
          bodyEncoding: "utf8",
        }
      : json({ error: "not found" }, 404);
  }
  return json({ error: "not found" }, 404);
}

/** What a download of a file writes: the size it ends at and its header. @param {string} url */
export function hubFile(url) {
  const m = /^\/(.+?\/.+?)\/resolve\/main\/(.+)$/.exec(new URL(url).pathname);
  if (!m) return undefined;
  const r = REPOS.find((x) => x.id === m[1]);
  const file = decodeURIComponent(m[2]);
  const entry = r?.files.find(([f]) => f === file);
  if (!r || !entry) return undefined;
  const quant = /(Q\d_K_[SM]|Q\d_\d|Q\d_K|BF16|F16|f16)/.exec(file)?.[1] ?? "Q4_K_M";
  const fileType =
    { Q4_K_M: 15, Q5_K_M: 17, Q6_K: 18, Q8_0: 7, BF16: 32, F16: 1, f16: 1 }[quant] ?? 15;
  const projector = /mmproj/i.test(file);
  return {
    size: Math.round(entry[1]),
    meta: modelMeta({
      arch: projector ? "clip" : r.gguf.architecture,
      name: projector
        ? "projector"
        : r.id
            .split("/")[1]
            .replace(/-GGUF$/i, "")
            .replace(/-/g, " "),
      sizeLabel: `${Math.round(r.gguf.total / 1e9) || 1}B`,
      fileType,
      ctx: r.gguf.context_length,
      layers: r.layers,
      embd: r.embd,
      heads: r.heads,
      kvHeads: r.kvHeads,
      license: r.license,
    }),
  };
}
