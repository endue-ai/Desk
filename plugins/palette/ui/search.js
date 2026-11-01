// Independent sources keep plugin matches responsive when an OS index is slow. Every query owns
// its results, so replies from a previous query or a closed palette can never replace the current one.
export function createSearch(bridge, update, status) {
  let generation = 0;
  let timer;
  let systemRunning = false;
  let pendingSystem;
  const runSystem = async () => {
    if (systemRunning || !pendingSystem) return;
    const { query, current } = pendingSystem;
    pendingSystem = undefined;
    systemRunning = true;
    try {
      const { hits } = await bridge.call("search.system", {
        query,
        scope: { permission: "search:system" },
      });
      if (current === generation) update("system", hits);
    } catch {
      if (current === generation)
        status("OS search is unavailable. Check the system search index.");
    } finally {
      systemRunning = false;
      void runSystem();
    }
  };
  return {
    query(query) {
      const current = ++generation;
      clearTimeout(timer);
      pendingSystem = undefined;
      update("plugins", []);
      update("system", []);
      status("");
      timer = setTimeout(() => {
        void bridge
          .call("search.query", {
            query,
            limit: 40,
            scope: { permission: "search:read" },
          })
          .then(
            ({ hits }) => {
              if (current === generation) update("plugins", hits);
            },
            () => {
              if (current === generation) status("Plugin search is unavailable.");
            },
          );
        if (query.trim().length >= 2) {
          pendingSystem = { query: query.trim(), current };
          void runSystem();
        }
      }, 120);
    },
    cancel() {
      generation++;
      clearTimeout(timer);
      pendingSystem = undefined;
    },
  };
}

export function searchEntry(hit) {
  const category = {
    plugin: "Plugin",
    document: "Plugin data",
    file: "File",
    application: "Application",
  };
  return {
    id: hit.id,
    label: hit.title,
    detail: `${category[hit.kind]} · ${hit.detail || hit.plugin || ""}`,
    hit,
  };
}

export async function openSearchHit(ctx, hit) {
  if (hit.kind === "file" || hit.kind === "application") {
    return ctx.bridge.call("search.open", { id: hit.id, scope: { permission: "search:system" } });
  }
  await ctx.commands.run("desk.plugins.open", { plugin: hit.plugin, waitForReady: !!hit.command });
  if (hit.command) {
    const commands = await ctx.commands.list();
    if (!commands.some((c) => c.id === hit.command && c.provider === hit.plugin))
      throw new Error("This result is no longer available. Search again.");
    await ctx.commands.run(hit.command, hit.args);
  }
}
