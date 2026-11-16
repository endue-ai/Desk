// What a person does to a conversation beyond asking: edit a question (a new version, answered
// again), correct an answer in place, let a stopped answer go on, start a new chat from a message,
// have the model name the chat, and save it as Markdown or JSON.
import { splitThink } from "./think.js";
import { addNode, createThread, path, pathTo } from "./threads.js";

/**
 * @typedef {import("./app.js").App} App
 * @typedef {import("./threads.js").Thread} Thread
 * @typedef {import("./threads.js").Node} Node
 */

const TITLE_PROMPT =
  "Write a title of at most six words for this conversation. Answer with the title only: no quotes, no full stop.";

/** A question edited: a sibling of it with the new words, then its answer. @param {App} app @param {string} nodeId @param {string} text */
export async function editQuestion(app, nodeId, text) {
  const thread = app.S.get().thread;
  const node = thread?.nodes[nodeId];
  if (!thread || !node || node.role !== "user" || app.S.get().generating || !text.trim()) return;
  const copy = addNode(thread, node.parent, {
    role: "user",
    content: text.trim(),
    ...(node.images?.length ? { images: node.images } : {}),
  });
  app.S.touch("thread");
  app.persist(thread);
  await app.runner.generate(thread, copy.id);
}

/** An answer corrected in place: the next questions see the new words. @param {App} app @param {string} nodeId @param {string} text */
export function editAnswer(app, nodeId, text) {
  const thread = app.S.get().thread;
  const node = thread?.nodes[nodeId];
  if (!thread || !node || node.role !== "assistant" || app.S.get().generating) return;
  node.content = text;
  node.edited = true;
  app.S.touch("thread");
  app.persist(thread, true);
}

/** Let an answer that stopped or ran out of tokens go on where it ended. @param {App} app @param {string} nodeId */
export async function continueAnswer(app, nodeId) {
  const thread = app.S.get().thread;
  const node = thread?.nodes[nodeId];
  if (!thread || !node || node.role !== "assistant" || app.S.get().generating || !node.parent)
    return;
  await app.runner.generate(thread, node.parent, { into: node });
}

/** A new chat holding the conversation up to a message. @param {App} app @param {string} nodeId */
export function branchToNew(app, nodeId) {
  const thread = app.S.get().thread;
  if (!thread?.nodes[nodeId]) return undefined;
  const fresh = createThread({ model: thread.model, system: thread.system });
  fresh.params = thread.params ? { ...thread.params } : undefined;
  fresh.title = `${thread.title} (branch)`;
  fresh.titled = true;
  /** @type {string | null} */
  let parent = null;
  for (const node of pathTo(thread, nodeId)) {
    const { id: _id, parent: _p, children: _c, pick: _k, ...fields } = node;
    parent = addNode(fresh, parent, fields).id;
  }
  app.S.set({ thread: fresh, view: "chat" });
  app.persist(fresh, true);
  app.toast("A new chat holds the conversation up to that message.", "success");
  return fresh;
}

/** Ask the thread's model for a short title, once its first answer is in. @param {App} app @param {Thread} thread */
export async function nameThread(app, thread) {
  if (thread.titled || !thread.model) return;
  const nodes = path(thread);
  const question = nodes.find((n) => n.role === "user");
  const answer = nodes.find((n) => n.role === "assistant" && n.content);
  if (!question || !answer) return;
  try {
    const result = await app.runner.complete(
      thread.model,
      [
        { role: "system", content: TITLE_PROMPT },
        {
          role: "user",
          content: `Question: ${question.content.slice(0, 600)}\n\nAnswer: ${splitThink(answer.content).content.slice(0, 600)}`,
        },
      ],
      { params: { temperature: 0.3, maxTokens: 24 } },
    );
    const title = cleanTitle(result.content);
    if (!title || thread.titled) return;
    thread.title = title;
    thread.titled = true;
    if (app.S.get().thread?.id === thread.id) app.S.touch("thread");
    app.persist(thread, true);
  } catch {
    // The first words stay the title.
  }
}

/** A model's title, without quotes, markdown or a trailing full stop. @param {string} text */
export function cleanTitle(text) {
  const line = text.split("\n").find((l) => l.trim()) ?? "";
  const clean = line
    .replace(/^(title|chat title)\s*:\s*/i, "")
    .replace(/[*_#`]/g, "")
    .replace(/^["'“”‘’«]+|["'“”‘’»]+$/g, "")
    .replace(/[.。!]+$/, "")
    .trim();
  // A model that answered instead of naming: keep the first words of the question.
  if (clean.split(/\s+/).length > 10) return "";
  return clean.length > 60 ? `${clean.slice(0, 59)}…` : clean;
}

/** The conversation shown, as Markdown. @param {Thread} thread @param {string} [modelName] */
export function threadMarkdown(thread, modelName) {
  const lines = [`# ${thread.title}`, ""];
  const when = new Date(thread.createdAt).toLocaleString();
  lines.push(`_${[modelName, when].filter(Boolean).join(" · ")}_`, "");
  if (thread.system?.trim())
    lines.push(`> **System:** ${thread.system.trim().replace(/\n/g, "\n> ")}`, "");
  for (const node of path(thread)) {
    if (node.role === "tool") continue;
    const who = node.role === "user" ? "You" : (node.modelName ?? node.model ?? "Model");
    lines.push(`### ${who}`, "");
    if (node.reasoning)
      lines.push("<details><summary>Reasoning</summary>", "", node.reasoning, "", "</details>", "");
    lines.push(node.role === "assistant" ? splitThink(node.content).content : node.content, "");
  }
  return `${lines.join("\n").trim()}\n`;
}

/** A file name from a title. @param {string} title @param {string} ext */
export const fileNameOf = (title, ext) =>
  `${
    title
      .replace(/[\\/:*?"<>|]+/g, " ")
      .replace(/\p{Cc}+/gu, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || "chat"
  }.${ext}`;

/** Save the open thread where the person says. @param {App} app @param {"md" | "json"} format */
export async function exportThread(app, format) {
  const thread = app.S.get().thread;
  if (!thread || !Object.keys(thread.nodes).length) return;
  const model = app.S.get().models.find((m) => `${m.serverId}|${m.id}` === thread.model);
  const answer = await app.store.bridge
    .call("dialog.save", {
      title: "Export chat",
      suggestedName: fileNameOf(thread.title, format),
      startIn: "~/Downloads",
      filters: [
        format === "md"
          ? { name: "Markdown", extensions: ["md"] }
          : { name: "JSON", extensions: ["json"] },
      ],
    })
    .catch(() => ({ cancelled: true }));
  if (answer.cancelled || !answer.path) return;
  const content =
    format === "md" ? threadMarkdown(thread, model?.name) : `${JSON.stringify(thread, null, 2)}\n`;
  await app.store.bridge.call("fs.write", { path: answer.path, content, encoding: "utf8" });
  app.toast(`Saved to ${answer.path}`, "success");
}
