// endue.agents: every agent as a card in one interface (ADR 0112). The person's endue AI agents
// through studio.* and the agent programs on this computer through agents.*, on the public SDK and
// bridge only, as a community plugin would. The tested modules take the bridge from here.
import { defineUiPlugin } from "@endue-ai/plugin-sdk";
import { defineElements } from "@endue-ai/ui";
import { createApp } from "./app.js";
import { createAsk } from "./ask.js";
import { createView } from "./view.js";

defineElements();

defineUiPlugin({
  async mount(ctx) {
    const ask = createAsk(document);
    /** @type {import("./app.js").App | undefined} */
    let app;
    const on = () => /** @type {import("./app.js").App} */ (app);
    /** The agent on screen's id in its source. */
    const shownId = () => on().route.key?.slice(on().route.key?.indexOf(":") + 1) ?? "";
    const view = createView(document, {
      home: (tab) => on().home(tab),
      create: () => on().create(),
      studio: (key, facet) => on().studio(key, facet),
      facet: (facet) => on().facet(facet),
      back: () => on().back(),
      refresh: () => void on().refresh(),
      signIn: () => void on().signIn(),
      filter: (change) => on().filter(change),
      boardAgent: (key) => on().boardAgent(key),
      openRow: (row) => void on().openRow(row),
      stopRun: (runId) => void on().stopRun(runId),
      openWeb: (id) => void on().studioActions.act(id, "open-web"),
      save: (facet, values) => {
        const key = on().route.key ?? "";
        if (key.startsWith("local:")) on().local(shownId(), facet, values);
        else void on().studioActions.save(shownId(), facet, values);
      },
      act: (action) => {
        const key = on().route.key ?? "";
        if (key.startsWith("local:")) on().local(shownId(), action);
        else void on().studioActions.act(shownId(), action);
      },
      entry: (id) => {
        const key = on().route.key ?? "";
        if (key.startsWith("local:")) on().local(shownId(), "open", { id });
        else void on().studioActions.restore(shownId(), Number(id));
      },
      confirmDelete: (typed) => void on().studioActions.confirmDelete(shownId(), typed),
      cancelDelete: () => on().studioActions.cancelDelete(shownId()),
      chat: {
        send: (text) => on().chat(shownId()).send(text),
        stop: () => void on().chat(shownId()).stop(),
        access: (access) => on().chat(shownId()).setAccess(access),
        fresh: () => on().local(shownId(), "new-session"),
        link: (href) => void on().studioActions.link(href),
      },
      flow: {
        mode: (mode) => on().flow.mode(mode),
        find: (query) => void on().flow.find(query),
        select: (slug) => on().flow.select(slug),
        use: (slug) => void on().flow.use(slug),
        build: (fields) => void on().flow.build(fields),
      },
      catalogPage: () => void on().studioActions.link("https://endue.ai/agents"),
    });
    app = createApp(ctx, view, {
      confirm: (text) => ask({ title: "Are you sure?", text, yes: "Disable", danger: true }),
      approve: ({ prompt, folder, agent }) =>
        ask({
          title: "Let it change files?",
          text: `${agent} may change files and run commands in ${folder || "the session's folder"}. Send this message?`,
          detail: prompt,
          yes: "Allow and send",
        }),
    });
    // Signing in happens in the desk's account menu: look again when the person comes back.
    window.addEventListener("focus", () => {
      if (on().sides.endue.state === "signed-out") void on().refreshEndue();
    });
    // The board follows endue AI as the web's does: every 30 seconds while Activity shows.
    setInterval(() => {
      const { page, tab } = on().route;
      if (!document.hidden && page === "home" && tab === "activity") void on().refreshEndue();
    }, 30_000);
    await app.ready;
  },
});
