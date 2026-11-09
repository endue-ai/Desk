/**
 * Settings, endue account, signed in (ADR 0130): the groups endue.ai's Account and General settings
 * show, drawn from account.settings.get. The profile saves its changed keys together, as endue.ai's
 * Save does; the language, the time zone and each notification save themselves when changed.
 */
import type {
  AccountNotification,
  AccountProfile,
  AccountSettings,
  AccountSettingsUpdateParams,
} from "@endue-ai/bridge";
import { type Child, h } from "../shell/dom";
import { computerZone, languageChoices, zoneChoices } from "./account-choices";
import { type AccountCopy, accountText, kindText } from "./account-copy";
import type { SettingsLanguage } from "./copy";

export type AccountChange = Omit<AccountSettingsUpdateParams, "scope">;

export interface AccountRowsDeps {
  language: SettingsLanguage;
  settings: AccountSettings;
  /** account.status's profile, for its picture (a data: URL). */
  profile: AccountProfile | undefined;
  /** Save a change on endue; resolves true once saved. */
  save(change: AccountChange): Promise<boolean>;
  signOut(): void;
  retry(): void;
  now?: Date;
}

const WEB = /^https?:\/\/\S+$/;

export function accountRows(deps: AccountRowsDeps): Child[] {
  const { language, settings } = deps;
  const tr = (key: AccountCopy, vars?: Record<string, string>) => accountText(language, key, vars);
  const group = (title: AccountCopy, key: string, ...rows: Child[]) =>
    h(
      "section",
      { class: "settings-group", "data-account-group": key },
      h("h3", {}, tr(title)),
      h("div", { class: "settings-group-rows" }, rows),
    );
  const row = (label: string, hint: string | undefined, control: Child) =>
    h(
      "div",
      { class: "settings-row" },
      h(
        "div",
        { class: "settings-row-label" },
        h("span", {}, label),
        hint ? h("p", {}, hint) : null,
      ),
      control,
    );
  const value = (text: string, key: string) =>
    h("span", { class: "settings-account-value", "data-key": key }, text);
  const failed = (part: "preferences" | "notifications") => {
    const problem = settings.problems.find((p) => p.part === part);
    if (!problem) return null;
    return row(
      tr("partFailed"),
      problem.message,
      h(
        "button",
        { type: "button", class: "btn btn-xs btn-outline", onClick: deps.retry },
        tr("retry"),
      ),
    );
  };
  const user = settings.user;
  const joined = new Intl.DateTimeFormat(language === "ko" ? "ko-KR" : "en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(user.joinedAt));

  return [
    header(deps),
    group(
      "profile",
      "profile",
      profileForm(deps),
      row(tr("email"), undefined, value(user.email, "account-email")),
      row(tr("userId"), undefined, value(user.id, "account-id")),
      row(tr("status"), undefined, value(tr(user.status), "account-status")),
      row(tr("joined"), undefined, value(joined, "account-joined")),
    ),
    group(
      "languageRegion",
      "language",
      failed("preferences") ?? [languageRow(deps, row), zoneRow(deps)],
    ),
    group(
      "notifications",
      "notifications",
      failed("notifications") ?? settings.notifications.map((n) => notificationRow(deps, n, row)),
    ),
    h("p", { class: "settings-footnote" }, tr("notificationsHint")),
    group(
      "signOutGroup",
      "sign-out",
      row(
        tr("signOut"),
        tr("signOutHint"),
        h(
          "button",
          {
            type: "button",
            class: "btn btn-xs btn-outline",
            "data-key": "account-sign-out",
            onClick: deps.signOut,
          },
          tr("signOut"),
        ),
      ),
    ),
    h("p", { class: "settings-footnote" }, tr("footnote")),
  ];
}

type Row = (label: string, hint: string | undefined, control: Child) => HTMLElement;

/** The person's picture from account.status, else their initial. */
export function accountAvatar(profile: AccountProfile | undefined, shown: string, size: number) {
  const picture = profile?.avatarUrl;
  return h(
    "span",
    {
      class: "settings-account-avatar",
      style: { width: `${size}px`, height: `${size}px` },
      "aria-hidden": "true",
    },
    picture?.startsWith("data:image/")
      ? h("img", { src: picture, alt: "" })
      : (shown.trim()[0] ?? "?").toUpperCase(),
  );
}

function header({ settings, profile }: AccountRowsDeps): HTMLElement {
  const { user } = settings;
  const shown = user.displayName ?? user.email.split("@")[0] ?? user.email;
  return h(
    "div",
    { class: "settings-about settings-account-header" },
    accountAvatar(profile, shown, 76),
    h("h2", { "data-key": "account-shown-name" }, shown),
    h("p", {}, user.email),
  );
}

function profileForm(deps: AccountRowsDeps): Child[] {
  const tr = (key: AccountCopy) => accountText(deps.language, key);
  const { user } = deps.settings;
  const alert = h("p", { class: "settings-row-error", role: "alert", hidden: true });
  const field = (key: string, type: string, current: string, label: string, placeholder: string) =>
    h("input", {
      class: "input settings-input",
      type,
      value: current,
      placeholder,
      "aria-label": label,
      "data-key": key,
      maxlength: key === "account-name" ? 200 : 2048,
      onInput: () => {
        save.disabled = !changed();
        alert.hidden = true;
      },
    });
  const name = field(
    "account-name",
    "text",
    user.displayName ?? "",
    tr("name"),
    tr("namePlaceholder"),
  );
  const avatar = field(
    "account-avatar",
    "url",
    user.avatarUrl ?? "",
    tr("avatarUrl"),
    "https://example.com/avatar.png",
  );
  const change = (): AccountChange => {
    const out: AccountChange = {};
    const shownName = name.value.trim();
    const shownAvatar = avatar.value.trim();
    if (shownName !== (user.displayName ?? "")) out.displayName = shownName;
    if (shownAvatar !== (user.avatarUrl ?? "")) out.avatarUrl = shownAvatar;
    return out;
  };
  const changed = () => Object.keys(change()).length > 0;
  const refuse = (key: AccountCopy) => {
    alert.textContent = tr(key);
    alert.hidden = false;
  };
  const save = h(
    "button",
    {
      type: "button",
      class: "btn btn-xs btn-primary",
      "data-key": "account-save",
      disabled: true,
      onClick: async () => {
        const next = change();
        if (next.displayName !== undefined && (!next.displayName || next.displayName.length > 200))
          return refuse("nameInvalid");
        if (next.avatarUrl && !WEB.test(next.avatarUrl)) return refuse("urlInvalid");
        save.disabled = true;
        save.textContent = tr("saving");
        const ok = await deps.save(next);
        save.textContent = tr("save");
        save.disabled = ok ? true : !changed();
      },
    },
    tr("save"),
  );
  const labelled = (label: string, hint: string | undefined, control: Child) =>
    h(
      "div",
      { class: "settings-row settings-account-field" },
      h(
        "div",
        { class: "settings-row-label" },
        h("span", {}, label),
        hint ? h("p", {}, hint) : null,
      ),
      control,
    );
  return [
    labelled(tr("name"), undefined, name),
    labelled(tr("avatarUrl"), tr("avatarHint"), avatar),
    h("div", { class: "settings-row settings-account-actions" }, alert, save),
  ];
}

function languageRow({ language, settings, save }: AccountRowsDeps, row: Row): HTMLElement {
  const tr = (key: AccountCopy) => accountText(language, key);
  const current = settings.language;
  const select = h(
    "select",
    {
      class: "input",
      "aria-label": tr("displayLanguage"),
      "data-key": "account-language",
      onChange: () => select.value && void save({ language: select.value }),
    },
    current ? null : h("option", { value: "" }, tr("notChosen")),
    languageChoices(current).map((c) => h("option", { value: c.value }, c.label)),
  );
  select.value = current ?? "";
  return row(tr("displayLanguage"), tr("displayLanguageHint"), select);
}

function zoneRow({ language, settings, save, now }: AccountRowsDeps): HTMLElement {
  const tr = (key: AccountCopy, vars?: Record<string, string>) => accountText(language, key, vars);
  const saved = settings.timeZone;
  const computer = computerZone();
  const select = h(
    "select",
    {
      class: "input",
      "aria-label": tr("timeZone"),
      "data-key": "account-time-zone",
      onChange: () => void save({ timeZone: select.value }),
    },
    zoneChoices(saved, computer, now).map((c) => h("option", { value: c.value }, c.label)),
  );
  if (saved) select.value = saved;
  // endue.ai offers the browser's zone when it differs; the desk offers this computer's.
  const differs = computer && saved && computer !== saved;
  return h(
    "div",
    { class: "settings-row" },
    h(
      "div",
      { class: "settings-row-label" },
      h("span", {}, tr("timeZone")),
      h("p", {}, tr("timeZoneHint")),
      differs
        ? h(
            "p",
            { class: "settings-account-zone", "data-key": "account-computer-zone" },
            tr("computerZone", { zone: computer }),
            h(
              "button",
              {
                type: "button",
                class: "btn btn-xs btn-outline",
                "data-key": "account-use-computer-zone",
                onClick: () => void save({ timeZone: computer }),
              },
              tr("useComputerZone"),
            ),
          )
        : null,
    ),
    select,
  );
}

function notificationRow(
  { language, save }: AccountRowsDeps,
  notification: AccountNotification,
  row: Row,
): HTMLElement {
  const { label, hint } = kindText(language, notification.kind);
  // A checkbox, as the declared plugin settings draw a switch (desk-check).
  const box = h("input", {
    type: "checkbox",
    class: "desk-check",
    role: "switch",
    "aria-label": label,
    "data-key": `account-notify-${notification.kind}`,
    onChange: () => void save({ notifications: [{ kind: notification.kind, inApp: box.checked }] }),
  });
  box.checked = notification.inApp;
  return row(label, hint, box);
}
