/**
 * desk.frames.wait, stop and reload (#39): what the Not responding window offers, as the desk's own
 * commands, so an agent that sees a window not responding (desk.windows.list) can act on it, and the
 * palette and keys reach it too. Each names the plugin whose frame it is for.
 */
import { CommandError, type Commands } from "../commands";
import type { Lang } from "../shell/copy";
import { type FramesCopyKey, framesText } from "./copy";
import type { FrameResponses } from "./watch";

const PLUGIN = {
  type: "object",
  properties: {
    plugin: { type: "string", description: "The plugin whose window it is, by id." },
  },
  required: ["plugin"],
  additionalProperties: false,
};

type Act = "wait" | "stop" | "reload";

const ACTS: Record<Act, { title: FramesCopyKey; words: string[]; does: string; refused: string }> =
  {
    wait: {
      title: "cmdWait",
      words: ["not responding", "hang", "wait", "응답 없음", "기다리기"],
      does: "Wait on a plugin window that is not responding: its Not responding question goes away for 10 seconds and comes back if the plugin still does not answer.",
      refused: "is not waiting for an answer to Not responding",
    },
    stop: {
      title: "cmdStop",
      words: ["not responding", "hang", "stop", "kill", "응답 없음", "멈추기"],
      does: "Stop a plugin window that is not responding: its frame is unloaded and the window offers Reload. Its last saved state is kept.",
      refused: "is not a window that is not responding",
    },
    reload: {
      title: "cmdReload",
      words: ["stopped", "asleep", "reload", "restart", "멈춘 창", "잠든 창", "다시 불러오기"],
      does: "Load a stopped or sleeping plugin window again: the plugin starts with its last saved state.",
      refused: "is neither stopped nor asleep",
    },
  };

export function defineFrameCommands(
  commands: Commands,
  responses: FrameResponses,
  lang: Lang,
): () => void {
  const offs = (Object.keys(ACTS) as Act[]).map((act) => {
    const spec = ACTS[act];
    return commands.define(`desk.frames.${act}`, {
      title: framesText(lang, spec.title),
      keywords: spec.words,
      owner: "desk",
      run: (args) => {
        const plugin = (args as { plugin?: unknown } | undefined)?.plugin;
        if (typeof plugin !== "string") throw new CommandError("failed", "say which: { plugin }");
        if (responses.state(plugin) === undefined)
          throw new CommandError("failed", `${plugin} has no window the desk watches`);
        if (!responses[act](plugin)) throw new CommandError("failed", `${plugin} ${spec.refused}`);
        return responses.state(plugin);
      },
      agent: {
        description: spec.does,
        args: PLUGIN,
        result: { type: "string", enum: ["responding", "late", "stopped"] },
      },
    });
  });
  return () => {
    for (const off of offs) off();
  };
}
