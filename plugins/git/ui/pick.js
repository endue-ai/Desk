// The desk's pick (desk.palette.pick) as the actions ask it: a title and rows, optionally free
// text; nothing picked, or the palette's Escape, is undefined.

/**
 * @param {Pick<import("@endue-ai/plugin-sdk").PluginContext, "commands">["commands"]} commands
 * @returns {import("./actions.js").Deps["pick"]}
 */
export const createPick =
  (commands) =>
  async (title, items, free = false, placeholder = "") => {
    try {
      const picked = await commands.run("desk.palette.pick", {
        title,
        items,
        ...(free ? { free, placeholder } : {}),
      });
      return typeof picked === "string" && picked !== "" ? picked : undefined;
    } catch (error) {
      if (/** @type {{ code?: string }} */ (error)?.code === "cancelled") return undefined;
      throw new Error("Cannot ask: the palette is off.");
    }
  };
