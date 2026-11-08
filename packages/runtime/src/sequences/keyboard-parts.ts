/**
 * Settings › Keyboard's parts for key sequences (ADR 0118): every conflict with its source line,
 * the question before a new key replaces or shadows others, and the prefix timeout.
 */
import type { RebindCheck } from "../rebind";
import type { Settings } from "../settings";
import { h } from "../shell/dom";
import type { Platform } from "./chord";
import type { Conflict, Resolved } from "./conflicts";
import { type SequenceLanguage, sequenceText, TIMEOUTS, timeoutText } from "./copy";
import { formatChords, formatSequence } from "./parse";
import { conflictText, sourceText } from "./report";

export interface PartsOptions {
  platform: Platform;
  language: SequenceLanguage;
  /** A command's title. */
  name(command: string): string;
}

/** A key as <kbd>s, one per chord. */
export const keyNodes = (combo: string, platform: Platform) =>
  formatChords(combo, platform).map((chord) => h("kbd", {}, chord));

/** Every conflict, warnings and errors first; the ones precedence settled under a disclosure. */
export function conflictsSection(conflicts: Conflict[], options: PartsOptions): HTMLElement | null {
  if (!conflicts.length) return null;
  const tr = (key: Parameters<typeof sequenceText>[1]) => sequenceText(options.language, key);
  const words = { platform: options.platform, name: options.name };
  const item = (conflict: Conflict) =>
    h(
      "li",
      {
        class: `settings-key-row keys-conflict is-${conflict.severity}`,
        "data-conflict": conflict.kind,
        "data-combo": conflict.binding.combo,
      },
      h(
        "span",
        { class: "settings-key-label" },
        `${tr(conflict.severity)}: ${conflictText(conflict, words)}`,
        h("small", {}, sourceText(conflict.binding)),
      ),
    );
  const serious = conflicts.filter((c) => c.severity !== "info");
  const settled = conflicts.filter((c) => c.severity === "info");
  return h(
    "section",
    { class: "keys-conflicts", "aria-label": tr("conflicts") },
    h("h2", { class: "settings-key-note" }, `${tr("conflicts")} (${serious.length})`),
    serious.length
      ? h("ul", { class: "settings-key-list" }, serious.map(item))
      : h("p", { class: "settings-key-note" }, tr("conflictsNone")),
    settled.length
      ? h(
          "details",
          { class: "keys-conflicts-settled" },
          h("summary", {}, `${tr("overridden")} (${settled.length})`),
          h("ul", { class: "settings-key-list" }, settled.map(item)),
        )
      : null,
  );
}

/** The question before binding: what the key would replace or shadow, or why it cannot be bound.
 * Returns null when there is nothing to ask. */
export function askBeforeBinding(
  check: RebindCheck,
  options: PartsOptions & { conflict: string; replace: string; cancel: string },
  answer: { cancel(): void; bind(): void },
): HTMLElement[] | null {
  const tr = (key: Parameters<typeof sequenceText>[1]) => sequenceText(options.language, key);
  const shown = formatSequence(check.sequence, options.platform);
  const button = (label: string, primary: boolean, click: () => void) =>
    h(
      "button",
      {
        class: `settings-button desk-btn${primary ? " primary" : ""}`,
        type: "button",
        onClick: click,
      },
      label,
    );
  if (check.refused) {
    const why = `${formatSequence(check.refused.chord, options.platform)} ${check.refused.does}`;
    return [
      h("p", {}, `${shown} — ${tr("never")} ${why}`),
      button(options.cancel, false, answer.cancel),
    ];
  }
  if (!check.replaces && !check.shadows.length && !check.reserved) return null;
  const line = (b: Resolved) =>
    h(
      "li",
      {},
      ...keyNodes(b.combo, options.platform),
      ` ${options.name(b.command)} (${sourceText(b)})`,
    );
  const parts: HTMLElement[] = [];
  if (check.replaces)
    parts.push(
      h("p", {}, `${shown} — ${options.conflict} ${options.name(check.replaces.command)}`),
    );
  if (check.shadows.length)
    parts.push(
      h("p", {}, `${shown} — ${tr("shadowAsk")}`),
      h("ul", { class: "keys-shadowed" }, check.shadows.map(line)),
    );
  if (check.reserved) {
    const { chord, by, does } = check.reserved;
    parts.push(
      h(
        "p",
        {},
        `${tr("reservedAsk")} ${formatSequence(chord, options.platform)} — ${by}, ${does}`,
      ),
    );
  }
  const only = !check.replaces && !check.shadows.length;
  return [
    ...parts,
    button(options.cancel, false, answer.cancel),
    button(only ? tr("bindAnyway") : options.replace, true, answer.bind),
  ];
}

/** How long a prefix waits for the next key (desk.keys.sequence-timeout). */
export function timeoutRow(
  settings: Settings,
  key: string,
  language: SequenceLanguage,
): HTMLElement {
  const tr = (k: Parameters<typeof sequenceText>[1]) => sequenceText(language, k);
  const now = settings.get<number>(key, 0);
  const values: number[] = TIMEOUTS.includes(now as (typeof TIMEOUTS)[number])
    ? [...TIMEOUTS]
    : [...TIMEOUTS, now].sort((a, b) => a - b);
  const select = h(
    "select",
    {
      class: "desk-field keys-timeout",
      "aria-label": tr("timeoutLabel"),
      "data-key": key,
      onChange: () => settings.set(key, Number(select.value)),
    },
    values.map((ms) => h("option", { value: String(ms) }, timeoutText(language, ms))),
  );
  select.value = String(now);
  return h(
    "div",
    { class: "settings-row keys-timeout-row" },
    h(
      "div",
      { class: "settings-row-label" },
      h("span", {}, tr("timeoutLabel")),
      h("p", {}, tr("timeoutHint")),
    ),
    select,
  );
}
