// The thread list beside the chat: a new chat, a search through titles and last messages, and the
// threads grouped by when they were last written to, pinned ones first. Right-click or the row's
// menu renames, pins or removes one.
import { fill, h, icon, iconButton } from "./dom.js";
import { openMenu } from "./menu.js";
import { groupThreads } from "./threads.js";

/** @typedef {import("./app.js").App} App */

/** @param {App} app */
export function threadsView(app) {
  const { S } = app;
  const list = h("div.lm-thread-list", { role: "list" });
  const search = /** @type {HTMLInputElement} */ (
    h("input.desk-field.lm-search", {
      type: "search",
      placeholder: "Search chats",
      "aria-label": "Search chats",
      onInput: (/** @type {Event} */ e) =>
        S.set({ search: /** @type {HTMLInputElement} */ (e.target).value }),
    })
  );
  const el = h(
    "aside.lm-side",
    { "aria-label": "Chats" },
    h(
      "div.lm-side-head",
      null,
      h("h2.lm-side-title", null, "Chats"),
      iconButton("newChat", "New chat (Mod+N)", () => app.newChat(), { class: "lm-new-chat" }),
    ),
    h("label.lm-search-wrap", null, icon("search"), search),
    list,
  );

  /** @type {string | null} */
  let renaming = null;

  /** The title as a field, saved on Enter or leaving it. @param {import("./threads.js").ThreadEntry} t */
  function renameField(t) {
    const input = /** @type {HTMLInputElement} */ (
      h("input.desk-field.lm-rename", { value: t.title, "aria-label": "Chat title" })
    );
    let done = false;
    const finish = (/** @type {boolean} */ save) => {
      if (done) return;
      done = true;
      renaming = null;
      const title = input.value.trim();
      if (save && title && title !== t.title) void app.updateThread(t.id, { title });
      else draw();
    };
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") finish(true);
      if (e.key === "Escape") finish(false);
    });
    input.addEventListener("blur", () => finish(true));
    input.addEventListener("click", (e) => e.stopPropagation());
    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
    return input;
  }

  /** @param {import("./threads.js").ThreadEntry} entry @param {MouseEvent} event */
  function menu(entry, event) {
    event.preventDefault();
    event.stopPropagation();
    openMenu(event, [
      {
        label: "Rename",
        icon: "edit",
        run: () => {
          renaming = entry.id;
          draw();
        },
      },
      {
        label: entry.pinned ? "Unpin" : "Pin",
        icon: "pin",
        run: () => void app.updateThread(entry.id, { pinned: !entry.pinned }),
      },
      { separator: true },
      {
        label: "Move to Trash",
        icon: "trash",
        danger: true,
        run: () => void app.deleteThread(entry.id),
      },
    ]);
  }

  function draw() {
    const { threads, thread, search: q, generating } = S.get();
    const needle = q.trim().toLowerCase();
    const shown = needle
      ? threads.filter(
          (t) =>
            t.title.toLowerCase().includes(needle) ||
            (t.preview ?? "").toLowerCase().includes(needle),
        )
      : threads;
    if (!shown.length) {
      fill(
        list,
        h(
          "div.lm-side-empty",
          null,
          needle
            ? `No chat matches “${q.trim()}”.`
            : "Your chats show here. They are kept as files in ~/.endue/local-models.",
        ),
      );
      return;
    }
    fill(
      list,
      groupThreads(shown).map(([group, entries]) =>
        h(
          "section.lm-thread-group",
          null,
          h("h3.lm-group-title", null, group),
          entries.map((t) =>
            h(
              "div.desk-row.lm-thread",
              {
                role: "listitem",
                tabindex: "0",
                "aria-current": thread?.id === t.id ? "true" : undefined,
                dataset: { active: thread?.id === t.id ? "1" : undefined, id: t.id },
                onClick: () => void app.openThread(t.id),
                onKeydown: (/** @type {KeyboardEvent} */ e) => {
                  if (e.key === "Enter") void app.openThread(t.id);
                },
                onContextmenu: (/** @type {MouseEvent} */ e) => menu(t, e),
              },
              renaming === t.id
                ? renameField(t)
                : h(
                    "div.lm-thread-text",
                    null,
                    h(
                      "div.lm-thread-title",
                      null,
                      t.pinned ? icon("pin", "lm-thread-pin") : null,
                      generating?.threadId === t.id
                        ? h("span.lm-live-dot", { title: "Writing" })
                        : null,
                      h("span", null, t.title),
                    ),
                    t.preview ? h("div.lm-thread-preview", null, t.preview) : null,
                  ),
              iconButton("more", "More", (e) => menu(t, e), { class: "lm-thread-more" }),
            ),
          ),
        ),
      ),
    );
  }

  S.onSignal("rename", (/** @type {string} */ id) => {
    renaming = id;
    draw();
  });
  S.on(["threads", "thread", "search", "generating"], draw);
  draw();
  return { el, focusSearch: () => search.focus() };
}
