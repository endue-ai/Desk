> この文書は[英語版](../../../plugins/authoring.md)の翻訳です。内容に相違がある場合は英語版が優先されます。

# Desk プラグインの作り方

Desk プラグインはひとつのフォルダーです。組み込み機能もまったく同じ形式を使っているため、Desk 自身が画面上で行えることは、どれも自作のプラグインで行えます。このページはプラグインの種類とテンプレートから始め、続いて UI プラグインを詳しく扱います。ツール（MCP）プラグインには今後対応します。

## テンプレートから始める

`create-plugin` は、`desk plugin validate` を通過し、テストをひとつ持つ、いずれかの種類のプラグインフォルダーを作ります（パッケージの公開後は `pnpm create @endue-ai/plugin`）。

```bash
pnpm --filter @endue-ai/create-plugin build
node packages/create-plugin/dist/create-plugin.js ../my-plugin --kind ui
cargo run -p desk-cli -- plugin validate ../my-plugin
cargo run -p desk-cli -- plugin test ../my-plugin
```

| 種類 | 内容 | 例 |
| --- | --- | --- |
| `ui` | サンドボックス化されたフレーム内のページ。SDK の上で動きます（このページの以降の部分） | `examples/plugin-hello-ui` |
| `logic` | Rust で書いた `desk:host` ワールドの Wasm コンポーネント（ADR 0019） | `examples/plugin-hello-wasm` |
| `connector` | アイテムを取り込む `desk:connector` ワールドの Wasm コンポーネント（ADR 0034） | `examples/plugin-hello-connector` |
| `view` | データとしてのビュー。何を、どのソースから表示するか。コードなし（ADR 0032） | `examples/plugin-hello-view` |
| `policy` | データとしてのコマンド、キー、その他のコントリビューション。コードなし（ADR 0017） | `plugins/` の `desk.*` ポリシー |

Rust の種類は、その言語自身のコマンドでビルドします。フォルダー内で `wasm32-wasip2` ターゲット向けに `cargo build --release` を実行します（最初に一度 `rustup target add wasm32-wasip2`）。コンポーネントは `plugin.json` の `entry` が指す場所にできます。

開発中のプラグインを Desk 上で確認するには、そのフォルダーを開発用プラグインとして指定して Desk を起動します。

```bash
DESK_DEV_PLUGINS=$PWD/../my-plugin just dev
```

フォルダー内のファイルを保存すると、そのプラグインだけが 1 秒以内にリロードされます。Desk のほかの部分とプラグインの状態は、そのまま保たれます。Desk の起動時に空だった、または壊れていたフォルダーも、ファイルが届くか直された時点で、再起動なしに現れます。

### `desk plugin test` によるテスト

`desk plugin test <folder>` は `validate` と同じようにフォルダーを検査し、その種類に合ったホストで `tests/` を実行します。

- `ui`、`view`、`policy`、そのほか Wasm を持たない種類：`tests/*.test.js` または `*.test.ts` を、jsdom のページ内で、SDK のテストホスト（`@endue-ai/plugin-sdk/testing`、後述の「テスト」を参照）上の vitest で実行します。SDK は名前でインポートし、テストするコードはテンプレートと同じく SDK をインポートしない形にしておきます（`ui/plugin.js` と、`defineUiPlugin(plugin)` を呼ぶ `ui/main.js`）。
- `logic` と Wasm の `connector`：各 `tests/<name>.test.json` を、ビルド済みのコンポーネントで、スクリプト化されたデスクである `desk-plugin-host` のハーネス上で実行します。

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

`steps` はデスクが行うことです。ロジックプラグインでは `start`、`command`（`id`、`args`）、`event`（`name`、`data`）、コネクターでは `connect`（`instance`、`settings`）と `sync`（`instance`）です。プラグインが行うインポートの呼び出しは、それぞれブリッジ呼び出し `{ method, params }`（`fs.read { path }`、`cmd.answer { invocationId, result }`）として記録され、`answers` のうち `method` が一致し、呼び出しがその `params` を含む最初の項目が、`result` または `error`（`{ "code": "not_found", "message": "…" }`）で応答します。どれも応答しない呼び出しは空の応答を受け取ります。何もなし、`null`、`[]`、または新しい id で、`store.get` はプラグインが保存した値を返し、ファイルとネットワークは `not_found` と `unsupported` を返します。`expect.calls` の呼び出しはその順序で行われていなければならず、コネクターの `expect.items` は同期が取り込んだアイテムの中になければなりません。いずれも、書かれた内容を含んでいれば一致とみなします。失敗すると、期待したものと、代わりに起きたことが示されます。

## フォルダー

| パス | 必須 | 用途 |
| --- | --- | --- |
| `plugin.json` | はい | マニフェスト。id、version、kind、entry、permissions、surfaces を記述します |
| `ui/index.html` | はい（`entry`） | Desk がサンドボックス化されたフレームに読み込むページ |
| `ui/*.js`、`ui/*.css` | いいえ | プラグインのコードとスタイル。エントリーからの相対パスで読み込まれます |
| `README.md` | 推奨 | プラグインが何をするのか、どの権限をなぜ求めるのか |

マニフェストは `specs/plugin/v0/plugin.schema.json` に従います。

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

id は小文字の逆ドメイン形式です（`example.my-plugin`）。エントリーはフォルダーの中に置きます。

## SDK

SDK は、エントリーページのインポートマップを通してインポートします。Desk は SDK を `/_desk/plugin-sdk.js` で配信しています。

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

`bridge.call(method, params)` でコアを呼び出します。同じティック内に行った呼び出しは、ひとつのメッセージにまとめて送られます。拒否された呼び出しは、`permission_denied` などの `code` を持つ `BridgeCallError` で reject されます。

## 権限

プラグインのフレームは、スクリプトだけを許可したサンドボックスで動作します。Desk のページにはアクセスできず、トップレベルのナビゲーション、フォームやポップアップ、独自のネットワーク接続も使えません。あらゆる機能はブリッジを経由し、`perm.*` を除くすべてのブリッジ呼び出しには、必要な権限スコープ（`params.scope`）が付きます。コアが応答するのは、そのスコープをカバーする権限をユーザーが付与している場合だけです。

1. 要求する可能性のあるものは、すべて `plugin.json` の `permissions` で宣言します。
2. 必要になったその時点で要求します：`bridge.call("perm.request", { permission, reason })`。
3. 各呼び出しでは、対応するスコープをできるだけ狭くして渡します。

語彙（`fs:read`、`fs:write`、`proc:spawn`、`net:fetch`、`audio:capture`、`ui:surface`、`ui:notify`、`plugin:manage`、`brain:converse`、`cmd:invoke`、`cmd:advise`、`settings:read`、`log:read`、`events:subscribe`、`perm:manage`、`data:read`、`connector:manage`、`view:manage`）は `specs/plugin/v0/README.md` にあります。

## コントリビューション

プラグインは `plugin.json` の `contributes` で、コードなしにデスクの既定ポリシーへ追加できます（ADR
0017）。パレットに並びキーで実行されるコマンド、キーバインド、表示ルール、開けるファイル、テーマ、既定値付きの
設定、プロファイルです。コマンド、設定、テーマの ID はプラグインの ID で始めます。

```json
"contributes": {
  "commands": [{ "id": "example.my-plugin.new", "title": "New note" }],
  "keys": [{ "key": "Mod+Shift+N", "command": "example.my-plugin.new" }],
  "display": [{ "match": { "plugin": "example.my-plugin" }, "area": "right", "size": { "pixels": 360 } }],
  "files": [{ "pattern": "*.md", "plugin": "example.my-plugin" }],
  "settings": { "example.my-plugin.folder": { "kind": "string", "default": "~/notes" } }
}
```

自分のコマンドには `ctx.commands.on` で答え、デスクにある任意のコマンドは `ctx.commands.run` で実行します。
どちらもコアのコマンドレジストリ（`cmd.*`）を通ります。自分が提供していないコマンドを実行するには、その ID を
含む `cmd:invoke` 権限が必要です（例: `{ "permission": "cmd:invoke", "ids": ["desk.theme.*"] }`）。

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

ファイルを開くプラグインは `desk.files.visit`、`desk.files.save`、`desk.files.revert` に答え、未保存の変更を
`desk.buffers.update { id, modified: true }` で知らせます。テーマはフレームに `--desk-*` の CSS プロパティと
`ctx.theme` として届きます。フレーム内で押したキーの組み合わせは、`preventDefault()` を呼ばない限りデスクの
キーマップに届きます。既定ポリシーとそれぞれが決めることは `plugins/README.md` にあります。

## アイテムとビュー

人が接続したアプリの中身は、ひとつの形のアイテムとしてデスクに届きます（`specs/item/v0`、ADR 0032）。
イベント、タスク、メッセージ、ノートなどが、どのソースからでも同じ形です。`ctx.data` は `data:read`
権限のもとでデスクのインデックスを読み、クエリに必要な最も狭いスコープを渡します。`ctx.views` は
`view:manage` のもとで、その人のビューを読み書きします。

```js
const { items } = await ctx.data.query({
  kinds: ["task"],
  where: [{ field: "due", op: "lt", value: "2026-10-31T00:00:00+09:00" }],
});
const stop = await ctx.data.subscribe({ kinds: ["task"] }, (changes) => redraw(changes));
await ctx.commands.run("desk.views.open", { id: "desk.today" });
```

ビューはコードではなくデータです（`specs/view/v0`）。組み込みの `desk.views` が `@endue-ai/ui` の要素
（`desk-list`、`desk-table`、`desk-agenda`、`desk-stat`、`desk-markdown`、`desk-card`）で描き、テンプレートは
時計を知っています（`{today}`、`{tomorrow}`）。アプリがこれらの要素を配信するようになれば、あなたのページも
インポートマップ（`"@endue-ai/ui": "/_desk/ui.js"`）で同じ要素を読み込めます。現在はランタイムのテスト
サーバーが配信しています。

## テスト

`@endue-ai/plugin-sdk/testing` を使うと、ブラウザーを使わずに、モックのブリッジを相手にプラグインを実行できます。

```ts
import { defineUiPlugin } from "@endue-ai/plugin-sdk";
import { createTestHost } from "@endue-ai/plugin-sdk/testing";

const host = createTestHost({ pluginId: "example.my-plugin", handlers: { "perm.query": () => ({ grants: [] }) } });
await defineUiPlugin(myPlugin, host.transport);
await host.settle();
// host.calls, host.state, host.emit(event), host.upsert(item)
```

公開する前に、`desk plugin validate <folder>` が通る必要があります。CI は `plugins/` と `examples/` 内のすべてのフォルダーに対してこれを実行します。
