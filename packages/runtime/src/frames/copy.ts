/** What a window says of a frame that stopped answering (#39): the question, its actions, Reload. */
import type { Lang } from "../shell/copy";

const copy = {
  notResponding: ["응답 없음", "Not responding"],
  notRespondingLine: [
    "{title} 창이 5초 넘게 응답하지 않습니다. 기다리거나 멈출 수 있습니다.",
    "{title} has not answered for 5 seconds. Wait for it, or stop it.",
  ],
  wait: ["기다리기", "Wait"],
  stop: ["멈추기", "Stop"],
  stoppedLine: [
    "응답하지 않아 멈췄습니다. 다시 불러오면 마지막 상태로 돌아옵니다.",
    "Stopped because it was not responding. Reload brings back its last state.",
  ],
  reload: ["다시 불러오기", "Reload"],
  cmdWait: ["응답 없는 창 · 기다리기", "Not responding · wait"],
  cmdStop: ["응답 없는 창 · 멈추기", "Not responding · stop"],
  cmdReload: ["멈춘 창 · 다시 불러오기", "Stopped window · reload"],
} as const;

export type FramesCopyKey = keyof typeof copy;

export function framesText(
  lang: Lang,
  key: FramesCopyKey,
  vars: Record<string, string | number> = {},
): string {
  const text: string = copy[key][lang === "ko" ? 0 : 1];
  return text.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? ""));
}
