/**
 * Settings, Connections: the connectors connector.list lists (ADR 0032), each instance with its status,
 * sync and disconnect, and a form drawn from the connector's instanceSettings to connect another. A
 * secret setting is a password field, emptied as soon as the call is made; the core keeps the value
 * and never lists it back (ADR 0036, ADR 0106). `desk.connectors.open { connector?, kinds? }` opens it
 * with that connector, or the ones that bring those kinds, first.
 */
import {
  BridgeCallError,
  type BridgeClient,
  type ConnectorInfo,
  type ConnectorInstance,
  type ConnectorSetting,
  type ItemKind,
} from "@endue-ai/bridge";
import { h, render } from "../shell/dom";
import type { SettingsLanguage } from "./copy";

const SCOPE = { permission: "connector:manage" } as const;

export interface ConnectionsFocus {
  connector?: string;
  kinds?: string[];
}

export interface ConnectionsPanel {
  el: HTMLElement;
  /** Resolves once the first listing is drawn. */
  ready: Promise<void>;
  /** Resolves once every call started so far has been answered and drawn. */
  idle(): Promise<void>;
  dispose(): void;
}

const COPY = {
  brings: ["가져오는 항목:", "Brings in"],
  connect: ["연결", "Connect"],
  another: ["하나 더 연결", "Connect another"],
  name: ["이름", "Name"],
  sync: ["지금 동기화", "Sync now"],
  disconnect: ["연결 해제", "Disconnect"],
  none: ["아직 연결된 계정이 없습니다.", "Nothing connected yet."],
  empty: ["설치된 커넥터가 없습니다.", "No connectors are installed."],
  synced: ["마지막 동기화", "Last synced"],
  secret: [
    "이 컴퓨터에만 보관하며 다시 보여주지 않습니다.",
    "Kept on this computer only and never shown again.",
  ],
  connected: ["연결됨", "Connected"],
  syncing: ["동기화 중", "Syncing"],
  stale: ["오래됨", "Out of date"],
  error: ["오류", "Error"],
  paused: ["일시 중지됨", "Paused"],
  reauth: ["토큰을 새로 넣어 다시 연결하세요.", "Connect again with a new token."],
} as const;
type Copy = keyof typeof COPY;

const KINDS: Record<ItemKind, [string, string]> = {
  event: ["일정", "events"],
  message: ["메시지", "messages"],
  task: ["할 일", "tasks"],
  note: ["노트", "notes"],
  file: ["파일", "files"],
  person: ["사람", "people"],
  entry: ["기록", "entries"],
  metric: ["지표", "metrics"],
  record: ["레코드", "records"],
};

/** An instance id from the name the person gave: lowercase words joined by `-`, or `default`. */
export function instanceIdOf(title: string, taken: string[]): string {
  const words = title
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-");
  const slug = words
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/, "");
  if (slug) return slug;
  if (!title.trim()) return "default";
  let n = taken.length + 1;
  while (taken.includes(`instance-${n}`)) n += 1;
  return `instance-${n}`;
}

export function mountConnections(options: {
  bridge: BridgeClient;
  language: SettingsLanguage;
  focus?: ConnectionsFocus;
}): ConnectionsPanel {
  const { bridge, language, focus = {} } = options;
  const tr = (key: Copy) => COPY[key][language === "ko" ? 0 : 1];
  const el = h("div", { class: "settings-panel-body settings-connections" });
  let connectors: ConnectorInfo[] = [];
  let pending: Promise<void> = Promise.resolve();
  let disposed = false;
  /** Run `work` after what is pending, then draw again; failures land in `alert`. */
  const queue = (work: () => Promise<unknown>, alert?: HTMLElement) => {
    pending = pending.then(async () => {
      if (alert) alert.textContent = "";
      try {
        await work();
      } catch (error) {
        if (alert)
          alert.textContent = error instanceof BridgeCallError ? error.message : String(error);
      }
      await load();
    });
    return pending;
  };
  async function load() {
    if (disposed) return;
    try {
      connectors = (await bridge.call("connector.list", { scope: SCOPE })).connectors;
    } catch {
      connectors = [];
    }
    draw();
  }
  const kindsText = (info: ConnectorInfo) => {
    const names = info.resources.map((r) => KINDS[r.kind][language === "ko" ? 0 : 1]);
    if (language === "ko") return names.join(", ");
    return names.length < 2
      ? names.join("")
      : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  };
  const wanted = (info: ConnectorInfo) =>
    info.id === focus.connector ||
    ((focus.kinds?.length ?? 0) > 0 &&
      (focus.kinds ?? []).every((kind) => info.resources.some((r) => r.kind === kind)));
  const instanceRow = (instance: ConnectorInstance) => {
    const { connector, instance: id, status } = instance;
    const state = status.state;
    const detail = status.error
      ? `${status.error.message}${status.error.reauth ? ` ${tr("reauth")}` : ""}`
      : status.lastSyncAt
        ? `${tr("synced")} ${new Date(status.lastSyncAt).toLocaleString(language)}`
        : "";
    const call = (method: "connector.sync" | "connector.disconnect") => () =>
      void queue(() => bridge.call(method, { connector, instance: id, scope: SCOPE }));
    return h(
      "div",
      { class: "settings-row connection-instance", "data-instance": `${connector}/${id}` },
      h(
        "div",
        { class: "settings-row-label" },
        h("span", {}, instance.title ?? id),
        h(
          "p",
          {},
          h("b", { class: `connection-state ${state}` }, tr(state)),
          detail ? ` · ${detail}` : "",
        ),
      ),
      h(
        "div",
        { class: "connection-actions" },
        h(
          "button",
          { type: "button", class: "btn btn-xs btn-outline", onClick: call("connector.sync") },
          tr("sync"),
        ),
        h(
          "button",
          {
            type: "button",
            class: "btn btn-xs btn-outline",
            onClick: call("connector.disconnect"),
          },
          tr("disconnect"),
        ),
      ),
    );
  };
  const field = (name: string, setting: ConnectorSetting) => {
    const secret = setting.secret === true;
    const required = setting.required === true && setting.default === undefined;
    const input =
      setting.kind === "boolean"
        ? h("input", {
            class: "desk-check",
            type: "checkbox",
            name,
            checked: setting.default === true,
          })
        : h("input", {
            class: "input",
            type: secret ? "password" : setting.kind === "integer" ? "number" : "text",
            name,
            autocomplete: "off",
            spellcheck: "false",
            required,
            placeholder: setting.default === undefined ? undefined : String(setting.default),
          });
    const hint = secret ? tr("secret") : setting.description;
    return h(
      "label",
      { class: "connection-field" },
      h("span", {}, setting.title),
      input,
      hint ? h("small", {}, hint) : null,
    );
  };
  const connectForm = (info: ConnectorInfo) => {
    const settings = Object.entries(info.instanceSettings ?? {});
    const alert = h("p", { class: "connection-alert", role: "alert" });
    const title = h("input", {
      class: "input",
      type: "text",
      name: "title",
      autocomplete: "off",
    });
    const form = h(
      "form",
      { class: "connection-form", "data-connect": info.id },
      h("label", { class: "connection-field" }, h("span", {}, tr("name")), title),
      settings.map(([name, setting]) => field(name, setting)),
      alert,
      h("button", { type: "submit", class: "btn btn-xs btn-primary" }, tr("connect")),
    );
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const values: Record<string, unknown> = {};
      for (const [name, setting] of settings) {
        const input = form.elements.namedItem(name) as HTMLInputElement | null;
        if (!input) continue;
        if (setting.kind === "boolean") values[name] = input.checked;
        else if (input.value !== "")
          values[name] = setting.kind === "integer" ? Number(input.value) : input.value;
      }
      const name = title.value.trim();
      const taken = info.instances.map((i) => i.instance);
      const params = {
        connector: info.id,
        instance: instanceIdOf(name, taken),
        ...(name ? { title: name } : {}),
        settings: values,
        scope: SCOPE,
      };
      // The secret leaves the page with this call: its field is emptied before any answer.
      for (const [field, setting] of settings)
        if (setting.secret) (form.elements.namedItem(field) as HTMLInputElement).value = "";
      void queue(() => bridge.call("connector.connect", params), alert);
    });
    const open = info.instances.length === 0 || info.id === focus.connector;
    return h(
      "details",
      { class: "connection-add", open },
      h("summary", {}, info.instances.length === 0 ? tr("connect") : tr("another")),
      form,
    );
  };
  function draw() {
    const ordered = [...connectors].sort(
      (a, b) => Number(wanted(b)) - Number(wanted(a)) || a.id.localeCompare(b.id),
    );
    render(el, () =>
      ordered.length === 0
        ? [h("p", { class: "settings-footnote" }, tr("empty"))]
        : ordered.map((info) =>
            h(
              "section",
              {
                class: `settings-group connection${wanted(info) ? " focused" : ""}`,
                "data-connector": info.id,
              },
              h("h2", {}, info.title ?? info.id),
              h(
                "p",
                { class: "settings-footnote" },
                `${tr("brings")} ${kindsText(info)}${language === "ko" ? "" : "."}`,
              ),
              h(
                "div",
                { class: "settings-group-rows" },
                info.instances.length === 0
                  ? h("p", { class: "connection-none" }, tr("none"))
                  : info.instances.map(instanceRow),
                info.auth?.kind === "none" && info.instances.length > 0 ? null : connectForm(info),
              ),
            ),
          ),
    );
  }
  // A change from elsewhere (a scheduled sync) redraws, but never under a form being filled in.
  let stale = false;
  const typing = () =>
    el.contains(document.activeElement) && document.activeElement?.closest("form");
  const refresh = () => {
    if (typing()) stale = true;
    else void queue(async () => {});
  };
  const off = bridge.onEvent((event) => {
    if (event.event === "connector.changed") refresh();
  });
  el.addEventListener("focusout", () => {
    if (!stale) return;
    stale = false;
    queueMicrotask(refresh);
  });
  const ready = load();
  pending = ready;
  return {
    el,
    ready,
    idle: () => pending,
    dispose: () => {
      disposed = true;
      off();
      el.remove();
    },
  };
}
