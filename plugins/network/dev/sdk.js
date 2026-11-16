// The preview's stand-in for /_desk/plugin-sdk.js: defineUiPlugin mounts the plugin with a ctx
// whose bridge answers from home.js. Query parameters: lang (en, ko), scheme (dark, light), admin
// (yes, no: what the person said earlier, with the devices and log kept from before), tab, select
// (a MAC address), check (all: check every device's ports), brain (demo), ssid (1: names shown).
// Served at /_desk/plugin-sdk.js, so home.js is named from the plugin folder.
import * as home from "/dev/home.js";

const q = new URLSearchParams(location.search);
const language = q.get("lang") === "ko" ? "ko" : "en";
document.documentElement.dataset.scheme = q.get("scheme") === "light" ? "light" : "dark";
document.documentElement.lang = language;

export class CommandFailed extends Error {
  constructor(
    /** @type {string} */ name,
    /** @type {string} */ code,
    /** @type {string} */ message,
  ) {
    super(`${name}: ${code}: ${message}`);
    this.code = code;
  }
}

const listeners = new Set();
const emit = (/** @type {string} */ event, /** @type {any} */ data) =>
  setTimeout(() => {
    for (const l of listeners) l({ event, data });
  }, 2);
const store = new Map();
if (q.get("admin")) {
  const id = "gw-000aeb010203";
  store.set("networks", {
    [id]: { cidr: "192.168.0.0/24", first: home.kept.log[0].at, admin: q.get("admin") === "yes" },
  });
  store.set(`devices.${id}`, home.kept.devices);
  store.set(`log.${id}`, home.kept.log);
}
let procs = 0;
const run = (/** @type {string} */ command, /** @type {string[]} */ args) => {
  const ip = args.at(-1) ?? "";
  if (command.endsWith("/route")) return { code: 0, out: home.route() };
  if (command.endsWith("/ifconfig")) return { code: 0, out: home.ifconfig() };
  if (command.endsWith("/arp")) return { code: 0, out: home.arp() };
  if (command.endsWith("/ping")) return home.ping(ip);
  if (command.endsWith("/dig")) return home.dig(args[1]);
  if (command.endsWith("/system_profiler"))
    return { code: 0, out: home.wifi(q.get("ssid") === "1") };
  return { code: 1, out: "" };
};
const said = {
  en: {
    summary:
      "Port 23 is Telnet, an old way to log in to a device that sends the password unencrypted. Anyone on the network can read it, and many cameras ship with a default password.",
    steps: [
      "Open the camera's admin page and turn Telnet off.",
      "Change the admin password.",
      "Update the camera's firmware.",
    ],
  },
  ko: {
    summary:
      "포트 23 은 Telnet 이에요. 기기에 로그인하는 오래된 방식이라 암호가 암호화되지 않은 채 오가서, 같은 네트워크의 누구나 읽을 수 있어요.",
    steps: [
      "카메라의 관리 화면에서 Telnet 을 끄세요.",
      "관리자 암호를 바꾸세요.",
      "카메라의 펌웨어를 업데이트하세요.",
    ],
  },
};

const bridge = {
  onEvent: (/** @type {any} */ l) => {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  call: async (/** @type {string} */ method, /** @type {any} */ p) => {
    switch (method) {
      case "store.get":
        return store.has(p.key) ? { value: structuredClone(store.get(p.key)) } : {};
      case "store.set":
        store.set(p.key, structuredClone(p.value));
        return {};
      case "perm.request":
        return { granted: true };
      case "ui.notify":
        console.log("notify", p.title, p.body);
        return { id: "n" };
      case "proc.spawn": {
        const procId = `p${procs++}`;
        const { code, out } = run(p.command, p.args);
        emit("proc.output", { procId, stream: "stdout", data: out, encoding: "utf8" });
        setTimeout(() => emit("proc.exit", { procId, code }), 3);
        return { procId };
      }
      case "net.connect":
        await new Promise((r) => setTimeout(r, 4));
        if (home.isOpen(p.host, p.port)) return { socketId: `${p.host}:${p.port}` };
        throw Object.assign(new Error("refused"), { code: "io_error" });
      case "net.close":
        return {};
      case "brain.ask":
        if (q.get("brain") !== "demo")
          throw Object.assign(new Error("no brain"), { code: "unsupported" });
        emit("brain.turn", { turnId: "t", kind: "completed", structured: said[language] });
        return { turnId: "t" };
      default:
        throw Object.assign(new Error(method), { code: "unsupported" });
    }
  },
};

async function messages() {
  const load = async (/** @type {string} */ l) => (await fetch(`../messages/${l}.json`)).json();
  const catalogs = { en: await load("en"), [language]: await load(language) };
  const rules = new Intl.PluralRules(language);
  return {
    language: () => language,
    onChange: () => () => {},
    t: (/** @type {string} */ id, /** @type {any} */ params = {}) => {
      const entry = catalogs[language][id] ?? catalogs.en[id] ?? id;
      const text =
        typeof entry === "string"
          ? entry
          : (entry[rules.select(Number(params.count))] ?? entry.other);
      return text.replace(/\{(\w+)\}/g, (/** @type {string} */ _, /** @type {string} */ k) =>
        String(params[k] ?? ""),
      );
    },
  };
}

export async function defineUiPlugin(/** @type {{ mount(ctx: any): unknown }} */ plugin) {
  const ctx = {
    pluginId: "endue.network",
    bridge,
    messages: await messages(),
    settings: { get: async () => 5, onChange: () => () => {} },
    commands: { on: () => () => {} },
    universal: undefined,
  };
  await plugin.mount(ctx);
  const click = (/** @type {string} */ selector) =>
    /** @type {HTMLElement | null} */ (document.querySelector(selector))?.click();
  setTimeout(async () => {
    if (q.get("check") === "all") click('[data-act="tab"][data-tab="checkup"]');
    if (q.get("check") === "all") setTimeout(() => click('[data-act="check-all"]'), 50);
    if (q.get("tab")) setTimeout(() => click(`[data-act="tab"][data-tab="${q.get("tab")}"]`), 400);
    if (q.get("select"))
      setTimeout(() => click(`[data-act="device"][data-mac="${q.get("select")}"]`), 600);
    if (q.get("explain"))
      setTimeout(
        () =>
          click(
            q.get("explain") === "card"
              ? '[data-act="explain-card"]'
              : '[data-act="explain-device"]',
          ),
        800,
      );
  }, 300);
}
