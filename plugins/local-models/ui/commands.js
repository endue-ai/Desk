// The window's commands for the palette: open it (on a thread when one is named) and start a chat,
// on a model and with a first message when given.
import { wireAgent } from "./agent.js";
import { modelKey } from "./models.js";

/** @typedef {import("./app.js").App} App */

/** The model a name points at: its id, its readable name, or the start of either. @param {App} app @param {string} name */
export function findModel(app, name) {
  const q = name.trim().toLowerCase();
  const chat = app.S.get().models.filter((m) => !m.caps.includes("embedding"));
  return (
    chat.find((m) => m.id.toLowerCase() === q || m.name.toLowerCase() === q) ??
    chat.find((m) => m.id.toLowerCase().startsWith(q) || m.name.toLowerCase().startsWith(q)) ??
    chat.find((m) => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q))
  );
}

/** Wait until the first look at the servers is done. @param {App} app */
export function whenReady(app) {
  if (app.S.get().ready) return Promise.resolve();
  return new Promise((resolve) => {
    const off = app.S.on(["ready"], (s) => {
      if (!s.ready) return;
      off();
      resolve(undefined);
    });
  });
}

/** @param {any} ctx @param {App} app */
export function wireCommands(ctx, app) {
  const on = (/** @type {string} */ id, /** @type {(args: any) => unknown} */ fn) =>
    ctx.commands?.on?.(id, (/** @type {any} */ args) => fn(args ?? {}));

  on("endue.local-models.open", async (args) => {
    ctx.surface?.show?.();
    await whenReady(app);
    if (typeof args.thread === "string") {
      const q = args.thread.toLowerCase();
      const entry = app.S.get().threads.find(
        (t) => t.id === args.thread || t.title.toLowerCase().includes(q),
      );
      if (entry) await app.openThread(entry.id);
    }
    app.S.set({ view: "chat" });
    return { opened: true };
  });

  on("endue.local-models.new-chat", async (args) => {
    ctx.surface?.show?.();
    await whenReady(app);
    let key;
    if (typeof args.model === "string") {
      const model = findModel(app, args.model);
      if (!model) throw new Error(`No model named “${args.model}” on the servers answering`);
      key = modelKey(model);
      app.choose(key);
    }
    const thread = app.newChat(key);
    if (typeof args.prompt === "string" && args.prompt.trim()) await app.send(args.prompt);
    return { thread: thread.id };
  });
  wireAgent(app, on, () => whenReady(app));
}
