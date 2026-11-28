// The operator can select containers as well as leaves. Stable IDs preserve the open path on refresh.
export function mountPage(doc, { collect, supported, t }) {
  const get = (id) => doc.getElementById(id);
  const el = (tag, text) => {
    const element = doc.createElement(tag);
    if (text !== undefined) element.textContent = text;
    return element;
  };
  let root;
  let selected = "computer";
  let updated;
  let state = supported ? "ready" : "unsupported";
  const expanded = new Set(["computer"]);
  const local = (value) => (typeof value === "object" ? t(value.message) : String(value));
  const refreshButton = get("refresh");
  const controller = new AbortController();
  const index = new Map();

  function indexNode(n, parents) {
    index.set(n.id, { n, parents });
    for (const child of n.children) indexNode(child, [...parents, n]);
  }
  function select(id, toggle) {
    selected = id;
    if (toggle) {
      if (expanded.has(id)) expanded.delete(id);
      else expanded.add(id);
    }
    draw();
    Array.from(get("hierarchy").querySelectorAll("button"))
      .find((b) => b.dataset.id === id)
      ?.focus({ preventScroll: true });
  }
  function row(n) {
    const item = el("li");
    const button = el("button");
    button.type = "button";
    button.className = "desk-btn desk-btn-quiet node";
    button.dataset.id = n.id;
    button.setAttribute("aria-current", String(n.id === selected));
    const branch = n.children.length > 0;
    if (branch) button.setAttribute("aria-expanded", String(expanded.has(n.id)));
    const marker = el("span", branch ? (expanded.has(n.id) ? "▾" : "▸") : "·");
    marker.className = "marker";
    marker.setAttribute("aria-hidden", "true");
    const label = el("span", local(n.label));
    label.className = "node-label";
    button.title = label.textContent;
    button.append(marker, label);
    if (branch) {
      const count = el("span", String(n.children.length));
      count.className = "count";
      button.append(count);
    }
    button.onclick = () => select(n.id, branch);
    item.append(button);
    if (branch && expanded.has(n.id)) {
      const list = el("ul");
      list.append(...n.children.map(row));
      item.append(list);
    }
    return item;
  }
  function draw() {
    doc.title = get("title").textContent = t("title");
    get("hierarchy").setAttribute("aria-label", t("hierarchy"));
    refreshButton.textContent = t(state === "denied" ? "allow" : root ? "refresh" : "collect");
    refreshButton.disabled = !supported || state === "loading";
    get("status").textContent =
      state === "updated"
        ? t("status.updated", { time: updated.toLocaleTimeString() })
        : t(`status.${state}`);
    if (!root) return;
    if (state === "failed" || state === "denied") {
      get("status").textContent +=
        ` ${t("status.updated", { time: updated.toLocaleTimeString() })}`;
    }
    const record = index.get(selected) ?? index.get("computer");
    selected = record.n.id;
    const list = el("ul");
    list.append(row(root));
    get("hierarchy").replaceChildren(list);
    get("map").hidden = false;
    const path = el("p", record.parents.map((n) => local(n.label)).join(" › ") || t("hierarchy"));
    path.id = "path";
    const heading = el("h2", local(record.n.label));
    heading.id = "detail-title";
    const fields = el("dl");
    const values = Object.entries(record.n.fields);
    if (record.n.children.length) values.unshift(["items", record.n.children.length]);
    for (const [key, value] of values) {
      if (value == null || value === "") continue;
      const line = el("div");
      line.className = "field";
      line.append(el("dt", t(`field.${key}`)), el("dd", local(value)));
      fields.append(line);
    }
    get("details").replaceChildren(path, heading, fields);
  }
  refreshButton.onclick = async () => {
    if (!supported || state === "loading") return;
    const askAgain = state === "denied";
    state = "loading";
    draw();
    try {
      root = await collect(controller.signal, askAgain);
      index.clear();
      indexNode(root, []);
      for (const id of expanded) if (!index.has(id)) expanded.delete(id);
      updated = new Date();
      state = "updated";
    } catch (error) {
      state = error.message === "denied" ? "denied" : "failed";
    }
    if (!controller.signal.aborted) draw();
  };
  draw();
  return {
    draw,
    dispose: () => {
      controller.abort();
      refreshButton.onclick = null;
    },
  };
}
