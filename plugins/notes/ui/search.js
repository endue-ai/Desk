// The open notes in the desk's global search (search.replace): only notes the person opened, never
// arbitrary files or private settings, the last 30. The list is replaced at once after an open, a
// revert or a close, and 500 ms after typing stops; a hit opens its note again.

/**
 * @typedef {import("@endue-ai/plugin-sdk").PluginContext} PluginContext
 * @typedef {{ buffer: string, path: string, name: string, text: string }} SearchNote
 */

/**
 * @param {Pick<PluginContext, "bridge" | "commands">} ctx
 * @param {() => SearchNote[]} open the open notes, in the order they opened
 */
export function createSearch({ bridge, commands }, open) {
  let publishing = false;
  /** @type {"typing" | "immediate" | undefined} */
  let pending;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let publishTimer;
  /** The open notes search lists: the last 30. */
  const published = () => open().slice(-30);
  const sendSearch = () => {
    if (publishing || !pending || (pending === "typing" && publishTimer !== undefined)) return;
    // An immediate replacement includes every edit so far, even if its timer was still running.
    clearTimeout(publishTimer);
    publishTimer = undefined;
    pending = undefined;
    publishing = true;
    const documents = published().map((note) => ({
      id: note.path,
      title: note.name,
      detail: note.path,
      text: note.text.slice(0, 16384),
      command: "endue.notes.search-open",
      args: { path: note.path },
    }));
    const finished = () => {
      publishing = false;
      sendSearch();
    };
    void bridge.call("search.replace", { documents }).then(finished, finished);
  };
  const publish = () => {
    clearTimeout(publishTimer);
    publishTimer = undefined;
    pending = "immediate";
    sendSearch();
  };
  const publishAfterTyping = () => {
    clearTimeout(publishTimer);
    publishTimer = setTimeout(() => {
      publishTimer = undefined;
      pending ??= "typing";
      sendSearch();
    }, 500);
  };
  commands.on("endue.notes.search-open", (args) => {
    const { path } = /** @type {{ path?: unknown }} */ (args ?? {});
    if (typeof path !== "string" || path === "") throw new Error("Choose a note to open");
    const note = open().find((n) => n.path === path);
    if (note) return commands.run("desk.buffers.switch", { id: note.buffer });
    return commands.run("desk.files.open", { path });
  });
  return { publish, publishAfterTyping, published };
}
