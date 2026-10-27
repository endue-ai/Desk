# plugins

endue's built-in features, written as plugins in exactly the same folder format as community plugins. If
there were two formats, the API would have holes.

| Plugin | Role |
| --- | --- |
| `eris/` | The secretary (assets are under the `brand/` licence) |
| `sidebar/` | Left bar: agents and spaces |
| `toolbar/` | Right status panel: the drawer list |
| `dock/` | Bottom dock |
| `modes/` | Switch and save modes |
| `onboarding/` | First-run scenario |

Every plugin folder holds `plugin.json`, `README.md`, and as needed `ui/`, `logic/`, `tool/` and `tests/`.

Status: `sidebar`, `eris` and `onboarding` are working UI plugins; the others are folders only.
`just dev` installs every folder here that has a `plugin.json` as a built-in plugin.
