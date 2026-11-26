import type { StudioChatAskResult } from "@endue-ai/bridge";
import type { StudioQuestion } from "../../bridge/types";
import type { ShellCtx } from "../../shell/context";
import { h } from "../../shell/dom";
import { ASK_ENDUE, type CloudAnswer } from "../../system/endue-commands";
import { showOnDesk } from "../../system/endue-web";
import type { EndueKey } from "./copy";
import { text } from "./parts";

type Target = Omit<StudioQuestion, "question">;
const unfinished = {
  needsInput: "replyNeedsInput",
  interrupted: "replyInterrupted",
  failed: "replyFailed",
} satisfies Record<Exclude<StudioChatAskResult["state"], "done">, EndueKey>;

/** The draft and the answer belong to this card, including when it is turned over. */
export function cardQuestion(ctx: ShellCtx, redraw: () => void) {
  let expanded = false;
  let disposed = false;
  let pending = false;
  let draft = "";
  let reply: CloudAnswer | undefined;
  let error = "";

  async function send(target: Target) {
    const question = draft.trim();
    if (pending || !question) return;
    pending = true;
    reply = undefined;
    error = "";
    redraw();
    try {
      reply = (await ctx.runtime.commands.run(ASK_ENDUE, {
        ...target,
        question,
      })) as CloudAnswer;
      draft = "";
    } catch (reason) {
      error = reason instanceof Error ? reason.message : String(reason);
    } finally {
      pending = false;
      if (!disposed) redraw();
    }
  }

  return {
    dispose() {
      disposed = true;
    },
    view(target: Target | undefined) {
      if (!target || !ctx.bridge.studio?.ask) return null;
      if (!expanded)
        return h(
          "button",
          {
            class: "btn",
            type: "button",
            "data-key": "agent-question",
            onClick: () => {
              expanded = true;
              redraw();
            },
          },
          text(ctx, target.spaceId ? "askFrontDesk" : "askAgent"),
        );
      const question = h("textarea", {
        class: "desk-field",
        rows: 3,
        maxLength: 8000,
        required: true,
        disabled: pending,
        "data-key": "agent-question",
        onInput: () => {
          draft = question.value;
        },
      });
      question.value = draft;
      const answer = reply;
      const status = pending
        ? text(ctx, "asking")
        : answer?.state === "done"
          ? answer.text
          : answer && text(ctx, unfinished[answer.state]);
      return h(
        "form",
        {
          class: "endue-question",
          onSubmit: (event: Event) => {
            event.preventDefault();
            void send(target);
          },
        },
        h("label", {}, text(ctx, "question"), question),
        h(
          "button",
          { class: "btn btn-primary", type: "submit", disabled: pending },
          text(ctx, "sendQuestion"),
        ),
        status ? h("p", { class: "endue-reply", role: "status" }, status) : null,
        error ? h("p", { class: "endue-read is-failed", role: "alert" }, error) : null,
        answer
          ? h(
              "button",
              {
                class: "btn",
                type: "button",
                onClick: () => {
                  void showOnDesk(ctx, answer.conversationUrl).catch((reason: unknown) => {
                    error = reason instanceof Error ? reason.message : String(reason);
                    if (!disposed) redraw();
                  });
                },
              },
              text(ctx, "openConversation"),
            )
          : null,
      );
    },
  };
}
