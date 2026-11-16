// The response's half of a tab: the status line (status, time with its phases, size, protocol),
// then Body, Headers, Cookies and Timeline, and Tests once a request has checks. Before anything
// is sent it says how to send; while sending it shows the bytes coming in; a failure says why.

import { button, h, icon, keys } from "./dom.js";
import { bytes, duration, statusClass } from "./format.js";
import { responseBody } from "./res-body.js";
import { miniBar, timelineView, waterfall } from "./res-timing.js";

/**
 * @typedef {import("./app.js").Tab} Tab
 * @typedef {import("./studio.js").Studio} Studio
 * @typedef {import("./send.js").Response} Response
 * @typedef {{ id: string, label: string, count?(res: Response, tab: Tab): number | string | undefined,
 *   show?(res: Response, tab: Tab): boolean, draw(S: Studio, tab: Tab, res: Response): HTMLElement }} ResTab
 */

/** Response tabs other features add (Tests). @type {ResTab[]} */
export const RES_TABS = [];

/** Parse Set-Cookie headers into rows. @param {Response} res */
export function cookiesOf(res) {
  return res.headers
    .filter(([k]) => k.toLowerCase() === "set-cookie")
    .map(([, v]) => {
      const [first = "", ...attrs] = v.split(";");
      const eq = first.indexOf("=");
      /** @type {Record<string, string>} */
      const a = {};
      for (const attr of attrs) {
        const [k = "", ...rest] = attr.trim().split("=");
        if (k) a[k.toLowerCase()] = rest.join("=") || "true";
      }
      return {
        name: first.slice(0, eq).trim(),
        value: first.slice(eq + 1).trim(),
        domain: a.domain ?? "",
        path: a.path ?? "",
        expires: a.expires ?? (a["max-age"] ? `in ${a["max-age"]} s` : "Session"),
        httpOnly: "httponly" in a,
        secure: "secure" in a,
        sameSite: a.samesite ?? "",
      };
    });
}

/** @param {Studio} S @param {Tab} tab */
export function responsePane(S, tab) {
  const root = h("section.as-res");
  /** @type {ReturnType<typeof setInterval> | undefined} */
  let ticker;

  const empty = () =>
    h(
      "div.as-res-empty",
      null,
      h("div.as-res-empty-art", null, icon("send", 30)),
      h("h3", null, "Send the request to see its response"),
      h(
        "div.as-shortcuts",
        null,
        ...[
          ["Send", "Mod+Enter"],
          ["Save", "Mod+S"],
          ["New tab", "Mod+T"],
          ["Focus URL", "Mod+L"],
        ].map(([what, k]) =>
          h("div.as-shortcut", null, h("span", null, what), h("kbd", null, keys(k ?? ""))),
        ),
      ),
    );

  const sending = () => {
    const started = Date.now();
    const clock = h("span.as-sending-time", null, "0 ms");
    clearInterval(ticker);
    ticker = setInterval(() => {
      clock.textContent = duration(Date.now() - started);
      if (!tab.running) clearInterval(ticker);
    }, 61);
    return h(
      "div.as-res-empty.is-sending",
      null,
      h("span.as-spin.is-big"),
      h("h3", null, "Sending…"),
      clock,
      button({ label: "Cancel", icon: "stop", onClick: () => S.cancel(tab) }),
    );
  };

  /** @param {Response} res */
  const failed = (res) =>
    h(
      "div.as-res-error",
      null,
      h("div.as-res-error-icon", null, icon("alert", 26)),
      h("h3", null, res.cancelled ? "The request was cancelled" : "Could not get a response"),
      h("p.as-res-error-text", null, res.error ?? ""),
      res.missing.length
        ? h("p.as-hint", null, `Not defined: ${res.missing.map((m) => `{{${m}}}`).join(", ")}`)
        : null,
      res.cancelled
        ? null
        : h(
            "div.as-res-error-actions",
            null,
            button({
              label: "Try again",
              icon: "refresh",
              kind: "desk-btn-primary",
              onClick: () => S.send(tab),
            }),
            button({ label: "Ask AI why", icon: "sparkle", onClick: () => S.explain?.(tab) }),
          ),
    );

  /** @param {Response} res */
  const status = (res) => {
    const time = h(
      "span.as-stat.as-time",
      { tabindex: "0" },
      icon("clock", 14),
      duration(res.timings.total),
      miniBar(res),
      h("div.as-pop", null, h("div.as-pop-title", null, "Timing"), waterfall(res)),
    );
    return h(
      "div.as-status",
      null,
      h(
        `span.status-pill.s-${statusClass(res.status)}`,
        null,
        h("strong", null, String(res.status)),
        res.reason ? ` ${res.reason}` : "",
      ),
      time,
      h(
        "span.as-stat",
        { title: `${bytes(res.size)} body, ${bytes(res.headerSize)} headers` },
        icon("weight", 14),
        bytes(res.size),
      ),
      res.httpVersion ? h("span.as-stat.as-proto", null, res.httpVersion) : null,
      res.hops.length
        ? h(
            "span.as-stat.as-redirected",
            { title: res.hops.map((x) => `${x.status} → ${x.location}`).join("\n") },
            icon("link", 14),
            `${res.hops.length} redirect${res.hops.length > 1 ? "s" : ""}`,
          )
        : null,
      res.error
        ? h("span.as-stat.as-warn", { title: res.error }, icon("alert", 14), "Incomplete")
        : null,
      h("span.as-grow"),
      button({
        label: "Clear the response",
        icon: "trash",
        hideLabel: true,
        onClick: () => S.clearResponse(tab),
      }),
    );
  };

  /** @param {Response} res */
  const tabs = (res) => {
    const cookies = cookiesOf(res);
    /** @type {ResTab[]} */
    const all = [
      {
        id: "body",
        label: "Body",
        draw: () =>
          responseBody(res, {
            view: S.resView(tab),
            wrap: S.app.state.layout.wrap,
            onView: (v) => S.setResView(tab, v),
            onWrap: (w) => S.app.layout({ wrap: w }),
            onSave: () => S.saveBody(tab),
            onCopy: (t) => S.copy(t, "Body copied"),
          }),
      },
      {
        id: "headers",
        label: "Headers",
        count: () => res.headers.length,
        draw: () => headersView(res),
      },
      {
        id: "cookies",
        label: "Cookies",
        count: () => cookies.length,
        draw: () => cookiesView(cookies),
      },
      { id: "timeline", label: "Timeline", draw: () => timelineView(res) },
      ...RES_TABS.filter((t) => t.show?.(res, tab) ?? true),
    ];
    const chosen = all.find((t) => t.id === tab.resTab) ?? all[0];
    const strip = h(
      "div.desk-tabs.as-subtabs",
      { role: "tablist", "aria-label": "Response sections" },
      ...all.map((t) => {
        const n = t.count?.(res, tab);
        return h(
          `button.desk-tab.as-subtab${t === chosen ? ".is-selected" : ""}`,
          {
            type: "button",
            role: "tab",
            "aria-selected": String(t === chosen),
            dataset: { section: t.id },
            onClick: () => {
              tab.resTab = t.id;
              draw();
            },
          },
          t.label,
          n
            ? h(
                `span.tab-count${typeof n === "string" ? `.${n.startsWith("✓") ? "is-ok" : "is-bad"}` : ""}`,
                null,
                String(n),
              )
            : null,
        );
      }),
    );
    return [
      strip,
      h(
        "div.as-res-panel",
        { dataset: { section: chosen?.id ?? "" } },
        chosen ? chosen.draw(S, tab, res) : null,
      ),
    ];
  };

  const draw = () => {
    clearInterval(ticker);
    const res = tab.response;
    if (tab.running) root.replaceChildren(sending());
    else if (!res) root.replaceChildren(empty());
    else if (!res.status) root.replaceChildren(status(res), failed(res));
    else root.replaceChildren(status(res), ...tabs(res));
  };
  draw();
  return { el: root, redraw: draw };
}

/** @param {Response} res */
function headersView(res) {
  return h(
    "div.as-headers",
    null,
    h(
      "table.desk-table.as-table",
      null,
      h("thead", null, h("tr", null, h("th", null, "Name"), h("th", null, "Value"))),
      h(
        "tbody",
        null,
        ...res.headers.map(([k, v]) =>
          h("tr", null, h("td.as-hname", null, k), h("td.as-hvalue", null, v)),
        ),
      ),
    ),
    res.sent.headers.length
      ? h(
          "details.as-sent",
          null,
          h("summary", null, `Sent ${res.sent.headers.length} headers`),
          h(
            "table.desk-table.as-table",
            null,
            h(
              "tbody",
              null,
              ...res.sent.headers.map(([k, v]) =>
                h(
                  "tr",
                  null,
                  h("td.as-hname", null, k),
                  h(
                    "td.as-hvalue",
                    null,
                    /^(authorization|cookie|proxy-authorization)$/i.test(k)
                      ? `${v.slice(0, 10)}…`
                      : v,
                  ),
                ),
              ),
            ),
          ),
        )
      : null,
  );
}

/** @param {ReturnType<typeof cookiesOf>} cookies */
function cookiesView(cookies) {
  if (!cookies.length)
    return h(
      "div.as-res-note",
      null,
      icon("cookie", 18),
      h("span", null, "This response set no cookies."),
    );
  return h(
    "div.as-headers",
    null,
    h(
      "table.desk-table.as-table.as-cookies",
      null,
      h(
        "thead",
        null,
        h(
          "tr",
          null,
          ...["Name", "Value", "Domain", "Path", "Expires", "Flags"].map((t) => h("th", null, t)),
        ),
      ),
      h(
        "tbody",
        null,
        ...cookies.map((c) =>
          h(
            "tr",
            null,
            h("td.as-hname", null, c.name),
            h("td.as-hvalue", null, c.value),
            h("td", null, c.domain || "—"),
            h("td", null, c.path || "—"),
            h("td", null, c.expires),
            h(
              "td",
              null,
              [
                c.httpOnly ? "HttpOnly" : "",
                c.secure ? "Secure" : "",
                c.sameSite ? `SameSite=${c.sameSite}` : "",
              ]
                .filter(Boolean)
                .join(" · ") || "—",
            ),
          ),
        ),
      ),
    ),
  );
}
