> 本文为中文译文，内容以[英文原版](../../../plugins/authoring.md)为准。

# 编写 Desk 插件

Desk 插件就是一个目录。内置功能使用完全相同的格式，因此 Desk 自身能在屏幕上做的任何事，你的插件也都能做到。本文先介绍插件的种类及其模板，再详细介绍 UI 插件，最后介绍主题；工具（MCP）插件将在之后推出。

## 从模板开始

`create-plugin` 会生成一个某种类型的插件目录，它能通过 `desk plugin validate`，并带有一个测试（包发布后可使用 `pnpm create @endue-ai/plugin`）：

```bash
pnpm --filter @endue-ai/create-plugin build
node packages/create-plugin/dist/create-plugin.js ../my-plugin --kind ui
cargo run -p desk-cli -- plugin validate ../my-plugin
cargo run -p desk-cli -- plugin test ../my-plugin
```

| 种类 | 是什么 | 示例 |
| --- | --- | --- |
| `ui` | 沙箱框架中的页面，基于 SDK（本文其余部分） | `examples/plugin-hello-ui` |
| `logic` | 用 Rust 编写的 `desk:host` world 的 Wasm 组件（ADR 0019） | `examples/plugin-hello-wasm` |
| `connector` | 导入条目的 `desk:connector` world 的 Wasm 组件（ADR 0034） | `examples/plugin-hello-connector` |
| `view` | 以数据表示的视图：显示什么、来自哪些来源；没有代码（ADR 0032） | `examples/plugin-hello-view` |
| `policy` | 以数据表示的命令、按键和其他贡献；没有代码（ADR 0017） | `plugins/` 中的 `desk.*` 策略 |
| `theme` | 设计系统的取值，以及它们引用的字体和图片；没有代码（见“制作主题”，ADR 0056） | `examples/plugin-hello-theme` |

Rust 类型的插件用该语言自己的命令构建：在目录中针对 `wasm32-wasip2` 目标运行 `cargo build --release`（首次需执行一次 `rustup target add wasm32-wasip2`）。组件会生成在 `plugin.json` 的 `entry` 所指的位置。

如果想在开发插件的同时在 Desk 上看到它，请将你的目录作为开发插件来运行 Desk：

```bash
DESK_DEV_PLUGINS=$PWD/../my-plugin just dev
```

保存目录中的任意文件后，只有你的插件会在一秒内重新加载。Desk 的其余部分以及插件的状态都保持原样。Desk 启动时为空或已损坏的目录，在文件到达或被修复后也会立即出现，无需重启。

### 用 `desk plugin test` 测试

`desk plugin test <folder>` 会像 `validate` 一样检查目录，然后在与其种类相符的宿主上运行 `tests/`：

- `ui`、`view`、`policy`、`theme` 以及其他不含 Wasm 的种类：在 jsdom 页面中，用 SDK 测试宿主（`@endue-ai/plugin-sdk/testing`，见下文“测试”）上的 vitest 运行 `tests/*.test.js` 或 `*.test.ts`。按名称导入 SDK，并像模板那样让被测试的代码不导入 SDK（`ui/plugin.js`，由 `ui/main.js` 调用 `defineUiPlugin(plugin)`）。
- `logic` 和 Wasm `connector`：使用构建好的组件，在脚本化的 desk，即 `desk-plugin-host` 测试工具上运行每个 `tests/<name>.test.json`：

```json
{
  "steps": ["start", { "command": { "id": "example.my-logic.greet", "args": { "name": "Ada" } } }],
  "answers": [{ "method": "settings.get", "params": { "key": "greeting" }, "result": "Hi" }],
  "expect": {
    "calls": [
      { "method": "cmd.register", "params": { "id": "example.my-logic.greet" } },
      { "method": "cmd.answer", "params": { "result": "Hi, Ada!" } }
    ]
  }
}
```

`steps` 是 desk 所做的事：逻辑插件有 `start`、`command`（`id`、`args`）和 `event`（`name`、`data`），连接器有 `connect`（`instance`、`settings`）和 `sync`（`instance`）。插件发出的每个导入调用都会记录为一个桥接调用 `{ method, params }`（`fs.read { path }`、`cmd.answer { invocationId, result }`），并由 `answers` 中第一个 `method` 相同、且调用包含其 `params` 的条目应答：返回 `result`，或返回 `error`（`{ "code": "not_found", "message": "…" }`）。没有条目应答的调用会得到空应答：无内容、`null`、`[]` 或新的 id；`store.get` 返回插件存入的值；文件和网络返回 `not_found` 和 `unsupported`。`expect.calls` 中的调用必须按该顺序发生过，连接器的 `expect.items` 必须在其同步带来的条目之中；只要包含所写的内容即视为匹配。失败时会指出期望的内容，并列出实际发生的内容。

## 目录

| 路径 | 是否必需 | 用途 |
| --- | --- | --- |
| `plugin.json` | 是 | 清单：id、version、kind、entry、permissions、surfaces |
| `ui/index.html` | 是（即 `entry`） | Desk 加载到沙箱框架中的页面 |
| `ui/*.js`、`ui/*.css` | 否 | 你的代码和样式，相对于入口加载 |
| `README.md` | 建议 | 插件的作用、申请哪些权限以及原因 |

清单遵循 `specs/plugin/v0/plugin.schema.json`：

```json
{
  "id": "example.my-plugin",
  "version": "0.1.0",
  "kind": "ui",
  "entry": "ui/index.html",
  "permissions": [{ "permission": "fs:read", "paths": ["~/Documents/**"] }],
  "surfaces": [{ "id": "main", "title": "My plugin", "placement": "center" }]
}
```

id 使用小写的反向域名格式（`example.my-plugin`）。入口须位于目录之内。

## SDK

在入口页面中通过 import map 导入 SDK；Desk 在 `/_desk/plugin-sdk.js` 提供它：

```html
<script type="importmap">
  { "imports": { "@endue-ai/plugin-sdk": "/_desk/plugin-sdk.js" } }
</script>
<script type="module" src="./main.js"></script>
```

```js
import { defineUiPlugin } from "@endue-ai/plugin-sdk";

defineUiPlugin({
  async mount({ pluginId, bridge, state }) {
    const saved = state.get() ?? { count: 0 };   // survives reloads of this surface
    state.set({ count: saved.count + 1 });
    const { grants } = await bridge.call("perm.query", {});
    bridge.onEvent((event) => console.log(event.event));
  },
});
```

`bridge.call(method, params)` 用于调用核心。在同一个 tick 内发出的调用会合并成一条消息发送。被拒绝的调用会以 `BridgeCallError` 被 reject，其 `code` 例如为 `permission_denied`。

## 权限

你的框架运行在只允许脚本的沙箱中：不能访问 Desk 的页面，不能进行顶层导航，不能使用表单或弹出窗口，也不能自行建立网络连接。每项能力都要经过桥接层，除 `perm.*` 之外的每次桥接调用都携带它所需的权限范围（`params.scope`）。只有当用户授予了覆盖该范围的权限时，核心才会响应。

1. 在 `plugin.json` 的 `permissions` 中声明所有可能申请的内容。
2. 在需要的那一刻再申请：`bridge.call("perm.request", { permission, reason })`。
3. 每次调用都传入相应的范围，并尽可能缩小。

词汇表（`fs:read`、`fs:write`、`proc:spawn`、`net:fetch`、`audio:capture`、`ui:surface`、`ui:notify`、`plugin:manage`、`brain:converse`、`cmd:invoke`、`cmd:advise`、`settings:read`、`log:read`、`events:subscribe`、`perm:manage`、`data:read`、`connector:manage`、`view:manage`）见 `specs/plugin/v0/README.md`。

## 贡献项

插件可以在 `plugin.json` 的 `contributes` 中，不写代码就为桌面的默认策略添加内容（ADR 0017）：命令面板
列出、按键运行的命令，按键绑定，显示规则，它能打开的文件，主题，带默认值的设置，以及配置档。命令、设置和
主题的 ID 以插件 ID 开头。

```json
"contributes": {
  "commands": [{ "id": "example.my-plugin.new", "title": "New note" }],
  "keys": [{ "key": "Mod+Shift+N", "command": "example.my-plugin.new" }],
  "display": [{ "match": { "plugin": "example.my-plugin" }, "area": "right", "size": { "pixels": 360 } }],
  "files": [{ "pattern": "*.md", "plugin": "example.my-plugin" }],
  "settings": { "example.my-plugin.folder": { "kind": "string", "default": "~/notes" } }
}
```

用 `ctx.commands.on` 回答自己的命令，用 `ctx.commands.run` 运行桌面上的任何命令。两者都经过核心的命令
注册表（`cmd.*`）；运行不是自己提供的命令，需要覆盖其 ID 的 `cmd:invoke` 权限，例如
`{ "permission": "cmd:invoke", "ids": ["desk.theme.*"] }`：

```js
defineUiPlugin({
  mount(ctx) {
    ctx.commands.on("example.my-plugin.new", async () => "note-1");      // the answer
    ctx.commands.on("desk.files.visit", ({ buffer, path }) => { /* fs.read it, show it */ });
    ctx.commands.on("desk.files.save", ({ buffer, path }) => { /* fs.write it */ });
    document.querySelector("button").onclick = () => ctx.commands.run("desk.theme.toggle");
  },
});
```

打开文件的插件回答 `desk.files.visit`、`desk.files.save` 和 `desk.files.revert`，并用
`desk.buffers.update { id, modified: true }` 标记未保存的修改。主题以 `--desk-*` CSS 属性和 `ctx.theme`
传到你的框架。在框架里按下的组合键会传到桌面的按键映射，除非你调用了 `preventDefault()`。默认策略及其各自
决定的内容见 `plugins/README.md`。

## 编辑文件：编辑层级

打开文件的插件先读、后编辑（ADR 0045）。一旦开始编辑，它打开的每种格式除了读取层级，还有一个编辑层级，
三者取一（ADR 0071）：

| 编辑层级 | 承诺什么 | 保存时 |
| --- | --- | --- |
| `lossless` | 保存未修改的文件得到相同的字节，编辑只改变必须改变的字节 | 覆盖文件 |
| `text` | 内容会保留，格式（注释、空白、键的顺序）可能不会 | 每个文件第一次保存时询问："Save as copy"（默认）或 "Overwrite" |
| `read-only` | 什么也不保存 | 拒绝 `desk.files.save` |

在 README（列出各格式及其读取层级和编辑层级的表格）中，以及在第一次编辑之前的界面上，说明每种格式的层级；
界面上用 `@endue-ai/ui` 的 `desk-edit-tier` 元素。没有说明层级的格式是 `read-only`，未能以完整读取层级
打开的文件也是。可以少承诺，不能多承诺。元素的 `label` 和 `detail` 属性可以换成你自己的文字。

```html
<desk-edit-tier tier="lossless" format="CSV"></desk-edit-tier>   <!-- CSV · Lossless editing -->
```

`lossless` 是关于字节的承诺，所以要用 `@endue-ai/plugin-sdk/testing` 中的两个检查来证明，测试夹具要包含
该格式的各种边角情况：BOM、CRLF 和混合换行、没有末尾换行、引号和转义。

```ts
import { assertMinimalEdit, assertRoundTrip } from "@endue-ai/plugin-sdk/testing";

const model = assertRoundTrip(bytes, parse, serialize); // serialize(parse(bytes)) must be bytes
setCell(model, "B2", "Busan");                           // B2 held "Seoul"
assertMinimalEdit(bytes, serialize(model), { find: "Seoul", bytes: "Busan" });
```

`parse` 收到的是 `Uint8Array`；字符串按 UTF-8 处理。片段是文件中以字节计的 `{ offset, length }`，或者
`{ find }`，即这些字节唯一出现的位置；`bytes` 说明它必须变成什么，省略时片段可以变成任何内容。失败时会
指出第一个不同的字节及其行和列、周围的十六进制和文本，以及片段之外的改动。这些检查不导入任何东西，所以普通的
Node 测试也可以按路径导入 `packages/plugin-sdk/src/testing/round-trip.ts`。

## 条目与视图

人们连接的应用中的内容，以同一种形状的条目进入桌面（`specs/item/v0`，ADR 0032）：事件、任务、消息、笔记等，
无论来自哪个来源都一样。`ctx.data` 在 `data:read` 权限下读取桌面的索引，并传入查询所需的最窄范围；
`ctx.views` 在 `view:manage` 下读取和保存用户的视图：

```js
const { items } = await ctx.data.query({
  kinds: ["task"],
  where: [{ field: "due", op: "lt", value: "2026-10-31T00:00:00+09:00" }],
});
const stop = await ctx.data.subscribe({ kinds: ["task"] }, (changes) => redraw(changes));
await ctx.commands.run("desk.views.open", { id: "desk.today" });
```

视图是数据，而不是代码（`specs/view/v0`）：内置的 `desk.views` 用 `@endue-ai/ui` 的元素（`desk-list`、
`desk-table`、`desk-agenda`、`desk-stat`、`desk-markdown`、`desk-card`）绘制它，模板知道时钟（`{today}`、
`{tomorrow}`）。等应用开始提供这些元素后，你的页面也可以通过导入映射（`"@endue-ai/ui": "/_desk/ui.js"`）
引入同样的元素；目前由运行时的测试服务器提供。

## 测试

`@endue-ai/plugin-sdk/testing` 无需浏览器即可运行你的插件，并以模拟的桥接层作为对端：

```ts
import { defineUiPlugin } from "@endue-ai/plugin-sdk";
import { createTestHost } from "@endue-ai/plugin-sdk/testing";

const host = createTestHost({ pluginId: "example.my-plugin", handlers: { "perm.query": () => ({ grants: [] }) } });
await defineUiPlugin(myPlugin, host.transport);
await host.settle();
// host.calls, host.state, host.emit(event), host.upsert(item)
```

发布之前，必须通过 `desk plugin validate <folder>`；CI 会对 `plugins/` 和 `examples/` 中的每个目录运行该命令。

## 制作主题

主题是 kind 为 `theme` 的插件：只有设计系统的取值以及这些取值引用的字体和图片文件，没有代码，因此不申请任何权限（ADR 0056、ADR 0057）。从模板或示例开始：

```bash
pnpm --filter @endue-ai/create-plugin build                       # once
node packages/create-plugin/dist/create-plugin.js ../my-theme --kind theme
DESK_DEV_PLUGINS=$PWD/../my-theme just dev
cargo run -p desk-cli -- theme apply local.my-theme
```

包发布之后，这一步就是 `pnpm create @endue-ai/plugin my-theme --kind theme`。模板包含两种 scheme 下的全部角色颜色、保持默认值的其余各层，以及说明每个值涂在哪里的 README；`examples/plugin-hello-theme` 是带一个字体和一个背景的最小主题。安装主题并不会应用它：当前生效的主题由设置 `desk.theme.active` 指定，可以在主题工作室（右上角的调色板按钮，或命令面板中的 Themes）、通过 `desk.theme.use` 或 `desk theme apply` 选择。

主题工作室也能制作主题：“Tune a copy”（或 `desk.theme.edit`）以所选主题的副本打开编辑器，“New theme”则以 endue 主题打开。每一层都有对应的控件，包括字体和背景图片；整个桌面随草稿实时变化，门禁的修正列在调色板下方，Save 会把结果保存为你自己的主题（`local.<名称>`）。要把主题放进仓库、测试并发布，就用目录。

### theme 块

`plugin.json` 的 kind 为 `theme`，并带有 `theme` 块（`specs/plugin/v0/theme.schema.json`），没有 `entry`、`permissions`、`surfaces`、`contributes` 和 `autoload`：

```json
{
  "id": "example.dusk",
  "name": "Dusk",
  "version": "0.1.0",
  "kind": "theme",
  "theme": {
    "license": "Apache-2.0 AND OFL-1.1",
    "type": {
      "sans": "\"Space Grotesk\", system-ui, sans-serif",
      "fonts": [{ "family": "Space Grotesk", "src": "fonts/space-grotesk.woff2", "weight": "300 700" }]
    },
    "shape": { "radius": "round" },
    "dark": {
      "colors": { "background": "#1a1412", "text": "#f6ede6", "primary": "#ff9a62", "primaryForeground": "#2a1206" },
      "backdrop": { "gradient": ["#2e1c15", "#1a1412"], "glow": "rgba(255, 140, 80, 0.12)" }
    }
  }
}
```

`author`、`license`（主题及其文件的 SPDX 许可证表达式）、`tags`、`preview`（画廊卡片上最多五种颜色）和 `origin`（描述主题的那句话及其起点主题）用来描述主题。`light` 和 `dark` 各自包含一种 scheme。主题至少需要其中之一，缺少的一方由桌面自己的主题代替。

### 层与预设

主题共六层，每层都有默认值，所以只有调色板也是一个完整的主题：

| 层 | 键 | 取值 |
| --- | --- | --- |
| 调色板 | `<scheme>.colors` | 令牌名（camelCase）到 CSS 颜色：`docs/design-system.md` 中的角色，以及外壳和 Eris 的令牌。省略的角色保持桌面的值 |
| 材质 | `<scheme>.material` | `opacity` 0.6–1、`blur` 0–24 px、`noise` 0–0.15、`border` 0–2 px、`shadow` none、soft 或 strong |
| 字体排印 | `type` | `sans` 与 `mono` 字体栈、`scale` 0.85–1.25、`tracking` −0.02–0.05 em、`fonts` |
| 形状 | `shape` | `radius` none、subtle、soft 或 round；`density` compact、comfortable 或 spacious |
| 动效 | `motion` | `personality` snappy、smooth 或 calm |
| 背景 | `<scheme>.backdrop` | `color`，按 `angle` 绘制的 2–4 色 `gradient`，或 `fit` 为 cover 或 tile 的 `image`；以及 `glow` |

`<scheme>.terminal.ansi` 为终端提供十六种颜色，`<scheme>.contrast` 给出高对比度下调色板的变化。圆角、密度、动效、字号倍率和阴影都是预设：运行时把每个名称转换成令牌（`docs/design-system.md` 的“Choosing a theme”），因此桌面重新调校预设时主题依然可用。数值都有范围，取值中不能出现 `url()`，所以任何有效的主题都始终可用。

### 门禁

桌面会让它应用的每个主题都通过门禁（`@endue-ai/ui/theme`）：文字相对背景须达到 4.5:1，边框和填充 3:1，高对比度下分别为 7:1 和 4.5:1。达不到的前景色只调整其 OKLCH 明度，且只调到刚好达标；背景色从不改变。没有 `contrast` 调色板时，主题的高对比度也用同样的方法从它自己的颜色推导出来。请在两种 scheme 下检查颜色对，让门禁无需修正。

### 资源与限制

字体为 `.woff2`，图片为 `.png`、`.jpg` 或 `.webp`（不允许可能携带脚本的 SVG），须位于目录内：单个文件最多 2 MiB，合计 8 MiB。在 `license` 中写明字体的许可证，并把许可证文件放在字体旁边；内置主题保留 `fonts/OFL.txt`，以及记录上游地址和校验和的 `fonts/SOURCE.md`。桌面在外壳和每个插件框架中以 `FontFace` 加载主题的字体；背景只由外壳绘制。

### 测试主题

```bash
cargo run -p desk-cli -- plugin validate ../my-theme
cargo run -p desk-cli -- plugin test ../my-theme
```

`desk plugin validate` 按模式检查主题块，按限制检查文件。`desk plugin test` 在 SDK 测试宿主上用 vitest 运行模板中的 `tests/theme.test.ts`：它像桌面应用主题前那样，用 `compileTheme` 编译两种 scheme，并在 endue 调色板之上用 `gate` 检查；只要门禁需要修正，测试就失败并列出每一处修正。

### 以 `.desk-theme` 分享

```bash
cargo run -p desk-cli -- theme export local.my-theme     # local.my-theme.desk-theme in Downloads
cargo run -p desk-cli -- theme import ~/Downloads/dusk.desk-theme
```

`.desk-theme` 是一个 JSON 文件：`format` 为 `desk-theme/1`，`manifest` 是主题的 `plugin.json`，`files` 是主题块引用的文件的 base64，最大 16 MiB（ADR 0058）。导入时会先按主题插件检查，再安装到用户的主题目录，id 不在 `local.` 或 `market.` 之下时改为 `local.<名称>`；`desk theme list` 可以列出它，`desk theme remove` 可以删除它。主题工作室的 Export 和 Import 做同样的事，也接受拖放到工作室上的 `.desk-theme`。

### 市场

主题工作室的 Market 标签页列出设置 `desk.theme.markets` 以各索引的 https URL 列出的市场中的主题（ADR 0060）。默认是本仓库 `main` 分支上的 `market/themes/index.json`，从 `https://raw.githubusercontent.com/endue-ai/Desk/main/market/themes/index.json` 读取。其他市场的索引可以在 `init.yaml` 中加在它之后；两个市场列出同一个 id 时，以排在前面的为准：

```yaml
settings:
  desk.theme.markets:
    - https://raw.githubusercontent.com/endue-ai/Desk/main/market/themes/index.json
    - https://themes.example.com/index.json
```

每张卡片显示主题的预览颜色、名称、作者和许可证，以及它在这台桌面上的状态：Available、Installed、Update available 或 Edited。Preview 会下载 `.desk-theme`、校验其 sha256，并在不安装的情况下把它显示在整个桌面上。Install 通过带 URL 和 sha256 的 `theme.import` 把它装入，id 仍在 `market.` 之下；Apply 让它生效。更新只会替换你没有改动过的市场主题；你改过的主题会保留为你自己的。

要发布主题，请提交一个拉取请求，把它的包和索引条目加入 `market/themes/`：

1. 导出主题（`desk theme export <id> <file>`，或工作室中的 Export），使用 `market.` 之下的 id，并设置版本、`theme.author` 和 `theme.license`（也涵盖其字体和图片的 SPDX 表达式）。
2. 把文件以 `<name>.desk-theme` 放进 `market/themes/`，并在 `index.json`（`specs/plugin/v0/theme-index.schema.json`）中加入它的条目：`id`、`name`、`version`、`description`、`author`、`license`、`tags`、最多五个 `preview` 颜色、`url`（文件名）、`sha256` 和 `size`。
3. 运行 `node scripts/theme-market.mjs`。这个市场检查器属于 `just check`，会拒绝哈希或大小不符、缺少许可证、id 重复以及不是有效主题插件的包；另有测试在两种 scheme 下用门禁检查每个市场主题。

更新就是一个新版本，附带新的包、sha256 和大小。`market/themes/README.md` 中有同样的步骤。
