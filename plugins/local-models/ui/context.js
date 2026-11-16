// How much of the model's context a chat fills: exact up to the last answer whose server counted its
// tokens, estimated after it (a quarter of the characters), with the draft being written. The limit
// is the chat's own context length, else what the server loaded the model with, else what it was
// trained on.
import { modelKey } from "./models.js";
import { estimateTokens } from "./presets.js";
import { path } from "./threads.js";

/**
 * @param {import("./state.js").State} s @param {string} [draft]
 * @returns {{ used: number, limit?: number, exact: boolean }}
 */
export function contextUse(s, draft = "") {
  const t = s.thread;
  const key = t?.model ?? s.selected;
  const model = s.models.find((m) => modelKey(m) === key);
  const server = s.servers.find((x) => key?.startsWith(`${x.id}|`));
  const limit = t?.params?.contextLength ?? model?.loadedCtx ?? server?.ctx ?? model?.ctx;
  if (!t) return { used: estimateTokens(draft), limit, exact: false };
  const nodes = path(t);
  const at = nodes.findLastIndex(
    (n) => n.role === "assistant" && n.stats?.promptTokens !== undefined,
  );
  let used = 0;
  let exact = false;
  if (at >= 0) {
    const stats = nodes[at].stats ?? {};
    used = (stats.promptTokens ?? 0) + (stats.tokens ?? 0);
    exact = true;
  } else used = estimateTokens(t.system ?? "");
  for (const n of nodes.slice(at + 1))
    used += estimateTokens(n.content) + (n.images?.length ?? 0) * 768;
  return { used: Math.round(used + estimateTokens(draft)), limit, exact };
}

/** "1.2K", and "8K" for a power-of-two context. @param {number} n */
export function compact(n) {
  const v = Math.round(n);
  if (v >= 1024 && v % 1024 === 0) return `${v / 1024}K`;
  if (v >= 10000) return `${Math.round(v / 1000)}K`;
  if (v >= 1000) return `${(v / 1000).toFixed(1)}K`;
  return String(v);
}
