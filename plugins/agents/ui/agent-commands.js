// These commands open the same pages the person can navigate to in the Agents window.

/**
 * @param {Pick<import("@endue-ai/plugin-sdk").PluginContext, "commands" | "surface">} ctx
 * @param {Pick<import("./app.js").App, "create" | "studio" | "listAgents">} app
 */
export function installAgentCommands(ctx, app) {
  ctx.commands.on("endue.agents.list", () => app.listAgents());
  ctx.commands.on("endue.agents.new", (_args, invocation) => {
    app.create();
    if (invocation?.caller.startsWith("agent:")) ctx.surface.show();
    return { page: "create" };
  });
  ctx.commands.on("endue.agents.studio", async (args, invocation) => {
    const { agent, facet } = /** @type {{ agent?: unknown, facet?: unknown }} */ (args ?? {});
    if (typeof agent !== "string" || !agent) throw new Error("endue.agents.studio needs an agent");
    const fromAgent = invocation?.caller.startsWith("agent:") === true;
    if (fromAgent) {
      const { agents } = await app.listAgents();
      if (!agents.some(({ id }) => id === agent))
        throw new Error("Choose an ID from endue.agents.list");
    }
    const inspector = typeof facet === "string" ? facet : "";
    app.studio(`endue:${agent}`, inspector);
    if (fromAgent) ctx.surface.show();
    return { agent, ...(inspector ? { facet: inspector } : {}) };
  });
}
