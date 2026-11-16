/**
 * desk.palette's side in the runtime: `desk.palette.providers`, the palette providers the enabled
 * plugins contribute (`contributes.paletteProviders`), in layer order. desk.palette reads it when it
 * opens, as it reads `desk.keys.list`, and asks each provider as the person types. The desk's own
 * come first (#304): its open windows (`desk.windows.find`, `arrange/find.ts`) and its settings
 * (`desk.settings.find`, `settings-ui/find.ts`), each while its command is there.
 */
import { type DeskContext, disposer, type Installed } from "./context";

/** The desk's own providers, in the order the palette shows their groups. */
export const DESK_PROVIDERS = [
  { command: "desk.windows.find", title: "Windows", owner: "desk" },
  { command: "desk.settings.find", title: "Settings", owner: "desk" },
] as const;

export function installPalette(ctx: Pick<DeskContext, "hub">): Installed {
  const { hub } = ctx;
  const offs = disposer();
  offs.add(
    hub.commands.define("desk.palette.providers", {
      title: "List the palette's providers",
      keywords: ["palette", "search", "providers"],
      owner: "desk.palette",
      run: () => [
        ...DESK_PROVIDERS.filter((p) => hub.commands.has(p.command)).map((p) => ({ ...p })),
        ...hub.policy.paletteProviders.map(({ command, title, owner }) => ({
          command,
          title,
          owner,
        })),
      ],
    }),
  );
  return { dispose: offs.dispose };
}
