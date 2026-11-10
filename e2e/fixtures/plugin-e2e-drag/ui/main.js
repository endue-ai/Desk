// The app e2e's drag source (#56): a press on the row that moves past the SDK's threshold drags the
// desk text "from e2e.drag"; how each drag ended goes on `window.e2eDrag` for a spec to read.
import { defineUiPlugin } from "@endue-ai/plugin-sdk";

const ended = [];
window.e2eDrag = { ended };

defineUiPlugin({
  mount({ dnd }) {
    const row = document.querySelector("[data-testid=row]");
    dnd?.draggable(row, {
      item: () => ({
        items: [{ type: "desk/text", text: "from e2e.drag" }],
        effectAllowed: ["copy"],
        image: { label: "from e2e.drag" },
      }),
      ended: (result) => {
        ended.push(result);
        document.querySelector("[data-testid=ended]").textContent = JSON.stringify(result);
      },
    });
  },
});
