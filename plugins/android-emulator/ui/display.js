import { transportLost } from "./connection.js";

export function screenPoint(box, width, height, clientX, clientY) {
  const fit = Math.min(box.width / width, box.height / height);
  if (!Number.isFinite(fit) || fit <= 0) return null;
  const x = Math.floor((clientX - box.left - (box.width - width * fit) / 2) / fit);
  const y = Math.floor((clientY - box.top - (box.height - height * fit) / 2) / fit);
  return x >= 0 && x < width && y >= 0 && y < height ? { x, y } : null;
}

export function createDisplay(
  canvas,
  android,
  report,
  availability,
  disconnected,
  withoutPrompt = (signal) => signal,
) {
  const doc = canvas.ownerDocument;
  let session, loop, timer, gesture;
  let paused = false;
  let drawn = false;
  let keys = Promise.resolve();
  const ctx = canvas.getContext("2d", { alpha: false });

  function suspend() {
    clearTimeout(timer);
    loop?.abort();
    loop = undefined;
    gesture = undefined;
  }
  function refresh() {
    suspend();
    if (!session || paused || doc.hidden) return;
    const { serial } = session;
    const controller = new AbortController();
    const signal = withoutPrompt(android.bindTransport(controller.signal, session.transportId));
    loop = controller;
    async function frame() {
      try {
        const blob = await android.capture(serial, signal);
        if (controller.signal.aborted) return;
        const bitmap = await createImageBitmap(blob);
        try {
          if (controller.signal.aborted) return;
          if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
            gesture = undefined;
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
          }
          ctx.drawImage(bitmap, 0, 0);
          if (!drawn) {
            drawn = true;
            canvas.hidden = false;
            availability({ drawn, paused });
          }
        } finally {
          bitmap.close();
        }
        // Backpressure: never capture another screen before the browser painted this one.
        timer = setTimeout(frame, 60);
      } catch (error) {
        if (controller.signal.aborted) return;
        if (transportLost(error.message))
          return disconnected("The emulator disconnected. Refresh the devices to reconnect.");
        paused = true;
        availability({ drawn, paused });
        report(`Preview paused. ${error.message}`);
      }
    }
    void frame();
  }
  function select(next) {
    session = next;
    keys = Promise.resolve();
    paused = false;
    drawn = false;
    canvas.hidden = true;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    availability({ drawn, paused });
    refresh();
  }
  function setPaused(value) {
    if (paused === value) return;
    paused = value;
    availability({ drawn, paused });
    refresh();
  }
  function send(fn) {
    const target = session;
    if (!target || !drawn || paused) return;
    keys = keys
      .then(() => {
        if (!target.signal.aborted && session === target && !paused) return fn(target);
      })
      .catch((error) => {
        if (!target.signal.aborted) report(error.message);
      });
  }
  const point = (event) =>
    screenPoint(
      canvas.getBoundingClientRect(),
      canvas.width,
      canvas.height,
      event.clientX,
      event.clientY,
    );
  canvas.addEventListener("pointerdown", (event) => {
    if (!event.isPrimary || event.button !== 0 || !session || paused) return;
    const start = point(event);
    if (!start) return;
    canvas.focus();
    canvas.setPointerCapture(event.pointerId);
    gesture = {
      id: event.pointerId,
      start,
      clientX: event.clientX,
      clientY: event.clientY,
      at: event.timeStamp,
    };
    event.preventDefault();
  });
  canvas.addEventListener("pointerup", (event) => {
    if (!gesture || event.pointerId !== gesture.id) return;
    const { start, clientX, clientY, at } = gesture;
    gesture = undefined;
    const end =
      Math.hypot(event.clientX - clientX, event.clientY - clientY) < 4 ? start : point(event);
    if (end)
      send(({ serial, signal }) =>
        android.gesture(serial, start, end, event.timeStamp - at, signal),
      );
  });
  canvas.addEventListener("lostpointercapture", () => {
    gesture = undefined;
  });
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  canvas.addEventListener("keydown", (event) => {
    if (
      event.metaKey ||
      event.altKey ||
      event.ctrlKey ||
      event.isComposing ||
      event.key === "Tab" ||
      paused
    )
      return;
    const key = event.key === "Escape" ? "Back" : event.key;
    if (
      key.length !== 1 &&
      ![
        "Back",
        "Home",
        "Backspace",
        "Enter",
        "ArrowUp",
        "ArrowDown",
        "ArrowLeft",
        "ArrowRight",
      ].includes(key)
    )
      return;
    event.preventDefault();
    send(({ serial, signal }) => android.key(serial, key, signal));
  });
  doc.addEventListener("visibilitychange", refresh);
  return {
    select,
    toggle: () => setPaused(!paused),
    setPaused,
    state: () => ({ drawn, paused, ...(drawn && { width: canvas.width, height: canvas.height }) }),
    dispose() {
      suspend();
      doc.removeEventListener("visibilitychange", refresh);
    },
  };
}
