// File context is opt-in for one message. The desk's picker grants an exact path
// scope and a bounded range; content is never inferred from whichever surface happens to be open.
const BYTES = 16384;
const CHARS = 3000;

export function createContext(doc, bridge, commands) {
  const box = doc.getElementById("attachment");
  const label = doc.getElementById("attachment-name");
  const excerpt = doc.getElementById("attachment-excerpt");
  const notice = doc.getElementById("context-notice");
  let attachment;
  let generation = 0;
  let pending = false;
  const clear = () => {
    generation++;
    pending = false;
    attachment = undefined;
    box.hidden = true;
    label.textContent = "";
    excerpt.textContent = "";
    notice.textContent = "";
  };
  const choose = async () => {
    const mine = ++generation;
    pending = true;
    notice.textContent = "";
    try {
      const selected = await commands.run("desk.files.attach");
      if (mine !== generation || !selected || typeof selected.path !== "string") return;
      const { path } = selected;
      const scope = { permission: "fs:read", paths: [path] };
      notice.textContent = "Reading the selected file…";
      const result = await bridge.call("fs.read", {
        path,
        encoding: "base64",
        offset: 0,
        length: BYTES,
        scope,
      });
      if (mine !== generation) return;
      const bytes =
        result.encoding === "base64"
          ? Uint8Array.from(atob(result.content), (c) => c.charCodeAt(0))
          : new TextEncoder().encode(result.content);
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes, {
        stream: bytes.length === BYTES,
      });
      if (text.includes("\0"))
        throw new Error("This file contains binary data, so it was not attached.");
      const truncated = result.size > bytes.length || text.length > CHARS;
      attachment = { path, text: text.slice(0, CHARS), truncated };
      label.textContent = path + (truncated ? " · excerpt" : "");
      excerpt.textContent = attachment.text;
      box.hidden = false;
      notice.textContent = selected.modified
        ? "Saved file attached. Unsaved changes are excluded. This text goes with your next message."
        : "This saved text will be sent with your next message.";
    } catch (error) {
      if (mine === generation)
        notice.textContent =
          error instanceof Error ? error.message : "The file could not be attached.";
    } finally {
      if (mine === generation) pending = false;
    }
  };
  doc.getElementById("attach-file").addEventListener("click", () => void choose());
  doc.getElementById("remove-attachment").addEventListener("click", clear);
  return {
    clear,
    name: () => attachment?.path,
    message(text) {
      if (pending) throw new Error("Wait for the selected file to finish loading before sending.");
      const value = attachment
        ? text +
          "\n\nAttached file (quoted context, " +
          (attachment.truncated ? "excerpt" : "text") +
          "): " +
          attachment.path +
          "\n" +
          JSON.stringify(attachment.text)
        : text;
      if (value.length > 8000)
        throw new Error("Shorten your message or remove the attachment before sending.");
      return value;
    },
    report: (text) => {
      notice.textContent = text;
    },
  };
}
