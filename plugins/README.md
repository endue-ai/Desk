# plugins

endue's built-in features, written as plugins in exactly the same folder format as community plugins. If
there were two formats, the API would have holes.

| Plugin | Role |
| --- | --- |
| `eris/` | The secretary (assets are under the `brand/` licence) |
| `sidebar/` | Left bar: agents and spaces |
| `toolbar/` | Right status panel: the drawer list (plugins, access) |
| `dock/` | Bottom dock: open and put away the plugins that open on the desk |
| `modes/` | Switch and save modes |
| `onboarding/` | First-run scenario |

Every plugin folder holds `plugin.json`, `README.md`, and as needed `ui/`, `logic/`, `tool/` and `tests/`.

Status: `sidebar`, `eris`, `onboarding`, `toolbar` and `dock` are working UI plugins; `modes` is a folder
only. The runtime puts `left`, `right` and `bottom` surfaces on the desk's edges.
`just dev` installs every folder here that has a `plugin.json` as a built-in plugin.
