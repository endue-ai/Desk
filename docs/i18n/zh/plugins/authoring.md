> 本文为中文译文，内容以[英文原版](../../../plugins/authoring.md)为准。

# 编写 Desk 插件

Desk 插件就是一个目录。内置功能使用完全相同的格式，因此 Desk 自身能在屏幕上做的任何事，你的插件也都能做到。本文介绍 UI 插件（v0）；逻辑（Wasm）插件和工具（MCP）插件将在之后推出。

## 从示例开始

```bash
cp -R examples/plugin-hello-ui ../my-plugin      # then change the id in plugin.json
cargo run -p desk-cli -- plugin validate ../my-plugin
```

如果想在开发插件的同时在 Desk 上看到它，请将你的目录作为开发插件来运行 Desk：

```bash
DESK_DEV_PLUGINS=$PWD/../my-plugin just dev
```

保存目录中的任意文件后，只有你的插件界面会在一秒内重新加载。Desk 的其余部分以及插件的状态都保持原样。

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
