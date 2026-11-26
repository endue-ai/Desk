/**
 * desk.palette's side in the runtime: `desk.palette.providers`, the palette providers the enabled
 * plugins contribute (`contributes.paletteProviders`), in layer order. desk.palette reads it when it
 * opens, as it reads `desk.keys.list`, and asks each provider as the person types. The desk's own
 * come first (#304): its open windows (`desk.windows.find`, `arrange/find.ts`) and its settings
 * (`desk.settings.find`, `settings-ui/find.ts`), each while its command is there.
 */
import type { PaletteResult, PaletteResults } from "@endue-ai/bridge";
import { WORKSPACE_TOOLS } from "../agent-specs";
import { type DeskContext, disposer, type Installed } from "./context";

/** The desk's own providers, in the order the palette shows their groups. */
export const DESK_PROVIDERS = [
  { command: "desk.windows.find", title: "Windows", owner: "desk" },
  { command: "desk.settings.find", title: "Settings", owner: "desk" },
] as const;

export function installPalette(ctx: Pick<DeskContext, "hub">): Installed {
  const { hub } = ctx;
  const offs = disposer();
  const providers = () => [
    ...DESK_PROVIDERS.filter((p) => hub.commands.has(p.command)).map((p) => ({ ...p })),
    ...hub.policy.paletteProviders.map(({ command, title, owner }) => ({ command, title, owner })),
  ];
  offs.add(
    hub.commands.define("desk.palette.providers", {
      title: "List the palette's providers",
      keywords: ["palette", "search", "providers"],
      owner: "desk.palette",
      run: providers,
    }),
  );
  offs.add(
    hub.commands.define("desk.search", {
      title: "Search the desk",
      owner: "desk",
      agent: WORKSPACE_TOOLS.search,
      run: async (args) => {
        const {
          query: typed,
          groups,
          limit: requested,
        } = (args ?? {}) as {
          query?: string;
          groups?: string[];
          limit?: number;
        };
        const query = typeof typed === "string" ? typed.trim().slice(0, 500) : "";
        if (query.length < 2) return { groups: [] };
        const limit = Math.min(50, Math.max(1, Number.isInteger(requested) ? (requested ?? 5) : 5));
        const names = new Set((groups ?? []).map((group) => group.toLowerCase()));
        const unsafe = new Set(
          hub.commands
            .list()
            .filter((cmd) => cmd.irreversible)
            .map((cmd) => cmd.id),
        );
        const selected = providers().filter(
          ({ command, title }) =>
            !unsafe.has(command) &&
            (names.size === 0 || names.has(command) || names.has(title.toLowerCase())),
        );
        const results = await Promise.all(
          selected.map(async ({ command, title }) => {
            const answer = await hub.commands.run(command, { query, limit }).catch(() => undefined);
            return { provider: command, title, results: matches(answer) };
          }),
        );
        let remaining = limit;
        return {
          groups: results.flatMap((group) => {
            const results = group.results.slice(0, remaining);
            remaining -= results.length;
            return results.length ? [{ ...group, results }] : [];
          }),
        };
      },
    }),
  );
  return { dispose: offs.dispose };
}

function matches(value: unknown): PaletteResult[] {
  const results = (value as Partial<PaletteResults> | undefined)?.results;
  if (!Array.isArray(results)) return [];
  return results
    .slice(0, 50)
    .filter(
      (item) =>
        item &&
        typeof item.id === "string" &&
        typeof item.title === "string" &&
        Array.isArray(item.actions) &&
        item.actions.length > 0 &&
        item.actions.every(
          (action) =>
            action && typeof action.command === "string" && typeof action.title === "string",
        ),
    );
}
