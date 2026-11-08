// An endue agent in Studio, without a DOM: the cells of its card (the web's Studio agent card: a
// head that opens its identity, cells under Identity, Ability and Pairing, a Settings row at the
// foot) and what the inspector shows for each, read from studio.agents.facets. A facet endue AI did
// not answer for says so in its cell and its inspector instead of looking empty.

import { NAME_MAX, PROMPT_MAX, ROLE_MAX } from "./studio.js";

/**
 * @typedef {import("./studio.js").Facet} Facet
 * @typedef {import("./studio.js").Inspector} Inspector
 * @typedef {import("./studio.js").Entry} Entry
 * @typedef {import("./studio-api.js").EndueDetail} EndueDetail
 */

const count = (
  /** @type {number | undefined} */ n,
  /** @type {string} */ one,
  /** @type {string} */ many,
) => (n === undefined ? "" : n === 1 ? `1 ${one}` : `${n} ${many}`);

/** The facet's problem, when endue AI did not answer for it. */
const problemOf = (/** @type {EndueDetail | undefined} */ detail, /** @type {string} */ facet) =>
  detail?.problems.find((p) => p.facet === facet);

/** The short model id: anthropic/claude-sonnet-4.5 → claude-sonnet-4.5. */
export const shortModel = (/** @type {string | undefined} */ model) =>
  model ? (model.split("/").at(-1) ?? model) : "";

/**
 * The cells of an endue agent's card; counts show once the facets are read.
 * @param {EndueDetail | undefined} detail
 * @returns {Facet[]}
 */
export function endueFacets(detail) {
  const hint = (
    /** @type {string} */ facet,
    /** @type {string} */ known,
    /** @type {string} */ fallback,
  ) => (problemOf(detail, facet) ? "Could not be read" : detail ? known || fallback : fallback);
  const on = detail?.traits.filter((t) => t.enabled).length;
  const settings = detail?.settings;
  return [
    { id: "identity", label: "Identity", hint: "Name, role and languages", place: "head" },
    {
      id: "prompt",
      label: "Prompt",
      hint: hint(
        "prompt",
        detail?.prompt ? `Revision ${detail.prompt.rev}` : "",
        "Role and responses",
      ),
      place: "card",
      caption: "Identity",
    },
    {
      id: "traits",
      label: "Traits",
      hint: hint("traits", count(on, "trait on", "traits on"), "Loop behavior"),
      place: "card",
      caption: "Identity",
    },
    {
      id: "skills",
      label: "Skills",
      hint: hint(
        "skills",
        count(detail?.skills.length, "skill", "skills"),
        "Available capabilities",
      ),
      place: "card",
      caption: "Ability",
    },
    {
      id: "connectors",
      label: "Connectors",
      hint: hint(
        "connectors",
        count(detail?.connectors.length, "connector", "connectors"),
        "The tools it works with",
      ),
      place: "card",
      caption: "Ability",
    },
    {
      id: "channels",
      label: "Channels",
      hint: "Paired on endue.ai",
      place: "card",
      caption: "Pairing",
    },
    {
      id: "status",
      label: "Status",
      hint: detail
        ? detail.agent.status === "active"
          ? "Active"
          : "Disabled"
        : "Active or disabled",
      place: "card",
      caption: "Pairing",
    },
    {
      id: "settings",
      label: "Settings",
      hint: hint(
        "settings",
        settings
          ? `${settings.visibility[0]?.toUpperCase()}${settings.visibility.slice(1)} · ${shortModel(settings.model.default) || "endue AI's model"}`
          : "",
        "Visibility and management",
      ),
      place: "foot",
    },
  ];
}

/**
 * What the inspector shows for one of an endue agent's facets.
 * @param {EndueDetail} detail
 * @param {string} facet
 * @returns {Inspector}
 */
export function endueInspector(detail, facet) {
  const { agent, identity, settings } = detail;
  const problem = problemOf(detail, facet === "prompt" ? "prompt" : facet);
  const note = problem ? { problem: `endue AI did not answer for this: ${problem.message}` } : {};
  const list = (
    /** @type {string} */ title,
    /** @type {string} */ intro,
    /** @type {Entry[]} */ entries,
    /** @type {string} */ empty,
  ) => ({ facet, title, intro, fields: [], entries, empty, ...note });
  const onOff = (/** @type {boolean} */ enabled) => (enabled ? "On" : "Off");
  switch (facet) {
    case "identity":
      return {
        facet,
        title: "Identity",
        intro: "The name people see in chats, mentions and lists, and the work it does by default.",
        fields: [
          {
            id: "name",
            label: "Display name",
            kind: "text",
            value: identity?.name ?? agent.name,
            max: NAME_MAX,
          },
          {
            id: "handle",
            label: "Handle",
            kind: "readonly",
            value: agent.slug ? `@${agent.slug}` : "",
          },
          {
            id: "role",
            label: "Role",
            kind: "textarea",
            value: identity?.role ?? "",
            max: ROLE_MAX,
          },
          {
            id: "description",
            label: "Description",
            kind: "textarea",
            value: identity?.description ?? "",
            max: ROLE_MAX,
          },
          {
            id: "languages",
            label: "Languages",
            kind: "text",
            value: (identity?.languages ?? []).join(", "),
            max: 100,
            help: "Language tags separated by commas: ko, en, ja, zh.",
          },
          { id: "id", label: "Agent ID", kind: "readonly", value: agent.id },
        ],
        save: "Save",
        ...note,
      };
    case "prompt":
      return {
        facet,
        title: "Prompt",
        intro: "The instructions it follows in every conversation. Each save is a new revision.",
        fields: [
          {
            id: "prompt",
            label: "Instructions",
            kind: "textarea",
            value: detail.prompt?.content ?? "",
            max: PROMPT_MAX,
          },
        ],
        entries: detail.revisions.map((r) => ({
          id: String(r.rev),
          title: `Revision ${r.rev}${r.source === "restore" && r.restoredFromRev ? ` (from ${r.restoredFromRev})` : ""}`,
          detail: r.preview,
          state: r.active ? "In force" : "",
          ...(r.active ? {} : { action: "Restore" }),
        })),
        empty: "No revisions yet.",
        save: "Save prompt",
        ...note,
      };
    case "traits":
      return list(
        "Traits",
        "How it loops, remembers and reports. A trait never set is not listed.",
        detail.traits.map((t) => ({
          id: t.key,
          title: t.key.replaceAll("_", " "),
          detail: "",
          state: onOff(t.enabled),
        })),
        "No traits set on this agent.",
      );
    case "skills":
      return list(
        "Skills",
        "What it can do beyond answering.",
        detail.skills.map((s) => ({
          id: s.id,
          title: s.name ?? s.slug ?? s.skillId,
          detail: s.slug ?? "",
          state: onOff(s.enabled),
        })),
        "No skills yet. Add them on endue.ai.",
      );
    case "connectors":
      return list(
        "Connectors",
        "The services it works in, with how each connection stands.",
        detail.connectors.map((c) => ({
          id: c.id,
          title: c.name ?? c.type ?? c.connectionId,
          detail: [c.type, c.status].filter(Boolean).join(" · "),
          state: onOff(c.enabled),
        })),
        "No connectors yet. Connect them on endue.ai.",
      );
    case "channels":
      return {
        facet,
        title: "Channels",
        intro:
          "Where people reach it: Slack, Discord, KakaoTalk, NaverTalk, WhatsApp and Telegram. Pair them on endue.ai.",
        fields: [],
        actions: [{ id: "open-web", label: "Open in endue.ai" }],
      };
    case "status":
      return {
        facet,
        title: "Status",
        intro:
          agent.status === "active"
            ? "Active: it answers requests. Disable it to stop it in every channel and API."
            : "Disabled: it answers nothing until you enable it again.",
        fields: [],
        actions: [
          agent.status === "active"
            ? { id: "disable", label: "Disable" }
            : { id: "enable", label: "Enable", variant: "primary" },
        ],
      };
    default:
      return {
        facet: "settings",
        title: "Settings",
        intro: "Who can find it, the model it thinks with, and managing it.",
        fields: settings
          ? [
              {
                id: "visibility",
                label: "Visibility",
                kind: "choice",
                value: settings.visibility,
                choices: [
                  { value: "private", label: "Private: only you" },
                  { value: "unlisted", label: "Unlisted: anyone with the link" },
                  { value: "public", label: "Public: anyone" },
                ],
              },
              {
                id: "model",
                label: "Chat model",
                kind: "text",
                value: settings.model.default ?? "",
                max: 200,
                help: "Empty: endue AI's default.",
              },
              {
                id: "retention",
                label: "Chat history kept",
                kind: "readonly",
                value: settings.chatHistoryRetention
                  ? `${settings.chatHistoryRetention} days`
                  : "As endue AI keeps it",
              },
            ]
          : [],
        ...(settings ? { save: "Save" } : {}),
        actions: [
          { id: "open-web", label: "Open in endue.ai" },
          { id: "delete", label: "Delete agent", variant: "danger" },
        ],
        ...note,
      };
  }
}
