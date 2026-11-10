/**
 * The desk's side of the floating Eris (ADR 0121). It writes her state for the floating window
 * (her state, the talk phase, her latest line, the conversation's last lines), takes back what was
 * said there (her state at once, her answer said in the desk once the desk is in front, so the
 * conversation goes on where the person left it), and defines `desk.eris.summon`, which the
 * shortcut runs while the desk is in front: her composer opens, or closes when it is open.
 */
import type { ShellCtx } from "../shell/context";
import { listen } from "../shell/dom";
import { IDLE } from "../shell/ticker";
import {
  BACK_KEY,
  type ErisLine,
  type ErisSnapshot,
  keepLines,
  type LinkChannel,
  readBack,
  SNAPSHOT_KEY,
  storageChannel,
} from "./float";
import { floatText } from "./float-copy";
import type { ErisState } from "./states";
import type { TalkPhase } from "./talk";

export const SUMMON = "desk.eris.summon";
const TALK = "desk.shell.talk";

/** The desk's Eris, as far as the link needs her. */
export interface DeskEris {
  phase(): TalkPhase;
  /** Say her answer in the desk, as the composer's answers are said. */
  say(text: string): void;
  setState(state: ErisState): void;
}

export interface DeskLinkOptions {
  channel?: LinkChannel;
  /** Whether the desk's window is in front; an answer from the floating window waits for it. */
  focused?: () => boolean;
  win?: Window;
}

export function linkDesk(ctx: ShellCtx, eris: DeskEris, options: DeskLinkOptions = {}): () => void {
  const win = options.win ?? window;
  const channel = options.channel ?? storageChannel(win);
  const focused = options.focused ?? (() => win.document.hasFocus());
  // A new start of the desk is a new transcript; the brain keeps the conversation itself.
  let lines: ErisLine[] = [];
  let seq = 0;
  let written = "";
  let phase = eris.phase();
  let waiting: string | undefined;

  const publish = () => {
    const { state, saying } = ctx.store.get().eris;
    const body = { state, talk: eris.phase(), saying, lines };
    const text = JSON.stringify(body);
    if (text === written) return;
    written = text;
    const snapshot: ErisSnapshot = { v: 1, seq: ++seq, ...body };
    channel.write(SNAPSHOT_KEY, JSON.stringify(snapshot));
  };
  const sayWaiting = () => {
    if (waiting === undefined) return;
    const text = waiting;
    waiting = undefined;
    eris.say(text);
  };

  const offs = [
    ctx.store.watch(
      (s) => s.eris.saying,
      (saying) => {
        if (saying) lines = keepLines(lines, { who: "eris", text: saying });
        publish();
      },
    ),
    ctx.store.watch((s) => s.eris.state, publish),
    // Her turn's phase, looked at on the desk's frames; it needs none of its own (ADR 0164): a turn
    // runs her frames (Eris.ts), and its end is seen before she rests.
    ctx.ticker.add(() => {
      const now = eris.phase();
      if (now !== phase) {
        phase = now;
        publish();
      }
      return IDLE;
    }),
    channel.listen(BACK_KEY, (text) => {
      const back = readBack(text);
      if (!back) return;
      if (back.line) lines = keepLines(lines, back.line);
      if (back.state) eris.setState(back.state);
      if (back.said) {
        waiting = back.said;
        if (focused()) sayWaiting();
      }
      publish();
    }),
    // The desk in front again: she says what she answered while it was away.
    listen(win, "focus", sayWaiting),
  ];
  // A shell context without commands (a test's) still links her state.
  if (ctx.runtime.commands) {
    offs.push(
      ctx.runtime.commands.define(SUMMON, {
        title: floatText(ctx.store.get().lang, "summon"),
        owner: "desk",
        keywords: ["eris", "talk", "summon", "option enter", "에리스", "말하기"],
        run: (args) => {
          const toggle = (args as { toggle?: unknown } | undefined)?.toggle === true;
          if (toggle && ctx.store.get().composer.open) {
            ctx.store.set({ composer: { open: false, text: "", selected: 0 } });
            return;
          }
          return ctx.runtime.commands.run(TALK);
        },
      }),
    );
  }
  publish();
  return () => {
    for (const off of offs) off();
  };
}
