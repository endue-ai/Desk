// endue.memory: what Eris remembers on this computer (ADR 0095), through memory.* as any plugin with
// memory:read and memory:write would. The tested modules take the bridge from here.
import { defineUiPlugin } from "@endue-ai/plugin-sdk";
import { createMemory } from "./controller.js";
import { createView } from "./view.js";

defineUiPlugin({
  async mount(ctx) {
    /** @type {ReturnType<typeof createMemory> | undefined} */
    let app;
    const view = createView(document, {
      filter: (f) => void app?.filter(f),
      search: (words) => void app?.search(words),
      edit: (id) => app?.edit(id),
      cancel: () => app?.cancel(),
      save: (id, text) => void app?.save(id, text),
      add: (text) => void app?.add(text),
      forget: (id) => void app?.forget(id),
      forgetAll: () => void app?.forgetAll(),
    });
    app = createMemory(ctx, view, async (question) => window.confirm(question));
    await app.ready;
  },
});
