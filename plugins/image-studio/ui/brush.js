const MAX_POINTS = 128;

export function createBrush(form, canvas, guide, inspect, selected, apply) {
  const mode = form.querySelector("#brush-mode");
  const color = form.querySelector("#brush-color");
  const colorField = form.querySelector("#color-field");
  const fields = form.querySelector("#brush-fields");
  const radius = form.querySelector("#brush-radius");
  const strength = form.querySelector("#brush-strength");
  const x = form.querySelector("#brush-x");
  const y = form.querySelector("#brush-y");
  let busy = false;
  let stroke;

  function option() {
    if (!mode.value || !radius.validity.valid || !strength.validity.valid || !selected())
      return null;
    const rgb = color.value
      .slice(1)
      .match(/../g)
      .map((value) => Number.parseInt(value, 16));
    return {
      op: "stroke",
      layer: selected().id,
      mode: mode.value,
      radius: radius.valueAsNumber,
      strength: strength.valueAsNumber,
      ...(mode.value === "paint" ? { color: rgb } : {}),
    };
  }

  function availability() {
    const info = inspect();
    canvas.toggleAttribute("data-painting", Boolean(mode.value && info.document && !busy));
    fields.hidden = !mode.value;
    colorField.hidden = mode.value !== "paint";
    for (const element of form.elements) element.disabled = busy || !info.document;
    if (info.document) {
      x.max = info.width - 1;
      y.max = info.height - 1;
      x.value = Math.min(x.valueAsNumber || 0, x.max);
      y.value = Math.min(y.valueAsNumber || 0, y.max);
    }
  }

  function record(event) {
    if (stroke?.pointer !== event.pointerId) return;
    const { left, top, width, height } = canvas.getBoundingClientRect();
    const point = {
      x: Math.min(
        stroke.target.width - 1,
        Math.max(0, Math.floor(((event.clientX - left) * stroke.target.width) / width)),
      ),
      y: Math.min(
        stroke.target.height - 1,
        Math.max(0, Math.floor(((event.clientY - top) * stroke.target.height) / height)),
      ),
    };
    const before = stroke.points.at(-1);
    if (before?.x === point.x && before.y === point.y) return;
    if (stroke.points.length >= MAX_POINTS * 2) {
      stroke.points = stroke.points.filter((_, index) => index % 2 === 0);
    }
    stroke.points.push(point);
    const context = guide.getContext("2d");
    const scaleX = guide.width / stroke.target.width;
    const scaleY = guide.height / stroke.target.height;
    context.lineCap = "round";
    context.lineWidth = Math.max(1, stroke.operation.radius * 2 * scaleX);
    context.globalAlpha = 0.65;
    // theme: content — preview the chosen brush color; mask and eraser use the theme text color.
    context.strokeStyle = stroke.operation.color
      ? color.value
      : getComputedStyle(canvas).getPropertyValue("--desk-text").trim();
    context.beginPath();
    const start = before ?? point;
    context.moveTo((start.x + 0.5) * scaleX, (start.y + 0.5) * scaleY);
    context.lineTo((point.x + 0.501) * scaleX, (point.y + 0.5) * scaleY);
    context.stroke();
  }

  function reset() {
    const previous = stroke;
    stroke = undefined;
    guide.getContext("2d").clearRect(0, 0, guide.width, guide.height);
    return previous;
  }

  mode.addEventListener("change", availability);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const operation = option();
    if (operation && !busy)
      apply({ ...operation, points: [{ x: x.valueAsNumber, y: y.valueAsNumber }] });
  });
  canvas.addEventListener("pointerdown", (event) => {
    if (busy || stroke || !event.isPrimary || event.button !== 0) return;
    const operation = option();
    if (!operation) return;
    const target = inspect();
    if (!target.document) return;
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    stroke = { pointer: event.pointerId, target, operation, points: [] };
    record(event);
  });
  canvas.addEventListener("pointermove", record);
  canvas.addEventListener("pointerup", (event) => {
    if (stroke?.pointer !== event.pointerId) return;
    record(event);
    const { target, operation, points } = reset();
    const sampled =
      points.length <= MAX_POINTS
        ? points
        : Array.from(
            { length: MAX_POINTS },
            (_, index) => points[Math.round((index * (points.length - 1)) / (MAX_POINTS - 1))],
          );
    if (!busy && sampled.length) apply({ ...operation, points: sampled }, target);
  });
  for (const type of ["pointercancel", "lostpointercapture"]) {
    canvas.addEventListener(type, (event) => {
      if (stroke?.pointer === event.pointerId) reset();
    });
  }
  return {
    busy(value) {
      busy = value;
      availability();
    },
  };
}
