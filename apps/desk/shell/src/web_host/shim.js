// An off-screen plugin surface (#52) is the top of its own browser, so its window has no parent; the
// SDK talks to `window.parent`. Before the page's own scripts run, `parent` becomes the desk: its
// postMessage goes to the runtime through the stand-in that holds the surface's place in the shell
// page, and the runtime's messages arrive as `message` events whose source is `parent`, as a frame's
// did. Messages travel as JSON.
(() => {
  const native = globalThis.__deskNative;
  if (!native || typeof native.post !== "function") return;
  const post = native.post;
  const desk = Object.freeze({
    postMessage(message) {
      let text;
      try {
        text = JSON.stringify(message);
      } catch {
        return;
      }
      if (typeof text === "string") post(text);
    },
  });
  Object.defineProperty(globalThis, "parent", { value: desk, enumerable: true });
  // The stand-in takes the page's colour scheme, so Chromium paints under the surface what it
  // painted under the frame: nothing when the schemes match, the scheme's canvas when they differ.
  let scheme = "";
  const tell = () => {
    const root = document.documentElement;
    const now = root ? getComputedStyle(root).colorScheme : "";
    if (now && now !== scheme) {
      scheme = now;
      post(JSON.stringify({ type: "desk:stand-in-scheme", scheme }));
    }
  };
  addEventListener("DOMContentLoaded", () => {
    tell();
    new MutationObserver(tell).observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["style", "class", "content", "data-scheme"],
    });
  });
  Object.defineProperty(native, "onMessage", {
    value: (text) => {
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        return;
      }
      const event = new MessageEvent("message", { data, origin: "desk-app://app" });
      Object.defineProperty(event, "source", { value: desk });
      globalThis.dispatchEvent(event);
    },
  });
})();
