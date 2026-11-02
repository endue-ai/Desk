/**
 * The theme studio's commands: desk.theme.studio opens it, desk.theme.edit opens the editor on a copy
 * of a theme, and desk.theme.describe opens Describe with a sentence and runs it, which is how Eris
 * hands a request to change the look over (docs/ko/theme-requirements.md TS-07).
 */
import type { Commands } from "../commands";

export interface StudioOpeners {
  open(): void;
  edit(from: string | undefined): void;
  describe(text?: string, from?: "eris"): void;
  /** The theme in force: what desk.theme.edit copies when it names none. */
  active(): string;
}

export function defineStudioCommands(commands: Commands, studio: StudioOpeners): () => void {
  const field = (args: unknown, name: string) => {
    const value = (args as Record<string, unknown> | undefined)?.[name];
    return typeof value === "string" ? value : undefined;
  };
  const offs = [
    commands.define("desk.theme.studio", {
      title: "Open the theme studio",
      keywords: ["theme", "themes", "appearance", "gallery", "look", "테마"],
      owner: "desk",
      run: () => studio.open(),
    }),
    commands.define("desk.theme.edit", {
      title: "Tune a copy of a theme",
      keywords: ["theme", "edit", "tune", "customize", "테마", "편집"],
      owner: "desk",
      run: (args) => studio.edit(field(args, "id") ?? studio.active()),
    }),
    commands.define("desk.theme.describe", {
      title: "Describe a theme in a sentence",
      keywords: ["theme", "describe", "sentence", "brain", "테마", "말하기"],
      owner: "desk",
      run: (args) =>
        studio.describe(field(args, "text"), field(args, "from") === "eris" ? "eris" : undefined),
    }),
  ];
  return () => {
    for (const off of offs) off();
  };
}
