// What a question is sent with from the chat's files: new short files whole; once the files are
// long, the passages closest to the question, searched again for every question, kept as its sources.
import { inlineDocs } from "./attach.js";
import { contextUse } from "./context.js";
import { excerptOf, passagesText, retrieve } from "./rag.js";

/**
 * What a question sends with it from the chat's files: new short files whole, and once the files
 * are long, the passages closest to the question (searched again for every question).
 * @param {import("./app.js").App} app @param {import("./threads.js").Thread} thread @param {import("./attach.js").Doc[]} docs @param {string} question
 */
export async function groundFor(app, thread, docs, question) {
  const { S } = app;
  thread.docs = [
    ...(thread.docs ?? []).filter((d) => !docs.some((n) => n.name === d.name)),
    ...docs,
  ];
  const all = thread.docs;
  if (!all.length) return {};
  const tokens = all.reduce((sum, d) => sum + d.text.length / 4, 0);
  const limit = contextUse(S.get()).limit ?? 8192;
  if (tokens <= Math.min(6000, limit * 0.4))
    return docs.length ? { context: inlineDocs(docs) } : {};
  S.set({ preparing: `Searching ${all.length === 1 ? all[0].name : `${all.length} files`}…` });
  try {
    const found = await retrieve(app, all, question, { onStage: (t) => S.set({ preparing: t }) });
    return {
      context: passagesText(found.passages),
      sources: found.passages.map((p) => ({
        doc: p.doc,
        index: p.index,
        excerpt: excerptOf(p.text, question),
        score: p.score,
      })),
      searched: found.method === "vectors" ? `${found.model}` : "words",
    };
  } finally {
    S.set({ preparing: "" });
  }
}
