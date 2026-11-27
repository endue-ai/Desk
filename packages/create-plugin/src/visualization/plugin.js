const sample = [
  { label: "January", value: 12 },
  { label: "February", value: 19 },
  { label: "March", value: 15 },
];

function chartRows(rows) {
  if (!Array.isArray(rows) || rows.length > 100)
    throw new Error("Enter an array of up to 100 rows.");
  return rows.map((row) => {
    const { label, value } = row ?? {};
    if (typeof label !== "string" || !label.trim() || label.length > 120) {
      throw new Error("Each row needs a label of 1 to 120 characters.");
    }
    if (!Number.isFinite(value) || value < 0)
      throw new Error("Each row needs a nonnegative numeric value.");
    return { label, value };
  });
}

export const plugin = {
  mount({ pluginId, state, commands }) {
    const input = document.querySelector("#rows");
    const chart = document.querySelector("#chart");
    const empty = document.querySelector("#empty");
    const error = document.querySelector("#error");
    let rows = state.get()?.rows ?? sample;

    const draw = () => {
      input.value = JSON.stringify(rows, null, 2);
      empty.hidden = rows.length !== 0;
      const max = Math.max(0, ...rows.map(({ value }) => value)) || 1;
      chart.replaceChildren(
        ...rows.map(({ label, value }) => {
          const row = document.createElement("li");
          const name = document.createElement("span");
          const number = document.createElement("span");
          const track = document.createElement("div");
          const bar = document.createElement("div");
          name.textContent = label;
          number.textContent = String(value);
          track.className = "track";
          track.setAttribute("aria-hidden", "true");
          bar.className = "bar";
          bar.style.width = `${(value / max) * 100}%`;
          track.append(bar);
          row.append(name, number, track);
          return row;
        }),
      );
    };
    const set = (next) => {
      rows = chartRows(next);
      state.set({ rows });
      draw();
      error.hidden = true;
      return { rows };
    };
    draw();
    document.querySelector("#editor").addEventListener("submit", (event) => {
      event.preventDefault();
      try {
        set(JSON.parse(input.value));
      } catch (reason) {
        error.textContent =
          reason instanceof SyntaxError ? "Enter valid JSON for the chart rows." : reason.message;
        error.hidden = false;
      }
    });
    commands.on(`${pluginId}.get-data`, () => ({ rows }));
    commands.on(`${pluginId}.set-data`, (args) => set(args?.rows));
  },
};
