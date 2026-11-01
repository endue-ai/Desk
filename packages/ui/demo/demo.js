// Wiring for demo/index.html. A classic script, so the page works when opened as a plain file.
const byId = (id) => document.getElementById(id);
const toast = byId("toast");

if (!window.DeskUI) byId("missing").hidden = false;

byId("save").addEventListener("click", () => toast.show("Saved."));

byId("files").addEventListener("desk-select", (event) => {
  byId("picked").textContent = `Selected ${event.detail.item.textContent}.`;
});

byId("more").addEventListener("click", () => byId("menu").toggle(byId("more")));
byId("menu").addEventListener("desk-select", (event) => {
  toast.show(`${event.detail.item.textContent} chosen.`);
});

byId("open-dialog").addEventListener("click", () => {
  byId("new-name").value = "notes.md";
  byId("dialog").show();
});
byId("dialog-cancel").addEventListener("click", () => byId("dialog").close());
byId("dialog-ok").addEventListener("click", () => {
  byId("dialog").close();
  toast.show(`Renamed to ${byId("new-name").value}.`);
});

byId("toast-info").addEventListener("click", () => {
  toast.removeAttribute("tone");
  toast.show("Copied to the clipboard.");
});
byId("toast-error").addEventListener("click", () => {
  toast.setAttribute("tone", "error");
  toast.show("Could not reach endue. This one stays until you dismiss it.", { duration: 0 });
});

// A read of 48 MB that moves until it ends or Cancel stops it.
const reading = byId("reading");
let timer;
const read = (from) => {
  clearInterval(timer);
  let done = from;
  const show = () => {
    reading.value = done;
    reading.detail = `${done.toFixed(1)} of 48.0 MB`;
  };
  show();
  timer = setInterval(() => {
    done = Math.min(48, done + 0.8);
    show();
    if (done >= 48) clearInterval(timer);
  }, 200);
};
// `?still` keeps the bar where it starts, for pictures.
if (!new URLSearchParams(location.search).has("still")) read(12.4);
reading.addEventListener("desk-cancel", () => {
  clearInterval(timer);
  reading.detail = "Cancelled";
  toast.show("Reading budget.xlsx cancelled.");
});
byId("read-again").addEventListener("click", () => read(0));

const tasks = byId("tasks");
tasks.columns = [
  { key: "task", label: "Task", sortable: true },
  { key: "priority", label: "Priority", sortable: true },
];
tasks.rows = [
  { cells: { task: "Send the weekly report", priority: "P1" }, values: { priority: 1 } },
  { cells: { task: "Buy groceries", priority: "P3" }, values: { priority: 3 } },
  { cells: { task: "Call the bank", priority: "P2" }, values: { priority: 2 } },
];
tasks.addEventListener("desk-select", (event) => toast.show(`${event.detail.row.cells.task}.`));

// Today's agenda around the time the page was opened, in this browser's time zone.
const agenda = byId("agenda");
const hour = 3_600_000;
const at = (hours) => new Date(Date.now() + hours * hour).toISOString();
agenda.setAttribute("now", at(0));
agenda.events = [
  { title: "Team standup", start: at(-2), end: at(-1.75) },
  { title: "Lunch with Mina", start: at(1), end: at(2), detail: "Bistro Seoul" },
  { title: "Design review", start: at(4), end: at(5), detail: "Room 1" },
];

byId("markdown").source = [
  "## Notes",
  "",
  "A *small* subset, **no** raw HTML: <script>alert(1)</script> stays text.",
  "",
  "- `code`, [links](https://endue.ai) and ![images](x.png) as their alt text",
].join("\n");
byId("markdown").addEventListener("desk-link", (event) =>
  toast.show(`Link to ${event.detail.href}`),
);

// A standalone semantic theme: the elements change without changing their own CSS.
const actionTheme = {
  primary: "#8fd3c1",
  primaryForeground: "#142b25",
  primaryHover: "#acebd9",
  primaryText: "#8fd3c1",
  ring: "#8fd3c1",
  accent: "#8fd3c1",
};
let alternate = false;
byId("theme").addEventListener("click", () => {
  alternate = !alternate;
  const root = document.documentElement.style;
  for (const [name, value] of Object.entries(window.DeskUI.cssVariables(actionTheme))) {
    if (alternate) root.setProperty(name, value);
    else root.removeProperty(name);
  }
});
