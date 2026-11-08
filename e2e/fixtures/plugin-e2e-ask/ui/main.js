// A fixture for checking the core's prompt policy (CORE-03) in the app by hand: each button calls
// perm.request, the answers are listed in the order they arrive, and the waiting count says how many
// calls still wait for the person. Its command e2e.ask.note, marked irreversible, writes a note under
// ~/qa as this plugin: an agent's call of it waits for the person's approval, a person's own call
// (desk cmd run) runs at once (ADR 0078).
import { defineUiPlugin } from "@endue-ai/plugin-sdk";

const read = (folder) => ({ permission: "fs:read", paths: [`${folder}/**`] });
const QA = { permission: "fs:write", paths: ["~/qa/**"] };

defineUiPlugin({
  async mount({ bridge, commands }) {
    commands.on("e2e.ask.note", (args) => {
      const { path, text } = args ?? {};
      return bridge.call("fs.write", { path, content: String(text ?? ""), scope: QA });
    });

    const answers = document.querySelector("[data-testid=answers]");
    const waiting = document.querySelector("[data-testid=waiting]");
    let open = 0;

    const ask = async (label, folder) => {
      open += 1;
      waiting.textContent = `waiting: ${open}`;
      let said;
      try {
        const answer = await bridge.call("perm.request", {
          permission: read(folder),
          reason: `To check the prompt policy (${label})`,
        });
        said = JSON.stringify({
          granted: answer.granted,
          reason: answer.reason,
          scope: answer.grant?.permission.paths,
        });
      } catch (error) {
        said = `error ${error?.code ?? error}`;
      }
      open -= 1;
      waiting.textContent = `waiting: ${open}`;
      const item = document.createElement("li");
      item.textContent = `${label}: ${said}`;
      answers.append(item);
    };

    document.querySelector("#ask-five").addEventListener("click", () => {
      for (let i = 1; i <= 5; i++) void ask(`documents ${i}`, "~/Documents");
    });
    document.querySelector("#ask-again").addEventListener("click", () => {
      void ask("documents 6", "~/Documents");
    });
    for (const button of document.querySelectorAll("[data-folder]")) {
      button.addEventListener(
        "click",
        () => void ask(button.dataset.folder, button.dataset.folder),
      );
    }
  },
});
