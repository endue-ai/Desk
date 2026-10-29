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

// A one-property theme: the elements change with no code of their own.
byId("theme").addEventListener("click", () => {
  const root = document.documentElement.style;
  if (root.getPropertyValue("--desk-accent")) root.removeProperty("--desk-accent");
  else root.setProperty("--desk-accent", "#8fd3c1");
});
