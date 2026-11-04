// The smallest universal view (ADR 0084): one view as data over a YAML file in this folder. The
// SDK fetches the asset, draws it with <desk-universal-view> and loads it again every minute; point
// `source` at a URL, a desk file, another plugin's command or the desk's items and nothing else
// changes. It imports nothing from the SDK, so its test runs it on the SDK's test host.
export const VIEW = {
  type: "kanban",
  types: ["kanban", "list", "timeline", "calendar"],
  source: { asset: "data/board.yaml" },
  options: { groups: ["todo", "doing", "done"] },
  empty: "Nothing planned yet.",
  refresh: 60,
};

export const plugin = {
  mount({ universal, state }) {
    const root = document.getElementById("root");
    const view = universal.open(root, { ...VIEW, type: state.get()?.type ?? VIEW.type });
    // The presentation the person picked comes back after a reload.
    view.element.addEventListener("desk-type", (event) => state.set({ type: event.detail.type }));
    return view;
  },
};
