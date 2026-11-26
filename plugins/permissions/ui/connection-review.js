// A Database setup can ask for its server and password helper together via two scoped prompts.
// Neither prompt can substitute for the other or add a grant to the person's answer.

const DATABASE = "endue.database";
const REVIEW = /^\[database-connect:[a-z0-9-]{8,64}\]\n(.+)$/su;

/** @typedef {import("@endue-ai/bridge").PermPromptData} Prompt */

function kindOf(/** @type {Prompt} */ prompt) {
  const p = prompt.permission;
  if (p.permission === "db:connect" && p.hosts.length > 0) return "server";
  if (p.permission === "proc:spawn" && p.commands.length === 1 && p.commands[0] !== "*" && !p.pty)
    return "helper";
  return "";
}

/**
 * @param {Prompt} front
 * @param {Prompt[]} pending
 * @param {import("@endue-ai/bridge").PluginInfo[]} plugins
 */
export function connectionReview(front, pending, plugins) {
  if (
    front.caller !== DATABASE ||
    !plugins.some((plugin) => plugin.id === DATABASE && plugin.builtIn && plugin.enabled)
  )
    return undefined;
  const kind = kindOf(front);
  const match = REVIEW.exec(front.reason ?? "");
  if (!kind || !match) return undefined;
  const peer = pending.find(
    (p) =>
      p.promptId !== front.promptId &&
      p.caller === front.caller &&
      p.duration === front.duration &&
      p.reason === front.reason &&
      kindOf(p) === (kind === "server" ? "helper" : "server"),
  );
  return { reason: match[1] ?? "", other: peer ? [peer] : [] };
}
