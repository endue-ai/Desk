// File context is opt-in for one message. Use the existing bridge permission flow, an exact path
// scope and a bounded range; content is never inferred from whichever surface happens to be open.
const BYTES = 16384;
const CHARS = 3000;
const TEXT =
  /\.(txt|md|markdown|csv|tsv|json|jsonl|yaml|yml|xml|html|css|js|ts|jsx|tsx|rs|py|sh|toml|ini|cfg|sql|log|c|h|cpp|java|go|rb|php|svelte|vue)$/i;

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
      const listed = await commands.run("desk.buffers.list");
      const files = Array.isArray(listed)
        ? listed.filter(
            (f) => typeof f.path === "string" && TEXT.test(f.path) && !/[*?]/.test(f.path),
          )
        : [];
      if (!files.length) throw new Error("Open a text file first, then attach it here.");
      const path = await commands
        .run("desk.palette.pick", {
          title: "Attach the saved text of an open file",
          items: files.map((f) => ({
            id: f.path,
            label: f.name ?? f.path.split("/").at(-1),
            detail: f.path + (f.modified ? " · unsaved changes are excluded" : ""),
          })),
        })
        .catch(() => undefined);
      if (mine !== generation || path === undefined || path === null) return;
      const selected = files.find((f) => f.path === path);
      if (!selected) throw new Error("Choose one of the open text files.");
      const scope = { permission: "fs:read", paths: [path] };
      const read = () =>
        bridge.call("fs.read", { path, encoding: "base64", offset: 0, length: BYTES, scope });
      notice.textContent = "Reading the selected file…";
      let result;
      try {
        result = await read();
      } catch (error) {
        if (error?.code !== "permission_denied") throw error;
        if (mine !== generation) return;
        const decision = await bridge.call("perm.request", {
          permission: scope,
          reason: `To attach ${path} to your next message to Eris`,
        });
        if (mine !== generation) return;
        if (!decision.granted) throw new Error("The file was not attached: reading was declined.");
        result = await read();
      }
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
