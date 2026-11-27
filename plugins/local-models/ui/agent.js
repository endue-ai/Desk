// Agent actions reuse the window's registered model engines and saved data.
import { details, search } from "./hub.js";
import { modelKey } from "./models.js";
import * as ollama from "./ollama.js";
import { path } from "./threads.js";

/** @typedef {import("./app.js").App} App */
/** @typedef {(id: string, handler: (args: any) => unknown) => void} Register */

const MAX_ROWS = 200;
const MAX_TEXT = 8_192;

/** @param {string} what @param {unknown} value @param {number} [max] */
function named(what, value, max = 500) {
  if (typeof value !== "string" || !value.trim() || value.length > max || value.includes("\0"))
    throw new Error(`Give ${what} as text.`);
  return value.trim();
}

/** The selector shown in the library avoids exposing local folders. @param {import("./library.js").LocalModel} model */
const libraryKey = ({ repo, file }) => (repo ? `${repo}/${file}` : file);

/** @param {App} app @param {Register} on @param {() => Promise<unknown>} ready */
export function wireAgent(app, on, ready) {
  const state = () => app.S.get();
  let asking = false;
  const tool = (/** @type {string} */ name, /** @type {(args: any) => unknown} */ run) =>
    on(`endue.local-models.${name}`, async (args) => {
      await ready();
      return run(args);
    });

  const publishedModel = (/** @type {string} */ name, chat = false) => {
    const models = chat
      ? state().models.filter((m) => !m.caps.includes("embedding"))
      : state().models;
    const key = models.find((m) => modelKey(m) === name);
    if (key) return key;
    const matches = models.filter((m) =>
      [m.id, m.name].some((v) => v.toLowerCase() === name.toLowerCase()),
    );
    if (matches.length > 1)
      throw new Error(`Several models match ${name}. Use a model key from models.`);
    return matches[0];
  };

  const localModel = (/** @type {string} */ name) => {
    const matches = state().local.filter((m) => [m.path, m.name, libraryKey(m)].includes(name));
    if (matches.length > 1)
      throw new Error(`Several local files match ${name}. Use a library model key.`);
    return matches[0];
  };

  const onlineOllama = (/** @type {string | undefined} */ id) => {
    const options = state().servers.filter(
      (s) => s.kind === "ollama" && s.status === "online" && (!id || s.id === id),
    );
    if (options.length !== 1 || !options[0])
      throw new Error(
        options.length ? "Choose one Ollama server by id." : "The Ollama server is not answering.",
      );
    return options[0];
  };

  tool("models", () => ({
    servers: state()
      .servers.slice(0, MAX_ROWS)
      .map(({ id, label, kind, status, managed }) => ({
        id,
        label,
        kind,
        status,
        managed: managed === true,
      })),
    models: state()
      .models.slice(0, MAX_ROWS)
      .map((m) => ({
        key: modelKey(m),
        id: m.id,
        name: m.name,
        server: m.serverId,
        loaded: m.loaded,
        caps: m.caps,
        size: m.size ?? null,
      })),
  }));

  tool("library", () => ({
    models: state()
      .local.slice(0, MAX_ROWS)
      .map((m) => ({
        key: libraryKey(m),
        name: m.name,
        size: m.size,
        repo: m.repo ?? null,
        architecture: m.info?.arch ?? null,
      })),
    loaded: state()
      .engines.slice(0, MAX_ROWS)
      .map(({ id, alias, state }) => ({ id, alias, state })),
  }));

  tool("threads", () =>
    state()
      .threads.slice(0, MAX_ROWS)
      .map(({ id, title, model, pinned, updatedAt }) => ({
        id,
        title,
        model,
        pinned,
        updatedAt,
      })),
  );

  tool("thread", async ({ id }) => {
    const key = named("the thread id", id);
    const current = state().thread;
    const thread =
      current?.id === key
        ? current
        : state().threads.some((t) => t.id === key)
          ? await app.store.thread(key)
          : null;
    if (!thread) throw new Error(`No saved thread ${key}.`);
    const messages = path(thread);
    return {
      id: thread.id,
      title: thread.title,
      model: thread.model,
      messages: messages
        .slice(-30)
        .map(({ role, content }) => ({ role, text: content.slice(0, 2_000) })),
      truncated:
        messages.length > 30 || messages.slice(-30).some(({ content }) => content.length > 2_000),
    };
  });

  tool("search", async ({ query }) => {
    const results = await search(app.store.bridge, {
      q: named("a catalog query", query, 200),
      limit: 30,
    });
    return results
      .slice(0, 30)
      .map(({ id, downloads, likes, gated }) => ({ id, downloads, likes, gated: gated ?? false }));
  });

  tool("ask", async ({ model, prompt }) => {
    const selected = publishedModel(named("the chat model", model), true);
    if (!selected) throw new Error("That chat model is not on an answering server.");
    const text = named("a prompt", prompt, MAX_TEXT);
    if (asking || state().generating)
      throw new Error("Wait for the current model response before asking another question.");
    asking = true;
    try {
      const thread = app.newChat(modelKey(selected));
      const response = await app.send(text);
      const answer = response?.content;
      if (!answer) throw new Error("The model did not finish an answer.");
      return {
        thread: thread.id,
        model: modelKey(selected),
        answer: answer.slice(0, MAX_TEXT),
        truncated: answer.length > MAX_TEXT,
      };
    } finally {
      asking = false;
    }
  });

  tool("load", async ({ model }) => {
    const key = named("the model", model);
    const file = localModel(key);
    if (file) {
      const loaded = await app.local.load(file);
      if (!loaded) throw new Error(`Could not load ${file.name}.`);
      return { model: modelKey(loaded), loaded: true };
    }
    const found = publishedModel(key);
    if (!found) throw new Error(`No model matches ${key}.`);
    const server = onlineOllama(found.serverId);
    await ollama.load(app.sockets, server, found.id);
    await app.refreshModels(server.id);
    return { model: modelKey(found), loaded: true };
  });

  tool("eject", async ({ model }) => {
    const key = named("the loaded model", model);
    const loaded = state().engines.filter(
      ({ id, alias, state }) => state !== "failed" && [id, alias].includes(key),
    );
    if (loaded.length > 1) throw new Error("Use the exact engine id from library.");
    if (loaded[0]) {
      await app.local.eject(loaded[0].id);
      return { model: key, ejected: true };
    }
    const found = publishedModel(key);
    if (!found) throw new Error(`No model matches ${key}.`);
    const server = onlineOllama(found.serverId);
    await ollama.unload(app.sockets, server, found.id);
    await app.refreshModels(server.id);
    return { model: modelKey(found), ejected: true };
  });

  tool("delete-model", async ({ model }) => {
    const key = named("the model to delete", model);
    const file = localModel(key);
    if (file) {
      await app.local.remove(file);
      return { model: key, deleted: true };
    }
    const found = publishedModel(key);
    if (!found) throw new Error(`No model matches ${key}.`);
    const server = onlineOllama(found.serverId);
    await ollama.remove(app.sockets, server, found.id);
    await app.refreshModels(server.id);
    return { model: modelKey(found), deleted: true };
  });

  tool("download", async ({ model, server, repo, quant }) => {
    if (repo === undefined) {
      const source = onlineOllama(
        server === undefined ? undefined : named("the server id", server),
      );
      const item = app.local.downloads.add({
        kind: "ollama",
        name: named("the Ollama model", model),
        total: 0,
        server: source.id,
      });
      return { download: item.id, state: item.state };
    }
    const id = named("the catalog repository", repo, 200);
    if (!/^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/iu.test(id))
      throw new Error("A catalog repository is named as owner/model.");
    const chosen = named("the GGUF quantization", quant, 80);
    const catalog = await details(app.store.bridge, id);
    const entry = catalog.quants.find((q) => q.quant.toLowerCase() === chosen.toLowerCase());
    if (!entry) throw new Error(`No ${chosen} download in ${id}.`);
    const item = app.local.downloads.add({
      kind: "file",
      repo: id,
      name: `${id} · ${entry.quant}`,
      files: entry.files,
      quant: entry.quant,
      total: entry.size,
    });
    return { download: item.id, state: item.state };
  });
}
