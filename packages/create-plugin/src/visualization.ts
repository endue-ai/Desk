import type { PluginManifest } from "@endue-ai/bridge";
import { checkSection, devSection, heading } from "./readme";
import type { PluginOptions } from "./template";
import { escapeHtml } from "./ui";
import html from "./visualization/index.html?raw";
import controller from "./visualization/plugin.js?raw";
import css from "./visualization/style.css?raw";
import test from "./visualization/test.js?raw";

export function renderVisualization(options: PluginOptions): Record<string, string> {
  const { id, name, description = "A bar chart with editable data." } = options;
  const manifest: PluginManifest = {
    id,
    name,
    description,
    version: "0.1.0",
    kind: "ui",
    entry: "ui/index.html",
    surfaces: [
      {
        id: "main",
        title: name,
        placement: "center",
        window: { size: { width: 760, height: 500 } },
      },
    ],
    contributes: {
      commands: [
        {
          id: `${id}.get-data`,
          title: `${name}: Read chart data`,
          description: "Read the chart's labels and values in display order.",
          agent: true,
          readOnly: true,
        },
        {
          id: `${id}.set-data`,
          title: `${name}: Update chart data`,
          description:
            "Replace the chart rows. Pass labels and nonnegative numeric values in display order.",
          agent: true,
          args: {
            type: "object",
            properties: {
              rows: {
                type: "array",
                maxItems: 100,
                items: {
                  type: "object",
                  properties: {
                    label: { type: "string", minLength: 1, maxLength: 120 },
                    value: { type: "number", minimum: 0 },
                  },
                  required: ["label", "value"],
                  additionalProperties: false,
                },
              },
            },
            required: ["rows"],
            additionalProperties: false,
          },
        },
      ],
    },
  };
  return {
    "plugin.json": `${JSON.stringify(manifest, null, 2)}\n`,
    "README.md": [
      ...heading(options, description),
      ...devSection(
        "To add the plugin to your installed Desk, run `create-plugin install .` and reopen Desk.",
      ),
      "Edit `ui/index.html`, `ui/style.css`, and `ui/plugin.js` to make your visualization.",
      `Use \`${id}.set-data\` with an object containing a \`rows\` array and \`${id}.get-data\` to read it.`,
      "The starter needs no permissions. Connect other data sources through the plugin SDK.",
      "",
      ...checkSection("The test updates the chart through the same command that agents use."),
    ].join("\n"),
    "ui/index.html": html.replaceAll("{{name}}", () => escapeHtml(name)),
    "ui/main.js":
      'import { defineUiPlugin } from "@endue-ai/plugin-sdk";\nimport "@endue-ai/ui";\nimport { plugin } from "./plugin.js";\n\ndefineUiPlugin(plugin);\n',
    "ui/plugin.js": controller,
    "ui/style.css": css,
    "tests/plugin.test.js": test,
  };
}
