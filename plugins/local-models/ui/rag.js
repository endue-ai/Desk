// Long documents, searched instead of sent whole: cut into overlapping passages, each turned into a
// vector by an embedding model on one of the servers (nomic-embed-text on Ollama, any embedding model
// llama.cpp serves), the question too, and the closest passages sent with the question, numbered so
// the answer can cite them. Without an embedding model, passages are ranked by the question's words.
// Vectors are kept per document in ~/.endue/local-models/rag/, so a file is embedded once.
import { modelKey } from "./models.js";
import { clientOf } from "./servers.js";

/**
 * @typedef {import("./attach.js").Doc} Doc
 * @typedef {{ doc: string, index: number, text: string, score: number }} Passage
 */

export const RAG_DIR = "~/.endue/local-models/rag";
const SIZE = 1000;
const OVERLAP = 160;
const BATCH = 24;

/** Cut text into passages of about SIZE characters, on paragraph and sentence ends, overlapping. @param {string} text */
export function chunk(text, size = SIZE, overlap = OVERLAP) {
  const parts = text
    .split(/\n{2,}/)
    .flatMap((p) =>
      p.length <= size ? [p] : (p.match(new RegExp(`[\\s\\S]{1,${size}}(?=\\s|$)`, "g")) ?? [p]),
    );
  /** @type {string[]} */
  const out = [];
  let current = "";
  for (const part of parts) {
    if (current && current.length + part.length + 2 > size) {
      out.push(current.trim());
      current = `${current.slice(-overlap)}\n\n${part}`;
    } else current = current ? `${current}\n\n${part}` : part;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

/** @param {number[]} a @param {number[]} b */
export function cosine(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** @param {string} text */
const words = (text) => text.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [];

/** Rank passages by the question's words (BM25), for when no embedding model answers. @param {string[]} passages @param {string} question */
export function keywordScores(passages, question) {
  const q = [...new Set(words(question))];
  const docs = passages.map(words);
  const avg = docs.reduce((s, d) => s + d.length, 0) / Math.max(1, docs.length);
  const df = new Map(q.map((w) => [w, docs.filter((d) => d.includes(w)).length]));
  return docs.map((d) => {
    let score = 0;
    for (const w of q) {
      const tf = d.filter((x) => x === w).length;
      if (!tf) continue;
      const idf = Math.log(1 + (docs.length - (df.get(w) ?? 0) + 0.5) / ((df.get(w) ?? 0) + 0.5));
      score += (idf * tf * 2.2) / (tf + 1.2 * (0.25 + 0.75 * (d.length / avg)));
    }
    return score;
  });
}

/** A short hash of a text, for its vectors' file. @param {string} text */
export function hashOf(text) {
  let h1 = 0x811c9dc5;
  let h2 = 0x1b873593;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = Math.imul(h2 ^ c, 2246822507) >>> 0;
  }
  return `${h1.toString(36)}${h2.toString(36)}`;
}

/** The embedding model to use: the person's choice, else the first one a server answers with. @param {import("./state.js").State} s @param {string} [chosen] */
export function embedderOf(s, chosen) {
  const online = new Set(s.servers.filter((x) => x.status === "online").map((x) => x.id));
  const all = s.models.filter((m) => m.caps.includes("embedding") && online.has(m.serverId));
  return all.find((m) => modelKey(m) === chosen) ?? all[0];
}

/**
 * Find the passages of the documents closest to a question.
 * @param {{ S: import("./state.js").Store, sockets: import("./http.js").Sockets, store: { readJson(p: string): Promise<any>, writeJson(p: string, v: unknown): Promise<unknown> } }} app
 * @param {Doc[]} docs @param {string} question @param {{ k?: number, embedder?: string, onStage?: (text: string) => void }} [o]
 * @returns {Promise<{ passages: Passage[], method: "vectors" | "words", model?: string }>}
 */
export async function retrieve(app, docs, question, o = {}) {
  const k = o.k ?? 6;
  const pieces = docs.flatMap((d) =>
    chunk(d.text).map((text, index) => ({ doc: d.name, index, text })),
  );
  const model = embedderOf(app.S.get(), o.embedder);
  const server = model && app.S.get().servers.find((s) => s.id === model.serverId);
  if (model && server) {
    try {
      const client = clientOf(server.kind);
      /** @type {number[][]} */
      const vectors = [];
      for (const d of docs) {
        const path = `${RAG_DIR}/${hashOf(`${model.id}\n${d.text}`)}.json`;
        const cached = await app.store.readJson(path).catch(() => undefined);
        const texts = chunk(d.text);
        if (Array.isArray(cached?.vectors) && cached.vectors.length === texts.length) {
          vectors.push(...cached.vectors);
          continue;
        }
        /** @type {number[][]} */
        const mine = [];
        for (let i = 0; i < texts.length; i += BATCH) {
          o.onStage?.(
            `Reading ${d.name}: ${Math.min(i + BATCH, texts.length)} of ${texts.length} passages`,
          );
          mine.push(
            ...(await client.embed(app.sockets, server, model.id, texts.slice(i, i + BATCH))),
          );
        }
        vectors.push(...mine);
        await app.store
          .writeJson(path, { version: 1, model: model.id, doc: d.name, vectors: mine })
          .catch(() => {});
      }
      const [q] = await client.embed(app.sockets, server, model.id, [question]);
      const scored = pieces.map((p, i) => ({ ...p, score: cosine(q, vectors[i] ?? []) }));
      return {
        passages: scored.sort((a, b) => b.score - a.score).slice(0, k),
        method: "vectors",
        model: model.name,
      };
    } catch {
      // The embedding model failed: rank by words instead.
    }
  }
  const scores = keywordScores(
    pieces.map((p) => p.text),
    question,
  );
  const scored = pieces.map((p, i) => ({ ...p, score: scores[i] }));
  return { passages: scored.sort((a, b) => b.score - a.score).slice(0, k), method: "words" };
}

/** The part of a passage to show: from the sentence that shares most words with the question. @param {string} text @param {string} question */
export function excerptOf(text, question, length = 240) {
  const q = new Set(words(question));
  const sentences = text.split(/(?<=[.!?])\s+|\n+/).filter(Boolean);
  let best = 0;
  let at = 0;
  sentences.forEach((s, i) => {
    const hits = words(s).filter((w) => q.has(w)).length;
    if (hits > best) {
      best = hits;
      at = i;
    }
  });
  return sentences
    .slice(at)
    .join(" ")
    .replace(/(^|\s)#{1,6}\s+/g, "$1")
    .replace(/\*\*|__|`/g, "")
    .replace(/\s+/g, " ")
    .slice(0, length);
}

/** The passages as the words sent before the question. @param {Passage[]} passages */
export function passagesText(passages) {
  const body = passages.map((p, i) => `[${i + 1}] (${p.doc})\n${p.text}`).join("\n\n");
  return `Passages from the files attached, the ones closest to the question. Use them to answer, and cite them as [1], [2]. If they do not hold the answer, say so.\n\n${body}`;
}
