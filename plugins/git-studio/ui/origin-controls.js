// Mutations are started by a person in the Origin dashboard. The form names the remote target and
// the controller rechecks origin immediately before sending anything that changes it.

import { messageOf } from "./app.js";
import { h } from "./dom.js";
import { parseOrigin } from "./origin-model.js";
import { ask, menu } from "./overlay.js";

/**
 * @typedef {import("./origin-model.js").Origin} Origin
 * @typedef {{ root: string, origin: Origin, api: ReturnType<import("./origin-api.js").originApi> }} Target
 * @param {import("./app.js").App} app
 * @param {HTMLElement} layer
 * @param {() => Target | null} selected
 * @param {(notice: string, error: boolean) => void} report
 * @param {() => void} refresh
 */
export function originControls(app, layer, selected, report, refresh) {
  let inFlight = false;

  /**
   * @param {Target} target
   * @param {import("./overlay.js").Ask} form
   * @param {string | ((result: unknown) => string)} success
   * @param {(values: Record<string, string | boolean>, check: () => void) => Promise<unknown>} send
   */
  async function change(target, form, success, send) {
    if (inFlight || selected() !== target) return;
    inFlight = true;
    const active = /** @type {HTMLElement | null} */ (layer.ownerDocument.activeElement);
    const check = () => {
      if (selected() !== target)
        throw new Error(
          "The selected origin changed. Open its dashboard and review the action again.",
        );
    };
    try {
      const values = await ask(layer, form);
      if (active?.isConnected) active.focus();
      if (!values) return;
      check();
      const { stdout } = await app.git.run(["remote", "get-url", "origin"], { cwd: target.root });
      if (parseOrigin(stdout.trim())?.web !== target.origin.web)
        throw new Error(
          "The repository's origin changed. Refresh the dashboard and review the action again.",
        );
      check();
      report(`Updating ${target.origin.path}…`, false);
      const result = await send(values, check);
      if (selected() !== target) return;
      report(typeof success === "string" ? success : success(result), false);
      refresh();
    } catch (error) {
      if (selected() === target) report(messageOf(error), true);
    } finally {
      inFlight = false;
    }
  }

  return {
    createRequest(/** @type {Target} */ target) {
      const snapshot = app.get().snapshot;
      const noun = target.origin.program === "gh" ? "pull request" : "merge request";
      void change(
        target,
        {
          title: `Create a ${noun}`,
          confirm: `Create ${noun}`,
          body: `Repository: ${target.origin.path}. Use branches already pushed to origin.`,
          fields: [
            { name: "source", label: "Source branch", value: snapshot?.status.branch ?? "" },
            { name: "target", label: "Target branch", placeholder: "main" },
            { name: "title", label: "Title" },
            { name: "body", label: "Description", kind: "textarea" },
          ],
          check: ({ source, target, title }) =>
            !source || !target || !title
              ? "Enter both branches and a title."
              : source === target
                ? "Choose different source and target branches."
                : /:/.test(`${source}${target}`)
                  ? "Use branch names on origin."
                  : null,
        },
        `Created the ${noun} on origin.`,
        (values) =>
          target.api.createRequest({
            source: String(values.source),
            target: String(values.target),
            title: String(values.title),
            body: String(values.body),
          }),
      );
    },

    requestMenu(
      /** @type {Target} */ target,
      /** @type {import("./origin-model.js").Request} */ request,
      /** @type {import("./origin-model.js").Stack[]} */ children,
      /** @type {MouseEvent} */ event,
    ) {
      const github = target.origin.program === "gh";
      const prefix = github ? "#" : "!";
      const reference = `${prefix}${request.number}`;
      const noun = github ? "pull request" : "merge request";
      const description = h(
        "div.origin-dialog-context",
        null,
        h("strong", null, `${reference} ${request.title}`),
        h("span", null, `${request.source} → ${request.target}`),
        h("span.desk-muted", null, target.origin.path),
      );
      /** @param {"close" | "reopen" | "merge"} action @param {string} label */
      const entry = (action, label) => ({
        label,
        danger: action === "close",
        run: () =>
          void change(
            target,
            {
              title: `${label} ${reference}`,
              confirm: label,
              body:
                action === "merge" && children.length
                  ? h(
                      "div.origin-dialog-context",
                      null,
                      description,
                      h(
                        "span",
                        null,
                        `Merge ${children.map(({ request }) => `${prefix}${request.number}`).join(", ")} first to include their changes.`,
                      ),
                    )
                  : description,
              danger: action === "close",
              fields:
                github && action === "merge"
                  ? [
                      {
                        name: "method",
                        label: "Merge method",
                        kind: "select",
                        value: "merge",
                        options: [
                          { value: "merge", label: "Merge commit" },
                          { value: "squash", label: "Squash and merge" },
                          { value: "rebase", label: "Rebase and merge" },
                        ],
                      },
                    ]
                  : [],
            },
            (result) =>
              result === "submitted"
                ? `Sent the merge for ${reference} to GitLab. Refresh to check its state.`
                : `${reference} was ${action === "reopen" ? "reopened" : `${action}d`} on origin.`,
            (values, check) =>
              target.api.changeRequest(request, action, String(values.method ?? "merge"), check),
          ),
      });
      const items =
        request.state === "Closed"
          ? [entry("reopen", `Reopen ${noun}`)]
          : [entry("close", `Close ${noun}`)];
      if (request.state === "Open") items.unshift(entry("merge", `Merge ${noun}`));
      menu(layer, point(event), items);
    },

    publish(/** @type {Target} */ target) {
      void change(
        target,
        {
          title: "Publish a release",
          confirm: "Publish release",
          body: `Repository: ${target.origin.path}. Use a tag that already exists on origin.`,
          fields: [
            { name: "tag", label: "Existing tag", placeholder: "v1.2.0" },
            { name: "title", label: "Release title" },
            { name: "notes", label: "Release notes", kind: "textarea" },
          ],
          check: ({ tag, title }) => (tag && title ? null : "Enter the tag and release title."),
        },
        "Published the release on origin.",
        (values) =>
          target.api.publish({
            tag: String(values.tag),
            title: String(values.title),
            notes: String(values.notes),
          }),
      );
    },

    releaseMenu(
      /** @type {Target} */ target,
      /** @type {import("./origin-model.js").Release} */ release,
      /** @type {MouseEvent} */ event,
    ) {
      menu(layer, point(event), [
        {
          label: "Edit release",
          run: () =>
            void change(
              target,
              {
                title: `Edit release ${release.tag}`,
                confirm: "Save release",
                body: target.origin.path,
                fields: [
                  { name: "title", label: "Release title", value: release.name },
                  { name: "notes", label: "Release notes", kind: "textarea", value: release.notes },
                ],
                check: ({ title }) => (title ? null : "Enter the release title."),
              },
              `Updated release ${release.tag} on origin.`,
              (values) =>
                target.api.editRelease(release, {
                  title: String(values.title),
                  notes: String(values.notes),
                }),
            ),
        },
        {
          label: "Delete release",
          danger: true,
          run: () =>
            void change(
              target,
              {
                title: `Delete release ${release.tag}`,
                confirm: "Delete release",
                danger: true,
                body: `Delete the release from ${target.origin.path}. The Git tag is kept.`,
              },
              `Deleted release ${release.tag} from origin.`,
              () => target.api.deleteRelease(release),
            ),
        },
      ]);
    },
  };
}

function point(/** @type {MouseEvent} */ event) {
  const bounds = /** @type {HTMLElement} */ (event.currentTarget).getBoundingClientRect();
  return { x: bounds.left, y: bounds.bottom };
}
