/**
 * The design system studio's commands (DS-01, DE-03): desk.design.studio opens it, desk.design.edit
 * opens the editor on a copy of a design system, and desk.design.describe opens Describe with a sentence
 * and runs it, which is how Eris hands a request to change the design system over.
 */
import type { Commands } from "../commands";

export interface DesignStudioOpeners {
  open(): void;
  edit(from: string): void;
  describe(text?: string, fromEris?: boolean): void;
  active(): string;
}

export function defineDesignStudioCommands(
  commands: Commands,
  studio: DesignStudioOpeners,
): () => void {
  const field = (args: unknown, name: string) => {
    const value = (args as Record<string, unknown> | undefined)?.[name];
    return typeof value === "string" ? value : undefined;
  };
  const words = [
    "design system",
    "design",
    "components",
    "디자인 시스템",
    "디자인시스템",
    "컴포넌트",
  ];
  const offs = [
    commands.define("desk.design.studio", {
      title: "Open the design system studio",
      keywords: [...words, "gallery", "studio"],
      owner: "desk",
      run: () => studio.open(),
    }),
    commands.define("desk.design.edit", {
      title: "Tune a copy of a design system",
      keywords: [...words, "edit", "tune", "customize", "편집"],
      owner: "desk",
      run: (args) => studio.edit(field(args, "id") ?? studio.active()),
    }),
    commands.define("desk.design.describe", {
      title: "Describe a design system in a sentence",
      keywords: [...words, "describe", "sentence", "brain", "말하기"],
      owner: "desk",
      run: (args) => studio.describe(field(args, "text"), field(args, "from") === "eris"),
    }),
  ];
  return () => {
    for (const off of offs) off();
  };
}
