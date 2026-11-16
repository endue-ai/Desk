// Finding models on Hugging Face, the one place the window reaches outside this computer, and only
// when the person searches: repositories of GGUF files (search, sort), one repository's files with
// their sizes and what its header says, and its model card. Files are grouped by quantization,
// split files counted together, projectors set apart, and the best one that fits picked.
import { quantOf } from "./models.js";

export const HUB = "https://huggingface.co";
export const HUB_SCOPE = Object.freeze({ permission: "net:fetch", hosts: ["huggingface.co"] });

/**
 * @typedef {import("./net.js").Bridge} Bridge
 * @typedef {{ id: string, author: string, downloads: number, likes: number, updated?: string, tags: string[], task?: string, gated?: boolean }} HubRepo
 * @typedef {{ quant: string, files: string[], size: number, parts: number, folder?: string }} HubQuant
 * @typedef {{ repo: HubRepo, quants: HubQuant[], projectors: { file: string, size: number }[], params?: number, arch?: string, ctx?: number, license?: string, base?: string }} HubDetails
 */

export class HubError extends Error {}

/** @param {Bridge} bridge @param {string} path @param {{ json?: boolean }} [o] */
async function get(bridge, path, o = { json: true }) {
  /** @type {any} */
  let answer;
  try {
    answer = await bridge.call("net.fetch", {
      url: `${HUB}${path}`,
      method: "GET",
      headers: { accept: o.json ? "application/json" : "text/plain" },
      timeoutMs: 20000,
      scope: HUB_SCOPE,
    });
  } catch (e) {
    const code = /** @type {{ code?: string }} */ (e)?.code;
    throw new HubError(
      code === "permission_denied"
        ? "Not allowed to reach huggingface.co."
        : code === "timeout"
          ? "huggingface.co did not answer in time."
          : "Could not reach huggingface.co: is this computer online?",
    );
  }
  const text =
    answer.bodyEncoding === "base64"
      ? new TextDecoder().decode(Uint8Array.from(atob(answer.body), (c) => c.charCodeAt(0)))
      : answer.body;
  if (answer.status === 401 || answer.status === 403)
    throw new HubError("This repository needs a Hugging Face sign-in (it is gated).");
  if (answer.status === 404) throw new HubError("No such repository on Hugging Face.");
  if (answer.status === 429)
    throw new HubError("Hugging Face asks to slow down: try again in a minute.");
  if (answer.status >= 400) throw new HubError(`Hugging Face answered ${answer.status}.`);
  return o.json ? JSON.parse(text) : text;
}

/** @param {any} m @returns {HubRepo} */
const repoOf = (m) => ({
  id: m.id ?? m.modelId,
  author: m.author ?? String(m.id ?? "").split("/")[0],
  downloads: m.downloads ?? 0,
  likes: m.likes ?? 0,
  updated: m.lastModified,
  tags: Array.isArray(m.tags) ? m.tags : [],
  task: m.pipeline_tag,
  gated: Boolean(m.gated),
});

/** Sorts the hub knows. */
export const SORTS = {
  downloads: "Most downloads",
  likes: "Most likes",
  trendingScore: "Trending",
  lastModified: "Recently updated",
};

/**
 * Repositories of GGUF files matching a search.
 * @param {Bridge} bridge @param {{ q?: string, sort?: keyof typeof SORTS, limit?: number }} [o]
 * @returns {Promise<HubRepo[]>}
 */
export async function search(bridge, o = {}) {
  const params = new URLSearchParams({
    filter: "gguf",
    sort: o.sort ?? "downloads",
    direction: "-1",
    limit: String(o.limit ?? 30),
  });
  if (o.q?.trim()) params.set("search", o.q.trim());
  const list = await get(bridge, `/api/models?${params}`);
  return (Array.isArray(list) ? list : []).map(repoOf);
}

const SPLIT = /-(\d{5})-of-(\d{5})\.gguf$/i;

/** A repository's GGUF files by quantization, smallest first. @param {{ rfilename: string, size?: number }[]} siblings */
export function groupFiles(siblings) {
  /** @type {Map<string, HubQuant>} */
  const quants = new Map();
  /** @type {{ file: string, size: number }[]} */
  const projectors = [];
  for (const s of siblings) {
    const file = s.rfilename;
    if (!/\.gguf$/i.test(file)) continue;
    const base = file.split("/").pop() ?? file;
    if (/mmproj/i.test(base)) {
      projectors.push({ file, size: s.size ?? 0 });
      continue;
    }
    const quant =
      quantOf(base.replace(SPLIT, ".gguf")) ??
      quantOf(file.split("/").slice(-2, -1)[0] ?? "") ??
      "Other";
    const key = `${quant}|${base.replace(SPLIT, "")}`;
    const entry = quants.get(key) ?? {
      quant,
      files: [],
      size: 0,
      parts: 0,
      folder: file.includes("/") ? file.slice(0, file.lastIndexOf("/")) : undefined,
    };
    entry.files.push(file);
    entry.files.sort();
    entry.size += s.size ?? 0;
    entry.parts = entry.files.length;
    quants.set(key, entry);
  }
  return { quants: [...quants.values()].sort((a, b) => a.size - b.size), projectors };
}

/** One repository: its files and sizes, and what its first GGUF header says. @param {Bridge} bridge @param {string} id @returns {Promise<HubDetails>} */
export async function details(bridge, id) {
  const m = await get(bridge, `/api/models/${id}?blobs=true`);
  const { quants, projectors } = groupFiles(m.siblings ?? []);
  const card = m.cardData ?? {};
  return {
    repo: repoOf(m),
    quants,
    projectors,
    params: m.gguf?.total,
    arch: m.gguf?.architecture,
    ctx: m.gguf?.context_length,
    license: typeof card.license === "string" ? card.license : undefined,
    base: Array.isArray(card.base_model) ? card.base_model[0] : card.base_model,
  };
}

/** A repository's model card, its front matter taken off. @param {Bridge} bridge @param {string} id */
export async function readme(bridge, id) {
  const text = await get(bridge, `/${id}/resolve/main/README.md`, { json: false }).catch(() => "");
  return String(text)
    .replace(/^---\n[\s\S]*?\n---\n/, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(
      /<\/?(div|p|span|img|a|br|hr|center|picture|source|table|tr|td|th|sup|sub|details|summary)[^>]*>/gi,
      "",
    )
    .trim();
}

/**
 * The quantization to suggest: the largest of the good ones (4 bits and up) that fits, else the
 * largest that fits at all, else the smallest.
 * @param {HubQuant[]} quants @param {(size: number) => import("./memory.js").Fit} fitting
 */
export function bestQuant(quants, fitting) {
  const fits = quants.filter((q) => fitting(q.size) === "fits");
  const good = fits.filter((q) =>
    /^(Q4_K_M|Q4_K_S|Q5_K_M|Q5_K_S|Q6_K|Q8_0|IQ4_XS|MXFP4)$/.test(q.quant),
  );
  return good.at(-1) ?? fits.at(-1) ?? quants[0];
}

/** What the tags say a repository's model can do. @param {HubRepo} r */
export function repoCaps(r) {
  const tags = new Set(r.tags);
  /** @type {import("./models.js").Capability[]} */
  const caps = [];
  if (r.task === "image-text-to-text" || tags.has("vision") || tags.has("multimodal"))
    caps.push("vision");
  if (/coder|code|devstral/i.test(r.id)) caps.push("code");
  if (/r1|reason|think|qwq|qwen3|gpt-oss|magistral/i.test(r.id)) caps.push("reasoning");
  if (r.task === "feature-extraction" || r.task === "sentence-similarity" || /embed/i.test(r.id))
    caps.push("embedding");
  return caps;
}

/** A link to a repository's page. @param {string} id */
export const pageOf = (id) => `${HUB}/${id}`;
/** Where a file downloads from. @param {string} id @param {string} file */
export const fileUrl = (id, file) =>
  `${HUB}/${id}/resolve/main/${file.split("/").map(encodeURIComponent).join("/")}`;
