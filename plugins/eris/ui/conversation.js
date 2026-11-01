// A readable, bounded log. Frame state keeps finished exchanges through a reload, without
// replaying them to the brain. Only the current answer's text node changes while it streams.
const LIMIT = 50;
const TEXT_LIMIT = 20000;

export function createConversation(doc, state) {
  const root = doc.getElementById("conversation");
  const saved = state?.get()?.conversation;
  const messages =
    saved?.version === 1 && Array.isArray(saved.messages)
      ? saved.messages
          .filter((m) => m && ["user", "assistant"].includes(m.role) && typeof m.text === "string")
          .slice(-LIMIT)
          .map((m) => ({
            role: m.role,
            text: m.pending
              ? "Answer interrupted by a panel reload. Send your question again to continue."
              : m.text.slice(0, TEXT_LIMIT),
          }))
      : [];
  let current;
  let paragraph;
  let status;
  const keep = () =>
    state?.set({
      ...state.get(),
      conversation: {
        version: 1,
        messages: messages.map((m) => ({ ...m })),
      },
    });
  const follows = () => root.scrollHeight - root.scrollTop - root.clientHeight < 40;
  const down = (follow) => {
    if (follow) root.scrollTop = root.scrollHeight;
  };
  const row = (message) => {
    const article = doc.createElement("article");
    article.dataset.role = message.role;
    const who = doc.createElement("strong");
    who.textContent = message.role === "user" ? "You" : "Eris";
    const text = doc.createElement("p");
    text.textContent = message.text;
    article.append(who, text);
    root.append(article);
    return { article, text };
  };
  for (const message of messages) row(message);
  const add = (message) => {
    messages.push(message);
    while (messages.length > LIMIT) {
      messages.shift();
      root.firstElementChild?.remove();
    }
    return row(message);
  };
  return {
    begin(text, attachment) {
      const follow = follows();
      add({ role: "user", text: attachment ? `${text}\nAttached: ${attachment}` : text });
      current = { role: "assistant", text: "", pending: true };
      const made = add(current);
      paragraph = made.text;
      status = doc.createElement("small");
      status.textContent = "Waiting for an answer…";
      made.article.append(status);
      keep();
      down(follow);
    },
    answer(text, final = false) {
      if (!current) return;
      const follow = follows();
      current.text =
        text.length > TEXT_LIMIT ? `${text.slice(0, TEXT_LIMIT)}\n[Long answer excerpt]` : text;
      paragraph.textContent = current.text;
      status.textContent = final ? "" : "Answering…";
      if (final) {
        delete current.pending;
        keep();
      }
      down(follow);
    },
    notice(text, failed = false) {
      if (!current) return;
      status.textContent = text;
      if (failed) {
        delete current.pending;
        current.text += (current.text ? "\n" : "") + text;
        paragraph.textContent = current.text;
        status.textContent = "";
        keep();
      }
    },
  };
}
