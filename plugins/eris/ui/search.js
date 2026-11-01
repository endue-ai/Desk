// Completed exchanges are searchable and can be shown again without sending another brain turn.
export async function conversationSearch({ bridge, commands }, show) {
  const saved = await bridge.call("store.get", { key: "search-history" }).catch(() => ({}));
  let history = Array.isArray(saved.value) ? saved.value : [];
  let writes = Promise.resolve();
  const publish = () =>
    bridge.call("search.replace", {
      documents: history.map((turn) => ({
        id: turn.id,
        title: turn.prompt.slice(0, 120),
        detail: "Conversation with Eris",
        text: `${turn.prompt}\n${turn.answer}`.slice(0, 16384),
        command: "endue.eris.search-open",
        args: { turn: turn.id },
      })),
    });
  commands.on("endue.eris.search-open", ({ turn }) => {
    const exchange = history.find((entry) => entry.id === turn);
    if (!exchange) throw new Error("This conversation is no longer in recent history.");
    show(exchange.prompt, exchange.answer);
  });
  await publish().catch(() => {});
  return {
    add(turn) {
      history = [
        ...history.filter((entry) => entry.id !== turn.id),
        {
          id: turn.id,
          prompt: turn.prompt.slice(0, 4096),
          answer: turn.answer.slice(0, 16384),
        },
      ].slice(-30);
      while (new TextEncoder().encode(JSON.stringify(history)).length > 60000) history.shift();
      const snapshot = structuredClone(history);
      writes = writes
        .then(async () => {
          await bridge.call("store.set", { key: "search-history", value: snapshot });
          await publish();
        })
        .catch(() => {});
      return writes;
    },
  };
}
