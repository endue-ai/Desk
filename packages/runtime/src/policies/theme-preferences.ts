/** List and set the desk's appearance through the same settings the theme reads. */
import { THEME_TOOLS } from "../agent-specs";
import { CommandError } from "../commands";
import type { PolicyHub } from "../hub";
import { schemaFits } from "../settings";
import type { InstalledTheme, ThemeSettings } from "../theme";
import { disposer } from "./context";

export function installThemePreferences(
  { settings, commands }: PolicyHub,
  installed: () => InstalledTheme[],
  read: () => ThemeSettings,
): () => void {
  const offs = disposer();
  offs.add(
    commands.define("desk.theme.list", {
      title: "List themes",
      owner: "desk.theme",
      keywords: ["theme", "appearance"],
      agent: THEME_TOOLS.list,
      run: () => ({
        active: read().active ?? "",
        themes: [{ id: "", name: "endue" }, ...installed().map(({ id, name }) => ({ id, name }))],
      }),
    }),
  );
  offs.add(
    commands.define("desk.theme.set", {
      title: "Set the desk appearance",
      owner: "desk.theme",
      keywords: ["theme", "appearance"],
      agent: THEME_TOOLS.set,
      run(args) {
        const values: Record<string, unknown> = {};
        for (const [name, value] of Object.entries(args ?? {})) {
          const key = `desk.theme.${name}`;
          const declaration = settings.declaration(key);
          if (
            !Object.hasOwn(THEME_TOOLS.set.args.properties, name) ||
            !declaration ||
            !schemaFits(declaration, value)
          )
            throw new CommandError("failed", `Invalid appearance choice ${name}`);
          values[key] = value;
        }
        if (Object.keys(values).length)
          settings.setLayer("session", { ...settings.layer("session"), ...values });
        return read();
      },
    }),
  );
  return offs.dispose;
}
