// studio.* for the shell's agent bar and its endue windows (ADR 0129): the person's endue agents,
// their conversations and facets, and the spaces they can open, called as the runtime under
// studio:manage. The core holds the token; only endue.ai's own https pages are opened.
import type { BridgeClient, ShellOpenPermission } from "@endue-ai/bridge";
import type { StudioShellBridge } from "@endue-ai/runtime";

const STUDIO = { scope: { permission: "studio:manage" } } as const;
const OPEN: ShellOpenPermission = { permission: "shell:open", schemes: ["https"] };
/** The conversations read for presence: the most recently active ones. */
const CONVERSATIONS = 50;
/** The only pages the shell opens: endue.ai's. */
const WEB = "https://endue.ai/";

export function studioShell(core: BridgeClient): StudioShellBridge {
  return {
    agents: async () => (await core.call("studio.agents.list", STUDIO)).agents,
    conversations: async () =>
      (await core.call("studio.conversations.list", { limit: CONVERSATIONS, ...STUDIO }))
        .conversations,
    facets: (agentId) => core.call("studio.agents.facets", { agentId, ...STUDIO }),
    spaces: async () => (await core.call("studio.spaces.list", STUDIO)).spaces,
    space: (spaceId) => core.call("studio.spaces.get", { spaceId, ...STUDIO }),
    async open(url) {
      if (!url.startsWith(WEB)) throw new Error(`only endue.ai's pages open here: ${url}`);
      await core.call("shell.open", { target: url, scope: OPEN });
    },
  };
}
