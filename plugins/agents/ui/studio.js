// Studio, without a DOM: one agent's card with its facet cells, following the web's Studio agent
// card (a head that opens the identity, captioned cells, a row at the foot), and what the inspector
// beside the card shows for each facet. This file has the shapes, a local agent's facets (program,
// version, model, working folder, sessions and its chat) and the delete check, which asks for the
// agent's name typed exactly; studio-endue.js has an endue agent's.

/**
 * @typedef {import("./cards.js").Card} Card
 * @typedef {import("./local-api.js").LocalAgent} LocalAgent
 * @typedef {import("./local-api.js").LocalAgentSession} LocalAgentSession
 * @typedef {object} Facet
 * @property {string} id
 * @property {string} label
 * @property {string} hint      what the cell says under its label
 * @property {"head" | "card" | "foot"} place
 * @property {string} [caption] the group a card cell sits under
 * @typedef {object} Field
 * @property {string} id
 * @property {string} label
 * @property {"text" | "textarea" | "choice" | "readonly"} kind
 * @property {string} value
 * @property {number} [max]
 * @property {{ value: string, label: string }[]} [choices]
 * @property {string} [help]
 * @typedef {{ id: string, title: string, detail: string, state?: string, action?: string }} Entry
 * @typedef {object} Inspector
 * @property {string} facet
 * @property {string} title
 * @property {string} intro
 * @property {Field[]} fields
 * @property {Entry[]} [entries]   a list to read: skills, connectors, sessions …
 * @property {string} [empty]      what the list says when it is empty
 * @property {string} [save]       the save button's label; none: nothing to save here
 * @property {{ id: string, label: string, variant?: "primary" | "danger" }[]} [actions]
 * @property {string} [problem]    why part of it could not be read
 */

export const NAME_MAX = 100;
/** A role's and a description's longest, as studio.* takes them. */
export const ROLE_MAX = 2000;
export const PROMPT_MAX = 20000;
/** What Version says before a session has recorded one: the desk never starts a program to ask. */
export const NO_VERSION = "Known after its first session";

const count = (
  /** @type {number | undefined} */ n,
  /** @type {string} */ one,
  /** @type {string} */ many,
) => (n === undefined ? "" : n === 1 ? `1 ${one}` : `${n} ${many}`);

/**
 * The cells of a local agent's card.
 * @param {LocalAgent} agent
 * @param {{ model?: string, folder?: string, total?: number }} [chat] the chat's model and folder, the sessions counted
 * @returns {Facet[]}
 */
export function localFacets(agent, chat = {}) {
  const total = chat.total ?? agent.sessions;
  return [
    { id: "identity", label: "Identity", hint: agent.vendor, place: "head" },
    {
      id: "program",
      label: "Program",
      hint: agent.program ? "Found on this computer" : "Not found: sessions only",
      place: "card",
      caption: "Program",
    },
    {
      id: "version",
      label: "Version",
      hint: agent.version ?? NO_VERSION,
      place: "card",
      caption: "Program",
    },
    {
      id: "model",
      label: "Model",
      hint: chat.model || "The program's default",
      place: "card",
      caption: "Work",
    },
    {
      id: "folder",
      label: "Working folder",
      hint: chat.folder || "~",
      place: "card",
      caption: "Work",
    },
    {
      id: "sessions",
      label: "Sessions",
      hint: `${count(total, "session", "sessions")}${agent.archived ? ` · ${agent.archived} archived` : ""}`,
      place: "card",
      caption: "History",
    },
    {
      id: "chat",
      label: "Chat",
      hint: agent.program ? "Send it a message" : "Read its sessions",
      place: "foot",
    },
  ];
}

/**
 * What the inspector shows for one of a local agent's facets.
 * @param {LocalAgent} agent
 * @param {string} facet
 * @param {{ model?: string, folder?: string, sessions?: LocalAgentSession[], total?: number }} [chat]
 * @returns {Inspector}
 */
export function localInspector(agent, facet, chat = {}) {
  const readonly = (
    /** @type {string} */ id,
    /** @type {string} */ label,
    /** @type {string} */ value,
  ) => /** @type {Field} */ ({ id, label, kind: "readonly", value });
  switch (facet) {
    case "program":
      return {
        facet,
        title: "Program",
        intro: agent.program
          ? "The program the desk runs, without a shell, in its non-interactive mode."
          : "No program to run was found on PATH or where its installer puts it, so its sessions are read but it cannot be asked.",
        fields: [
          readonly("program", "Runs from", agent.program ?? "Not found"),
          readonly("home", "Data folder", agent.home ?? ""),
          readonly("vendor", "Made by", agent.vendor),
        ],
      };
    case "version":
      return {
        facet,
        title: "Version",
        intro:
          "The version its newest session recorded. Finding an agent never starts it, so a program with no session yet has no version here.",
        fields: [readonly("version", "Version", agent.version ?? NO_VERSION)],
      };
    case "model":
      return {
        facet,
        title: "Model",
        intro: "The model the chat's next message asks the program to think with.",
        fields: [
          {
            id: "model",
            label: "Model",
            kind: "text",
            value: chat.model ?? "",
            max: 128,
            help: "Empty: the program's default.",
          },
        ],
        save: "Use",
      };
    case "folder":
      return {
        facet,
        title: "Working folder",
        intro: "Where a new session works. A session you continue keeps its own folder.",
        fields: [
          {
            id: "folder",
            label: "Folder",
            kind: "text",
            value: chat.folder ?? "~",
            max: 1024,
            help: "~ is your home folder.",
          },
        ],
        save: "Use",
      };
    case "sessions":
      return {
        facet,
        title: "Sessions",
        intro:
          "Its sessions as the program keeps them, the most recently active first. Open one to continue it.",
        fields: [],
        entries: (chat.sessions ?? []).map((s) => ({
          id: s.id,
          title: s.title || "Untitled session",
          detail: [s.cwd, s.branch].filter(Boolean).join(" · "),
          state: s.updatedAt,
          action: "Open",
        })),
        empty: "No sessions yet. Send a message to start one.",
        actions: [{ id: "new-session", label: "New session" }],
      };
    default:
      return {
        facet: "identity",
        title: "Identity",
        intro: "An agent program on this computer, found by its own files.",
        fields: [
          readonly("name", "Name", agent.name),
          readonly("vendor", "Made by", agent.vendor),
          readonly("id", "Agent ID", agent.id),
        ],
      };
  }
}

/** Whether `typed` is the agent's name exactly, which Delete waits for. */
export function deleteConfirmed(/** @type {string} */ typed, /** @type {string} */ name) {
  return name.length > 0 && typed.trim() === name.trim();
}

/** The web's Studio page for an endue agent. */
export function webStudio(/** @type {string} */ id) {
  return `https://endue.ai/agent/${encodeURIComponent(id)}/studio`;
}

/** The one Card a key names, or undefined. */
export function cardFor(/** @type {Card[]} */ cards, /** @type {string | undefined} */ key) {
  return key ? cards.find((card) => card.key === key) : undefined;
}
