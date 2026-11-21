import type { ShellCtx } from "../shell/context";
import { erisText } from "./copy";

export const SUMMON = "desk.eris.summon";

/** Open Eris's talk line when the shell summons her. */
export function defineSummon(ctx: ShellCtx): () => void {
  const { commands } = ctx.runtime;
  return (
    commands?.define(SUMMON, {
      title: () => erisText(ctx.store.get().lang, "talk.summon"),
      owner: "desk",
      keywords: ["eris", "talk", "summon", "option enter", "에리스", "말하기"],
      run: (args) => {
        const toggle = (args as { toggle?: unknown } | undefined)?.toggle === true;
        if (toggle && ctx.store.get().composer.open) {
          ctx.store.set({ composer: { open: false, text: "", selected: 0 } });
          return;
        }
        return commands.run("desk.shell.talk");
      },
    }) ?? (() => {})
  );
}
