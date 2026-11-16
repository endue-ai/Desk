// The studio's commands for the palette and agents (ADR 0088): each answers with plain data, and
// what changes the engine goes through the same actions as the buttons.

/** @param {any} ctx @param {import("./studio.js").App} app */
export function wireCommands(ctx, app) {
  const on = (/** @type {string} */ name, /** @type {(args: any) => unknown} */ fn) =>
    ctx.commands?.on?.(`endue.docker-studio.${name}`, (/** @type {any} */ args) => fn(args ?? {}));
  on("open", (args) => {
    ctx.surface?.show?.();
    if (args?.section) app.go(args.section);
    return { section: app.store.state.page };
  });
  on("refresh", async () => {
    await app.live.refresh();
    return { engine: app.store.state.engine.status };
  });
}
