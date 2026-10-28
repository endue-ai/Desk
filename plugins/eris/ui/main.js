// The Eris surface: one status pose at a time. The runtime switches it with the `state` command,
// for example runtime.plugins.command("endue.eris", "state", "thinking").
import { defineUiPlugin } from "@endue-ai/plugin-sdk";

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
  mount({ commands, state }) {
    show(state.get()?.pose ?? "idle");
    commands.on("state", (next) => {
      show(String(next));
      state.set({ pose: String(next) });
    });
  },
});
