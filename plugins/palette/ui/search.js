// Independent sources keep plugin matches responsive when an OS index is slow. Every query owns
// its results, so replies from a previous query or a closed palette can never replace the current one.
// The empty query (the first list's plugins) goes at once and asks for every plugin; a typed one
// waits for the typing to pause.
export function createSearch(bridge, update, status, changed = () => {}) {
  let generation = 0;
  let timer;
  let systemRunning = false;
  let pendingSystem;
  let pending = 0;
  const settled = (current) => {
    if (current !== generation) return;
    pending -= 1;
    changed();
  };
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
      settled(current);
      void runSystem();
    }
  };
  return {
    query(query) {
      const current = ++generation;
      clearTimeout(timer);
      pendingSystem = undefined;
      pending = query.trim().length >= 2 ? 2 : 1;
      update("plugins", []);
      update("system", []);
      status("");
      const empty = query.trim() === "";
      timer = setTimeout(
        () => {
          void bridge
            .call("search.query", {
              query,
              limit: empty ? 100 : 40,
              scope: { permission: "search:read" },
            })
            .then(
              ({ hits }) => {
                if (current === generation) update("plugins", hits);
              },
              () => {
                if (current === generation) status("Plugin search is unavailable.");
              },
            )
            .finally(() => settled(current));
          if (query.trim().length >= 2) {
            pendingSystem = { query: query.trim(), current };
            void runSystem();
          }
        },
        empty ? 0 : 120,
      );
    },
    pending() {
      return pending > 0;
    },
    cancel() {
      generation++;
      pending = 0;
      clearTimeout(timer);
      pendingSystem = undefined;
    },
  };
}

/** How many characters of a file's folder its row shows before it keeps only the folder's end. */
export const FOLDER = 36;

/**
 * Where an OS result is, as its row shows it: the folder (the row's label is the name), the home
 * folder as ~, and a long folder cut at its start, so files of one name differ where their folders do.
 */
export function folderOf(/** @type {string} */ path) {
  const separator = path.includes("/") ? "/" : "\\";
  const parts = path.split(separator);
  parts.pop();
  const folder =
    parts.join(separator).replace(/^(?:\/Users|\/home|[A-Za-z]:\\Users)[\\/][^\\/]+/, "~") ||
    separator;
  if (folder.length <= FOLDER) return folder;
  const segments = folder.split(separator);
  let end = segments.pop() ?? "";
  while (segments.length > 0 && end.length + (segments.at(-1)?.length ?? 0) + 1 <= FOLDER - 2)
    end = `${segments.pop()}${separator}${end}`;
  return `…${separator}${end}`;
}

export function searchEntry(hit) {
  const category = {
    plugin: "Plugin",
    document: "Plugin data",
    file: "File",
    application: "Application",
  };
  const os = (hit.kind === "file" || hit.kind === "application") && hit.detail;
  return {
    id: hit.id,
    label: hit.title,
    detail: `${category[hit.kind]} · ${os ? folderOf(hit.detail) : hit.detail || hit.plugin || ""}`,
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
