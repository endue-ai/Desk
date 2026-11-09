# Accessibility

`accessibility.schema.json`. Screen readers see the desk as one tree. Each surface exports its own
accessibility tree in the shape of AccessKit's `TreeUpdate` (a web surface's host builds it from the
engine's accessibility events); the compositor grafts every surface's tree under its window's node in
the desk's tree and feeds AccessKit, which speaks NSAccessibility, UI Automation and AT-SPI.

## Messages

| Message | Way | Holds | Means |
| --- | --- | --- | --- |
| `a11y.enable` | compositor → surface | `enabled` | Start or stop exporting the tree. |
| `a11y.update` | surface → compositor | `tree?`, `nodes`, `focus` | Nodes that are new or changed, and the focused node. |
| `a11y.action` | compositor → surface | `node`, `action`, `value?` | A screen reader asks a node to do something. |

## Tree updates

`a11y.update` is AccessKit's `TreeUpdate` as JSON:

| Field | AccessKit | Rule |
| --- | --- | --- |
| `tree` | `tree: Option<Tree>` | `{ root }`: in the first update and whenever the root changes |
| `nodes` | `nodes: Vec<(NodeId, Node)>` | Each node whole; nodes left out stay as they were; a node no longer reachable from the root is gone |
| `focus` | `focus: NodeId` | The focused node: the root when nothing inside has focus |

A node (`SurfaceA11yNode`) has an `id` (unique in the surface, stable while the node lives; the
compositor makes it unique across surfaces), a `role` (AccessKit's `Role` in kebab-case: `button`,
`text-input`, `check-box`, `root-web-area`; a reader maps one it does not know to `unknown`), and,
when they apply: `name` (AccessKit's label), `description`, `value`, `placeholder`, `url`, `bounds`
(logical pixels in the surface), `children` (ids, in order), `actions`, `toggled` (`true`, `false`,
`mixed`), `expanded`, `selected`, `disabled`, `level`, and `numericValue` with `minNumericValue` and
`maxNumericValue`. The set grows with AccessKit's properties as screen readers need them; v0 holds
what a plugin's ordinary controls use.

## Rules

- **Only when asked.** A surface exports nothing until `a11y.enable { enabled: true }`, which the
  compositor sends while an assistive technology is active (AccessKit's activation), so surfaces pay
  nothing otherwise. The first update after it carries `tree` and every node; later ones only what
  changed. `enabled: false` stops it.
- **Bounds go through the window.** The compositor maps `bounds` through the window's transform to
  the screen, so VoiceOver's cursor sits on the right pixels of a moved, scaled or tilted window.
- **Actions.** `a11y.action` names a node and one of `click`, `focus`, `blur`, `collapse`, `expand`,
  `increment`, `decrement`, `scroll-into-view`, `set-value` (with `value`) and `show-context-menu`. A
  node lists what it supports in `actions`. The surface does it as a person's input would, and its next
  update shows the result.
- **A sleeping or dead surface** keeps its last tree in the compositor, marked unavailable, so the
  person can still find the window and wake it.
