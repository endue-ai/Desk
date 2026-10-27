// The Eris surface: her status pose, and a conversation typed to her. The runtime switches the pose
// with the `state` command, for example runtime.plugins.command("endue.eris", "state", "thinking").
import { defineUiPlugin } from "@endue-ai/plugin-sdk";
import { REDUCED, WISP } from "./soul-text.js";
import { Talk } from "./talk.js";
import { Timeline } from "./timeline.js";

export const STATES = ["idle", "listening", "thinking", "done", "heads-up", "oops"];
const LABELS = {
  idle: "Eris is idle",
  listening: "Eris is listening",
  thinking: "Eris is thinking",
  done: "Eris is done",
  "heads-up": "Eris has a heads-up",
  oops: "Something went wrong",
};

function show(state) {
  if (!STATES.includes(state)) return;
  const pose = document.getElementById("pose");
  pose.dataset.state = state;
  pose.querySelector("img").setAttribute("src", `./assets/state-${state}.svg`);
  document.getElementById("label").textContent = LABELS[state];
}

defineUiPlugin({
  mount({ bridge, commands, state }) {
    show(state.get()?.pose ?? "idle");
    commands.on("state", (next) => {
      show(String(next));
      state.set({ pose: String(next) });
    });
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    new Talk({
      doc: document,
      bridge,
      timeline: new Timeline(),
      show,
      style: reduced ? REDUCED : WISP,
      reduced,
    }).start();
  },
});
