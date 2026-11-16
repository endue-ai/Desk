// The made-up servers' embeddings: deterministic, so search results repeat.

/** Whether a model thinks before answering. @param {string} id */
export const thinks = (id) => /qwen3|deepseek-r1|qwq/.test(id);

/** A deterministic embedding: the words and their first five letters, hashed into 256 numbers. @param {string} text */
export function fakeEmbedding(text) {
  const v = new Array(256).fill(0);
  const add = (/** @type {string} */ w) => {
    let hash = 0;
    for (const ch of w) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    v[hash % 256] += 1;
  };
  for (const w of text.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []) {
    add(w);
    add(w.slice(0, 5));
  }
  const norm = Math.hypot(...v) || 1;
  return v.map((x) => x / norm);
}
