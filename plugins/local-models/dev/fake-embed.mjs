// The made-up servers' embeddings: deterministic, so search results repeat.

/** Whether a model thinks before answering. @param {string} id */
export const thinks = (id) => /qwen3|deepseek-r1|qwq/.test(id);

/** A deterministic embedding: a bag of character trigrams folded into 64 numbers. @param {string} text */
export function fakeEmbedding(text) {
  const v = new Array(64).fill(0);
  const t = ` ${text.toLowerCase()} `;
  for (let i = 0; i + 3 <= t.length; i++) {
    let hash = 0;
    for (const ch of t.slice(i, i + 3)) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    v[hash % 64] += 1;
  }
  const norm = Math.hypot(...v) || 1;
  return v.map((x) => x / norm);
}
