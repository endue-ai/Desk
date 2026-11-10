> この文書は[英語版](../../../plugins/authoring.md)の翻訳です。内容に相違がある場合は英語版が優先されます。

# Desk プラグインの作り方

Desk プラグインはひとつのフォルダーです。組み込み機能もまったく同じ形式を使っているため、Desk 自身が画面上で行えることは、どれも自作のプラグインで行えます。このページはプラグインの種類とテンプレートから始め、続いて UI プラグインを詳しく扱い、次にネイティブプラグイン、最後にテーマを扱います。ツール（MCP）プラグインには今後対応します。

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
| `theme` | デザインシステムの値と、それが指すフォントや画像。コードなし（「テーマを作る」、ADR 0056） | `examples/plugin-hello-theme` |

Rust の種類は、その言語自身のコマンドでビルドします。フォルダー内で `wasm32-wasip2` ターゲット向けに `cargo build --release` を実行します（最初に一度 `rustup target add wasm32-wasip2`）。コンポーネントは `plugin.json` の `entry` が指す場所にできます。

開発中のプラグインを Desk 上で確認するには、そのフォルダーを開発用プラグインとして指定して Desk を起動します。

```bash
DESK_DEV_PLUGINS=$PWD/../my-plugin just dev
```

フォルダー内のファイルを保存すると、そのプラグインだけが 1 秒以内にリロードされます。Desk のほかの部分とプラグインの状態は、そのまま保たれます。Desk の起動時に空だった、または壊れていたフォルダーも、ファイルが届くか直された時点で、再起動なしに現れます。

### `desk plugin test` によるテスト

`desk plugin test <folder>` は `validate` と同じようにフォルダーを検査し、その種類に合ったホストで `tests/` を実行します。

- `ui`、`view`、`policy`、`theme`、そのほか Wasm を持たない種類：`tests/*.test.js` または `*.test.ts` を、jsdom のページ内で、SDK のテストホスト（`@endue-ai/plugin-sdk/testing`、後述の「テスト」を参照）上の vitest で実行します。SDK は名前でインポートし、テストするコードはテンプレートと同じく SDK をインポートしない形にしておきます（`ui/plugin.js` と、`defineUiPlugin(plugin)` を呼ぶ `ui/main.js`）。
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

しばらく誰の目にも触れていないサーフェス（他のウィンドウの後ろや画面の外）は、メモリを節約するためにアンロードされることがあり、再び表示されると読み込み直されます（ADR 0070）。元の状態で戻るには、残したいものを登録します。`surface.onUnload(() => ({ open, caret, scroll }))` が Desk の `ui.surface.state` に 64 KiB までの JSON で応え、読み込み直したページは `surface.restored` でそれを受け取ります。プロバイダーがなければ初期状態で戻りますが、上の `state` はそのまま戻ります。

SDK は読み込まれた瞬間から Desk の ping（`desk:ping`）に自分で応えるため、遅い呼び出しを待っていてもハングとは見なされません。5 秒間応答しないフレームのウィンドウには「応答なし」と「待つ」「停止」が表示され、「再読み込み」で最後の `state` とともに戻ります（#39）。

### サーフェスのオリジン

サイトを分離するエンジンがウィンドウごとにプロセスを分けられるよう、サーフェスはそれぞれ専用のオリジンで読み込まれます。macOS と Linux では `desk-plugin://<surface>.<label>/<id>/<path>`、Windows では `http://desk-plugin.<surface>.<label>.localhost/<id>/<path>` です。`<surface>` はサーフェスの `id`（宣言がなければ `main`）、`<label>` はプラグイン ID の `-` をすべて二重にしてから `.` をひとつの `-` にしたもので、`example.my-plugin` は `example-my--plugin` になります。パスは `/<id>/` を保つので、相対 URL、`import.meta.url`、インポートマップの `/_desk/` パス、`fs.url` の URL はこれまでどおり解決されます。自分のオリジンで別のプラグインの ID の下のパスを求めると 403 が返ります（ライブラリ〔ADR 0049〕と、マニフェストの `imports` に挙げたプラグイン〔`"imports": ["endue.eris"]`〕は除く。その場合、そのコードはあなたのプラグインとして動きます）。URL はオリジンからではなく、相対パスから組み立ててください。

## 権限

プラグインのフレームは、スクリプトだけを許可したサンドボックスで動作します。Desk のページにはアクセスできず、トップレベルのナビゲーション、フォームやポップアップ、独自のネットワーク接続も使えません。あらゆる機能はブリッジを経由し、`perm.*` を除くすべてのブリッジ呼び出しには、必要な権限スコープ（`params.scope`）が付きます。コアが応答するのは、そのスコープをカバーする権限をユーザーが付与している場合だけです。

1. 要求する可能性のあるものは、すべて `plugin.json` の `permissions` で宣言します。
2. 必要になったその時点で要求します：`bridge.call("perm.request", { permission, reason })`。
3. 各呼び出しでは、対応するスコープをできるだけ狭くして渡します。

語彙（`fs:read`、`fs:write`、`proc:spawn`、`net:fetch`、`audio:capture`、`ui:surface`、`ui:notify`、`plugin:manage`、`brain:converse`、`cmd:invoke`、`cmd:advise`、`settings:read`、`log:read`、`events:subscribe`、`perm:manage`、`data:read`、`connector:manage`、`view:manage`）は `specs/plugin/v0/README.md` にあります。

## 自分のプロセスと自分のオリジン

いまはすべてのプラグインのフレームが、Desk のひとつのページとひとつのプロセスを共有しています。Desk は Chromium への移行を進めており、そこでは各サーフェスが自分のプロセスで動きます（ADR 0140）。プラグインのコードは何も変わりません。マニフェスト、インポートマップ、`@endue-ai/plugin-sdk`、ブリッジ、CSP はこのページの説明どおりです。

* 各サーフェスは `desk-plugin` スキーム上に自分のオリジンを持ちます。プラグインごとではなく、サーフェスごとです。自分のファイルは相対 URL で読み込み、ホストを決め打ちしないでください。残したいものは `localStorage` や IndexedDB ではなく `state` か `store.*` に置きます。ひとつのプラグインの 2 つのウィンドウは、それらを共有しません。
* プラグインのループ、リーク、クラッシュが影響するのは、そのウィンドウだけです。しばらく見えていなかったウィンドウはスリープすることがあり、`surface.onUnload` が残したものと一緒に戻ります（ADR 0142）。
* WebGPU（`navigator.gpu`）は、エンジンが Chromium になればすべての OS で使えます。いまは Linux の WebKitGTK にはなく、macOS ではバージョン 26 が必要なので、有無を確かめてフォールバックしてください。
* ワーカー、WebAssembly、`fs.url` の URL に対する `Range` 付きの `fetch` は、これまでどおり動きます（ADR 0048）。

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

## エージェント向けのコマンド

endue AI のエージェントやローカルの頭脳は、人が実行するのと同じコマンドでデスクを操作します（ADR
0088）。コマンドに `agent` を付け、何をするか、何を受け取り何を返すかを書いてください。コアはすべての呼び出しの
引数を `args` で検査し、コマンドを `cmd.tools` に載せ、デスクの頭脳ターンで ID に因んだ名前のツール
（`example_my-plugin_notes`）として提示します。

```json
"commands": [
  {
    "id": "example.my-plugin.notes",
    "title": "Notes: list",
    "description": "The notes in a folder, newest first: name, path and when each changed.",
    "args": { "type": "object", "properties": { "folder": { "type": "string" } }, "additionalProperties": false },
    "result": { "type": "array", "items": { "type": "object" } },
    "agent": true,
    "readOnly": true
  },
  { "id": "example.my-plugin.publish", "title": "Notes: publish", "description": "Publish a note to the web.", "agent": true, "irreversible": true }
]
```

`readOnly` は、そのコマンドがデータを返すだけで、人が持つものを何も変えないことを示します。コマンドは
エージェントではなくプラグインの権限で動くので、プログラムを実行するもの、送信・削除・公開するものには
`irreversible` を付けてください。エージェントの呼び出しは、引数を見せたうえで人の承認を待ちます。パレットから
引数なしで実行されるときに欠ける引数は必須にせず、ハンドラーで検査してください。実行時に登録するコマンドは
`cmd.register` で同じ項目（`description`、`argsSchema`、`resultSchema`、`agent`、`readOnly`）を
受け取り、`ctx.commands.tools()` は自分の権限が及ぶエージェント向けコマンドを一覧します。組み込みの git、
terminal、docker、calendar、database プラグインが例です。

## ファイルの編集: 編集ティア

ファイルを開くプラグインは、まず読み、編集は後から加えます（ADR 0045）。編集するようになったら、開くすべての
形式に、読み取りティアと並んで、三つのうちひとつの編集ティアを持たせます（ADR 0071）。

| 編集ティア | 約束すること | 保存するとき |
| --- | --- | --- |
| `lossless` | 変更していないファイルを保存すると同じバイトになり、編集は変えるべきバイトだけを変える | ファイルを上書きする |
| `text` | 内容は残るが、書式（コメント、空白、キーの順序）は残らないことがある | 各ファイルの最初の保存で "Save as copy"（既定）か "Overwrite" かを尋ねる |
| `read-only` | 何も保存しない | `desk.files.save` を断る |

すべての形式のティアを、README（形式ごとの読み取りティアと編集ティアの表）と、最初の編集より前のサーフェスに
示します。サーフェスでは `@endue-ai/ui` の `desk-edit-tier` 要素を使います。ティアを挙げていない形式は
`read-only` で、完全な読み取りティアで開けなかったファイルも同じです。実際より少なく約束するのは構いませんが、
多く約束してはいけません。要素の `label` と `detail` 属性には自分の言葉を入れられます。

```html
<desk-edit-tier tier="lossless" format="CSV"></desk-edit-tier>   <!-- CSV · Lossless editing -->
```

`lossless` はバイトについての約束なので、`@endue-ai/plugin-sdk/testing` の二つのチェックで証明します。
フィクスチャには、その形式の難しいところを含めます: BOM、CRLF と混在した改行、末尾の改行なし、引用符と
エスケープ。

```ts
import { assertMinimalEdit, assertRoundTrip } from "@endue-ai/plugin-sdk/testing";

const model = assertRoundTrip(bytes, parse, serialize); // serialize(parse(bytes)) must be bytes
setCell(model, "B2", "Busan");                           // B2 held "Seoul"
assertMinimalEdit(bytes, serialize(model), { find: "Seoul", bytes: "Busan" });
```

`parse` は `Uint8Array` を受け取り、文字列は UTF-8 として扱われます。スパンは、ファイルのバイト単位の
`{ offset, length }`、またはそのバイト列がただ一度だけ現れる場所を示す `{ find }` です。`bytes` はそのスパンが
何になるべきかを示し、省略するとスパンは何になっても構いません。失敗すると、最初に異なるバイトとその行と列、
前後の 16 進とテキスト、スパンの外の変更を示します。チェックは何も import しないので、素の Node のテストからも
`packages/plugin-sdk/src/testing/round-trip.ts` をパスで import できます。

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

### ユニバーサルビュー

ユニバーサルビュー（`specs/view/v0/universal.schema.json`、ADR 0087）は、ひとつの YAML 形式、つまりユニバーサル
データ形式を返す出所なら何からでもエントリーを受け取り、タイムライン、カレンダー、カンバン、リスト、テキスト、
チャット、エージェントの実行として表示します。ビューはデータとして持ち、`ctx.universal` で開きます。出所は
インラインのデータ、プラグインのフォルダーのファイル（`asset`、権限は不要）、URL（`net:fetch`）、デスクのファイル
（`fs:read`）、ほかのプラグインのコマンド、デスクのアイテムのどれでもよく、ビューは変わりません。

```js
const board = ctx.universal.open(document.getElementById("root"), {
  type: "kanban",
  types: ["kanban", "list", "timeline", "calendar"],
  source: { asset: "data/board.yaml" },
  map: { group: "column", start: "due" },
  move: { command: "example.board.move", args: { id: "{id}", to: "{move.to}" } },
});
```

描画するのは `@endue-ai/ui` の `<desk-universal-view>` です。`ctx.universal.load(source)` と
`ctx.universal.parse(text)` はドキュメントそのものを返します。自分のプラグインがなくても、
`desk.universal.open` コマンドで開けます。いちばん小さな例は `examples/plugin-hello-universal` です。

## プラグイン間のドラッグ＆ドロップ

プラグインは `ctx.dnd` で互いに *デスクデータ* をドラッグします（ADR 0119）。すべてのドラッグはデスクが仲介します。ドラッグ画像をすべてのフレームの上に描き、ポインターの下にあるフレームにドラッグを提示し、項目はドロップされたフレームにだけ渡します。

| 型 | 項目 |
| --- | --- |
| `desk/paths` | `{ paths: [{ path, kind? }] }`：絶対ブリッジパス。ソースが知っていれば `kind` は `file` か `folder` |
| `desk/text` | `{ text }` |
| `desk/uri` | `{ uri, title? }` |
| `desk/json` | `{ kind, value }`。`desk/json:<kind>` 型として提示されます（例：`desk/json:db/rows`） |
| `text/plain` | `{ text }`：ドラッグが提示しないときにデスクが加える代替テキスト |

```js
// ソース：ポインターが DRAG_THRESHOLD を超えて動いてから行がドラッグされるので、クリックはクリックのままです。
ctx.dnd.draggable(list, {
  item: (target) => {
    const row = target.closest("li");
    return row && { items: [{ type: "desk/paths", paths: [{ path: row.dataset.path, kind: "file" }] }] };
  },
});

// ターゲット：受け取る型を示すとその型だけを受け取り、実行した効果を返します。
ctx.dnd.onDrop(document, async (drop) => {
  for (const { path } of drop.paths ?? []) await open(path);
  return "link";
}, { accept: ["desk/paths", "text/plain"] });
```

* `startDrag({ items, effectAllowed, image })` は自分で扱うポインターからドラッグを始め、終わると `{ effect, to }` で解決します。
* ドラッグがターゲットの上にある間、ドロップ先の要素には CSS 用の `data-desk-drop="copy|move|link"` が付きます。
* `options.at(element)` がその要素を、`options.effect(over)` が効果を選びます。既定では Alt でコピー、Mod で移動、両方でリンクです。
* ドラッグのどの型も受け取らないフレームは、そのドラッグを知りません。
* OS からドラッグしたファイルは `os` からの `desk/paths` として届き、コピーとリンクが許可されます。

ドロップが渡すのはパスとデータであって、アクセス権ではありません。ドロップされたパスは自分の権限で `fs.read` を呼んで読み、権限が及ばなければ `perm.request` で求めてください。

テストには `createTestHost` の `host.dnd` を使います。

* `host.dnd.drop({ items, over })` はデスクと同じようにターゲットへ項目を提示し、効果で解決します。
* `host.dnd.release()` はプラグインが始めたドラッグをそのプラグインの上にドロップします。
* `host.dnd.drags` はプラグインが始めたドラッグの一覧です。

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

## ネイティブプラグイン

ネイティブプラグイン（種類 `native`）は、どの言語で書いてもよい自作のプログラムで、Desk がそれ自身のプロセスとして起動します（ADR 0154）。好きな GPU API でウィンドウを描き、デスクと共有するテクスチャに収め、UI プラグインと同じブリッジを呼び出します。デスクのコンポジターがほかのウィンドウと同じようにそのウィンドウを描き（ADR 0156）、`just example plugin-native-wgpu` がサンプルをビルドしてデスクで実行します。

```json
{
  "id": "example.my-native",
  "version": "0.1.0",
  "kind": "native",
  "native": {
    "binaries": {
      "macos-aarch64": "bin/macos-aarch64/my-native",
      "linux-x86_64": "bin/linux-x86_64/my-native"
    },
    "args": [],
    "graceMs": 2000
  },
  "permissions": [{ "permission": "ui:notify" }],
  "surfaces": [{ "id": "main", "title": "My native plugin", "placement": "center" }]
}
```

* `native.binaries` は、Rust の呼び方による `<os>-<arch>`（`macos-aarch64`、`linux-x86_64`、`windows-x86_64` など）ごとに、フォルダー内のプログラムを指定します。自分のプラットフォーム用のプログラムがないデスクはプラグインを読み込まず、プラグイン一覧にその理由を表示します。`entry` はありません。
* **起動。** ウィンドウが開くか目覚めると、デスクはプラグインのフォルダーでプログラムを実行します。環境変数は、デスクが用意した 2 本の接続を示します。サーフェスプロトコル（`specs/surface/v0`）を話す `DESK_SURFACE_FD` と、`desk.sock` と同じ形式でブリッジを使う `DESK_BRIDGE_FD` です。macOS では、IOSurface の Mach 権限を送る先の `DESK_SURFACE_MACH_SERVICE` もあります。
* **フレーム。** デスクは論理ピクセルでのサイズとディスプレイの倍率を添えて `create` を送ります。プラグインは `desk:hello` を返し、IOSurface（macOS）に描いて、変わった部分とともにフレームごとに `attach` し、デスクがそのフレームの `release` を送ってから次を描きます。`resize`、`show` と `hide`、`pace`、ポインターとキーは、ウィンドウ自身の座標で届きます。
* **フォーカス。** Tab は Web ページと同じようにプラグインの中を移動します。Tab または Shift+Tab がそのウィンドウに届くと、デスクは `edge: first` または `last` を付けて `focus.enter` を送ります。Tab がプラグインの最初または最後の部分を出るとき、プラグインはその端を付けて `focus.leave` を送り、キーはデスクに戻ります。Rust では `native::focus::FocusOrder` が部分を Tab の順に保ち、`Plugin::leave_focus` がそれを送ります。
* **ブリッジ。** どの呼び出しも、ほかのプラグインと同じく、マニフェストの権限と利用者の許可で確かめられます。デスクはプラグインが名乗る名前ではなく、自分が渡した接続でプラグインを見分けます。
* **固まったとき、終了、スリープ。** 描画ループの中で、`desk:ping` のたびに `desk:pong` を返してください。5 秒間応答のないプラグインには「応答なし」が表示され、「待つ」と「停止」を選べます。ウィンドウが生きている間にプロセスが終わると、それは終了扱いになり、ウィンドウがそれを知らせて一度だけ読み込み直します。`sleep`（ウィンドウがライブ予算から外れた）は、状態を残して（`desk:state`、または `ui.surface.state` への応答）終了するよう求めるもので、`wake` はプログラムを再び起動し、`desk:init` がその状態を返します。求められてから `graceMs` たっても終わらないプロセスは、デスクが強制終了します。
* **サンドボックスなし。** ネイティブプラグインは利用者として、その人のファイルとネットワークにアクセスできる状態で動きます。確かめられるのはブリッジの呼び出しだけです。信頼できるネイティブプラグインだけをインストールしてください。

Rust では、`native-wgpu` 機能を有効にした `desk-surface` が通信を引き受けます。`native::plugin::Plugin` は接続し、デスクからのメッセージを受け取り（ping にも応え）、フレームを送ります。`native::bridge::Bridge::call` はブリッジを呼び出し、`native::iosurface::SharedTexture` は IOSurface を wgpu のテクスチャとして扱います。`examples/plugin-native-wgpu` は、wgpu のシーン、ひとつのブリッジ呼び出し（自分の設定の `settings.get`）、スリープをまたいで保たれる状態をそなえた完全なプラグインです。ネイティブプラグインのフレームは現在 macOS でデスクに届き、Linux（DMA-BUF）と Windows（D3D11 共有ハンドル）は追って対応します（#61）。

## テーマを作る

テーマは kind が `theme` のプラグインです。デザインシステムの値と、その値が指すフォント・画像ファイルだけを持ち、コードを持たないため、権限を要求しません（ADR 0056、ADR 0057）。テンプレートか例から始めます。

```bash
pnpm --filter @endue-ai/create-plugin build                       # once
node packages/create-plugin/dist/create-plugin.js ../my-theme --kind theme
DESK_DEV_PLUGINS=$PWD/../my-theme just dev
cargo run -p desk-cli -- theme apply local.my-theme
```

パッケージが公開されれば、これは `pnpm create @endue-ai/plugin my-theme --kind theme` になります。テンプレートには両方の scheme のすべての役割色、既定値のままのほかのレイヤー、それぞれが何を塗るかを説明する README が入っています。`examples/plugin-hello-theme` は、フォントとバックドロップをひとつずつ持つ最小のテーマです。テーマはインストールしても適用されません。適用中のテーマは設定 `desk.theme.active` が指し、テーマスタジオ（右上のパレットボタン、またはコマンドパレットの Themes）、`desk.theme.use`、`desk theme apply` で選びます。

スタジオでもテーマを作れます。「Tune a copy」（または `desk.theme.edit`）は選んだテーマのコピーで、「New theme」は endue のテーマでエディターを開きます。フォントやバックドロップの画像も含め、すべてのレイヤーに操作部品があり、デスク全体が変わっていく下書きをそのまま映し、ゲートの補正はパレットの下に並び、Save で自分のテーマ（`local.<名前>`）として保存します。テーマをリポジトリに置き、テストし、公開するにはフォルダーを使います。

### theme ブロック

`plugin.json` は kind `theme` と `theme` ブロック（`specs/plugin/v0/theme.schema.json`）を持ち、`entry`、`permissions`、`surfaces`、`contributes`、`autoload` は持ちません。

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

`author`、`license`（テーマとそのファイルの SPDX ライセンス式）、`tags`、`preview`（ギャラリーのカードに使う最大 5 色）、`origin`（テーマを言い表した文と、出発点のテーマ）がテーマを説明します。`light` と `dark` はそれぞれひとつの scheme を持ちます。テーマにはどちらかが必要で、ないほうはデスク自身のテーマが代わりを務めます。

### レイヤーとプリセット

レイヤーは 6 つあり、どれにも既定値があるので、パレットだけでもテーマになります。

| レイヤー | キー | 値 |
| --- | --- | --- |
| パレット | `<scheme>.colors` | トークン名（camelCase）から CSS の色へ：`docs/design-system.md` の役割、シェルと Eris のトークン。省いた役割はデスクの値のまま |
| マテリアル | `<scheme>.material` | `opacity` 0.6–1、`blur` 0–24 px、`noise` 0–0.15、`border` 0–2 px、`shadow` none・soft・strong |
| タイポグラフィ | `type` | `sans` と `mono` のフォントスタック、`scale` 0.85–1.25、`tracking` −0.02–0.05 em、`fonts` |
| 形 | `shape` | `radius` none・subtle・soft・round、`density` compact・comfortable・spacious |
| モーション | `motion` | `personality` snappy・smooth・calm |
| バックドロップ | `<scheme>.backdrop` | `color`、`angle` の向きに描く 2–4 色の `gradient`、または `fit` が cover か tile の `image`。それに `glow` |

`<scheme>.terminal.ansi` はターミナルの 16 色を、`<scheme>.contrast` はハイコントラストでのパレットの変更を決めます。角丸、密度、モーション、文字サイズの倍率、影はプリセットです。ランタイムが名前をトークンに変えるので（`docs/design-system.md` の「Choosing a theme」）、デスクがプリセットを調整し直してもテーマはそのまま動きます。数値には範囲があり、値に `url()` は入らないので、有効なテーマは常に使える状態に保たれます。

### ゲート

デスクは適用するすべてのテーマをゲート（`@endue-ai/ui/theme`）に通します。文字は地に対して 4.5:1、枠線と塗りは 3:1、ハイコントラストでは 7:1 と 4.5:1 に達する必要があります。足りない前景色は OKLCH の明度だけを、比率に届く分だけ動かし、地の色は変えません。`contrast` パレットがなければ、テーマのハイコントラストも同じ方法で自身の色から導かれます。ゲートが直すものがないよう、両方の scheme で色の組を確かめてください。

### アセットと上限

フォントは `.woff2`、画像は `.png`、`.jpg`、`.webp` のファイルで（スクリプトを含みうる SVG は使えません）、フォルダーの中に置き、1 ファイル 2 MiB、合計 8 MiB までです。フォントのライセンスは `license` に書き、ライセンスファイルをそばに置きます。組み込みテーマは `fonts/OFL.txt` と、配布元とチェックサムを記した `fonts/SOURCE.md` を置いています。デスクはテーマのフォントをシェルとすべてのプラグインフレームに `FontFace` として読み込み、バックドロップはシェルだけが描きます。

### テーマのテスト

```bash
cargo run -p desk-cli -- plugin validate ../my-theme
cargo run -p desk-cli -- plugin test ../my-theme
```

`desk plugin validate` はブロックをスキーマと、ファイルを上限と照らし合わせます。`desk plugin test` はテンプレートの `tests/theme.test.ts` を SDK のテストホスト上の vitest で実行します。このテストは、デスクがテーマを適用する前と同じく、両方の scheme を `compileTheme` でコンパイルして endue のパレットの上で `gate` にかけ、ゲートが直すものがあればそのすべてを示して失敗します。

### `.desk-theme` で共有する

```bash
cargo run -p desk-cli -- theme export local.my-theme     # local.my-theme.desk-theme in Downloads
cargo run -p desk-cli -- theme import ~/Downloads/dusk.desk-theme
```

`.desk-theme` はひとつの JSON ファイルです。`format` は `desk-theme/1`、`manifest` はテーマの `plugin.json`、`files` はブロックが指すファイルの base64 で、16 MiB までです（ADR 0058）。読み込むとテーマプラグインとして検査され、利用者のテーマフォルダーにインストールされます。id が `local.` と `market.` の外にあれば `local.<名前>` になります。`desk theme list` で一覧でき、`desk theme remove` で削除できます。スタジオの Export と Import も同じことを行い、スタジオにドロップした `.desk-theme` も受け付けます。

### マーケット

スタジオの Market タブは、設定 `desk.theme.markets` が各インデックスの https URL で挙げるマーケットのテーマを一覧します（ADR 0060）。既定はこのリポジトリの `main` にある `market/themes/index.json` で、`https://raw.githubusercontent.com/endue-ai/Desk/main/market/themes/index.json` から読みます。ほかのマーケットのインデックスは `init.yaml` でその後ろに加えます。ふたつのマーケットが同じ id を載せていれば、先のマーケットが優先されます。

```yaml
settings:
  desk.theme.markets:
    - https://raw.githubusercontent.com/endue-ai/Desk/main/market/themes/index.json
    - https://themes.example.com/index.json
```

カードにはテーマのプレビュー色、名前、作者、ライセンスと、このデスクでの状態（Available、Installed、Update available、Edited）が表示されます。Preview は `.desk-theme` をダウンロードして sha256 を確かめ、インストールせずにデスク全体に表示します。Install は URL と sha256 を渡す `theme.import` で、`market.` 以下の id のまま取り込み、Apply でそのテーマが使われます。アップデートが置き換えるのは、あなたが手を加えていないマーケットのテーマだけです。手を加えたテーマはあなたのものとして残ります。

テーマを公開するには、バンドルとインデックスの項目を `market/themes/` に加えるプルリクエストを開きます。

1. テーマをエクスポートします（`desk theme export <id> <file>`、またはスタジオの Export）。id は `market.` 以下にし、バージョン、`theme.author`、`theme.license`（フォントと画像も含む SPDX 式）を付けます。
2. ファイルを `market/themes/` に `<name>.desk-theme` として置き、`index.json`（`specs/plugin/v0/theme-index.schema.json`）に項目を加えます。`id`、`name`、`version`、`description`、`author`、`license`、`tags`、最大 5 色の `preview`、`url`（ファイル名）、`sha256`、`size` です。
3. `node scripts/theme-market.mjs` を実行します。`just check` に含まれるこのマーケットチェッカーは、ハッシュやサイズの不一致、ライセンスの欠落、重複した id、正しいテーマプラグインでないバンドルを拒否します。マーケットのテーマはすべて、テストが両方の scheme でゲートにかけます。

アップデートは新しいバージョンと、その新しいバンドル、sha256、サイズです。同じ手順が `market/themes/README.md` にもあります。
