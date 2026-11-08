/**
 * desk.palette's side in the runtime: `desk.palette.providers`, the palette providers the enabled
 * plugins contribute (`contributes.paletteProviders`), in layer order. desk.palette reads it when it
 * opens, as it reads `desk.keys.list`, and asks each provider as the person types.
 */
import { type DeskContext, disposer, type Installed } from "./context";

export function installPalette(ctx: Pick<DeskContext, "hub">): Installed {
  const { hub } = ctx;
  const offs = disposer();
  offs.add(
    hub.commands.define("desk.palette.providers", {
      title: "List the palette's providers",
      keywords: ["palette", "search", "providers"],
      owner: "desk.palette",
      run: () =>
        hub.policy.paletteProviders.map(({ command, title, owner }) => ({ command, title, owner })),
    }),
  );
  return { dispose: offs.dispose };
}
