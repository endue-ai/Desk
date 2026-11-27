export function createLayerPanel(form, apply) {
  const selection = form.querySelector("#layer");
  const name = form.querySelector("#layer-name");
  const opacity = form.querySelector("#layer-opacity");
  const visible = form.querySelector("#layer-visible");
  const add = form.querySelector("#new-layer");
  const duplicate = form.querySelector("#duplicate-layer");
  const raise = form.querySelector("#raise-layer");
  const lower = form.querySelector("#lower-layer");
  const clear = form.querySelector("#reset-mask");
  const remove = form.querySelector("#remove-layer");
  let entries = [];
  let documentId;
  let busy = false;
  const index = () => entries.findIndex(({ id }) => id === Number(selection.value));
  const selected = () => entries[index()];

  function availability() {
    for (const field of form.elements) field.disabled = busy || entries.length === 0;
    add.disabled ||= entries.length >= 8;
    duplicate.disabled ||= entries.length >= 8;
    raise.disabled ||= index() >= entries.length - 1;
    lower.disabled ||= index() <= 0;
    clear.disabled ||= !selected()?.hasMask;
    remove.disabled ||= entries.length <= 1;
  }

  function reflect() {
    const layer = selected();
    name.value = layer?.name ?? "";
    opacity.value = layer?.opacity ?? 100;
    visible.checked = Boolean(layer?.visible);
    availability();
  }

  selection.addEventListener("change", reflect);
  add.addEventListener("click", () => apply({ op: "add-layer", name: "New layer" }));
  duplicate.addEventListener("click", () => apply({ op: "duplicate-layer", layer: selected().id }));
  raise.addEventListener("click", () =>
    apply({ op: "move-layer", layer: selected().id, index: index() + 1 }),
  );
  lower.addEventListener("click", () =>
    apply({ op: "move-layer", layer: selected().id, index: index() - 1 }),
  );
  clear.addEventListener("click", () => apply({ op: "reset-mask", layer: selected().id }));
  remove.addEventListener("click", () => apply({ op: "remove-layer", layer: selected().id }));
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    apply({
      op: "set-layer",
      layer: selected().id,
      name: name.value,
      opacity: opacity.valueAsNumber,
      visible: visible.checked,
    });
  });

  return {
    selected,
    busy(value) {
      busy = value;
      availability();
    },
    render(info) {
      const previous = info.document === documentId ? selected() : undefined;
      const layers = info.layers ?? [];
      const added =
        info.document === documentId
          ? layers.findLast(({ id }) => !entries.some((layer) => layer.id === id))
          : undefined;
      documentId = info.document;
      entries = layers;
      selection.replaceChildren(
        ...[...entries].reverse().map((layer) => {
          const suffix = [layer.visible ? "" : "hidden", layer.hasMask ? "masked" : ""].filter(
            Boolean,
          );
          const text = layer.name + (suffix.length ? ` (${suffix.join(", ")})` : "");
          return new Option(text, String(layer.id));
        }),
      );
      const id =
        added?.id ??
        (entries.some(({ id }) => id === previous?.id) ? previous.id : entries.at(-1)?.id);
      selection.value = String(id ?? "");
      const layer = selected();
      if (
        !layer ||
        previous?.id !== layer.id ||
        previous.name !== layer.name ||
        previous.opacity !== layer.opacity ||
        previous.visible !== layer.visible
      ) {
        reflect();
      } else {
        availability();
      }
    },
  };
}
