> 이 문서는 [영문판](../../../plugins/authoring.md)을 옮긴 번역본이며, 내용이 다르면 영문판이 우선합니다.

# Desk 플러그인 작성하기

Desk 플러그인은 폴더 하나입니다. 내장 기능도 똑같은 형식을 쓰므로, Desk 자신이 화면에서 하는 일은 무엇이든
직접 만든 플러그인도 할 수 있습니다. 이 문서는 플러그인의 종류와 템플릿에서 시작해, UI 플러그인을 자세히
다룹니다. 도구(MCP) 플러그인은 나중에 추가됩니다.

## 템플릿에서 시작하기

`create-plugin`은 한 종류의 플러그인 폴더를 만듭니다. 이 폴더는 `desk plugin validate`를 통과하고 테스트를
하나 갖고 있습니다(패키지가 배포되면 `pnpm create @endue-ai/plugin`).

```bash
pnpm --filter @endue-ai/create-plugin build
node packages/create-plugin/dist/create-plugin.js ../my-plugin --kind ui
cargo run -p desk-cli -- plugin validate ../my-plugin
cargo run -p desk-cli -- plugin test ../my-plugin
```

| 종류 | 무엇인가 | 예제 |
| --- | --- | --- |
| `ui` | 샌드박스 프레임 안의 페이지, SDK 위에서 동작(이 문서의 나머지 부분) | `examples/plugin-hello-ui` |
| `logic` | Rust로 작성한 `desk:host` 월드의 Wasm 컴포넌트(ADR 0019) | `examples/plugin-hello-wasm` |
| `connector` | 항목을 가져오는 `desk:connector` 월드의 Wasm 컴포넌트(ADR 0034) | `examples/plugin-hello-connector` |
| `view` | 데이터로 된 뷰: 무엇을, 어느 소스에서 보여 줄지. 코드 없음(ADR 0032) | `examples/plugin-hello-view` |
| `policy` | 데이터로 된 명령, 키와 그 밖의 기여. 코드 없음(ADR 0017) | `plugins/`의 `desk.*` 정책 |

Rust 종류는 언어 자체의 명령으로 빌드합니다. 폴더에서 `wasm32-wasip2` 타깃으로 `cargo build --release`를
실행합니다(처음 한 번 `rustup target add wasm32-wasip2`). 컴포넌트는 `plugin.json`의 `entry`가 가리키는
곳에 만들어집니다.

작업 중인 플러그인을 Desk에서 보려면, 그 폴더를 개발용 플러그인으로 지정해 Desk를 실행합니다.

```bash
DESK_DEV_PLUGINS=$PWD/../my-plugin just dev
```

폴더 안의 파일을 저장하면 해당 플러그인만 1초 안에 다시 로드됩니다. Desk의 나머지 부분과 플러그인의 상태는
그대로 유지됩니다. Desk가 시작할 때 비어 있거나 깨져 있던 폴더도 파일이 들어오거나 고쳐지는 즉시, 다시
시작하지 않아도 나타납니다.

### `desk plugin test`로 테스트하기

`desk plugin test <folder>`는 `validate`처럼 폴더를 검사한 뒤, 종류에 맞는 호스트에서 `tests/`를 실행합니다.

- `ui`, `view`, `policy`와 Wasm이 없는 나머지 종류: `tests/*.test.js` 또는 `*.test.ts`를 jsdom 페이지
  안에서 SDK의 테스트 호스트(`@endue-ai/plugin-sdk/testing`, 아래 "테스트" 참고) 위의 vitest로 실행합니다.
  SDK는 이름으로 가져오고, 테스트하는 코드는 템플릿처럼 SDK를 가져오지 않게 둡니다(`ui/plugin.js`,
  그리고 `defineUiPlugin(plugin)`을 부르는 `ui/main.js`).
- `logic`과 Wasm `connector`: 각 `tests/<name>.test.json`을 빌드된 컴포넌트로, 스크립트로 된 데스크인
  `desk-plugin-host` 하네스 위에서 실행합니다.

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

`steps`는 데스크가 하는 일입니다. 로직 플러그인에는 `start`, `command`(`id`, `args`), `event`(`name`,
`data`)가, 커넥터에는 `connect`(`instance`, `settings`)와 `sync`(`instance`)가 있습니다. 플러그인이 하는
임포트 호출은 하나하나 브리지 호출 `{ method, params }`(`fs.read { path }`,
`cmd.answer { invocationId, result }`)로 기록되고, `answers` 가운데 `method`가 같고 호출이 그 `params`를
포함하는 첫 항목이 `result`나 `error`(`{ "code": "not_found", "message": "…" }`)로 응답합니다. 아무것도
응답하지 않는 호출은 빈 응답을 받습니다. 없음, `null`, `[]` 또는 새 id이며, `store.get`은 플러그인이 저장한
값을 돌려주고, 파일과 네트워크는 `not_found`와 `unsupported`로 응답합니다. `expect.calls`의 호출은 그
순서대로 일어났어야 하고, 커넥터의 `expect.items`는 동기화가 가져온 항목 가운데 있어야 합니다. 각각은 적힌
내용을 포함하면 일치합니다. 실패하면 기대한 것과 대신 일어난 것을 보여 줍니다.

## 폴더 구성

| 경로 | 필수 여부 | 용도 |
| --- | --- | --- |
| `plugin.json` | 예 | 매니페스트: id, version, kind, entry, permissions, surfaces |
| `ui/index.html` | 예 (`entry`) | Desk가 샌드박스 프레임에 로드하는 페이지 |
| `ui/*.js`, `ui/*.css` | 아니요 | 플러그인 코드와 스타일. 엔트리 기준 상대 경로로 로드됩니다 |
| `README.md` | 권장 | 플러그인이 하는 일, 요청하는 권한과 그 이유 |

매니페스트는 `specs/plugin/v0/plugin.schema.json`을 따릅니다.

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

id는 소문자로 쓰고 역도메인 형식을 따릅니다(`example.my-plugin`). 엔트리는 폴더 안에 있어야 합니다.

## SDK

엔트리 페이지에서 import map으로 SDK를 가져옵니다. Desk는 SDK를 `/_desk/plugin-sdk.js`에서 제공합니다.

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

`bridge.call(method, params)`는 코어를 호출합니다. 같은 틱에 이루어진 호출은 하나의 메시지로 묶여 전달됩니다.
거부된 호출은 `BridgeCallError`로 reject되며, 이때 `code`는 예를 들어 `permission_denied`입니다.

## 권한

플러그인 프레임은 스크립트만 허용된 샌드박스에서 실행됩니다. Desk 페이지에 접근할 수 없고, 최상위 내비게이션도,
폼이나 팝업도, 자체 네트워크 연결도 쓸 수 없습니다. 모든 기능은 브리지를 거치며, `perm.*` 이외의 모든 브리지
호출에는 그 호출에 필요한 권한 범위(`params.scope`)가 담깁니다. 코어는 사용자가 그 범위를 포함하는 권한을
부여했을 때만 응답합니다.

1. 요청할 수 있는 것은 모두 `plugin.json`의 `permissions`에 선언합니다.
2. 필요한 그 시점에 요청합니다: `bridge.call("perm.request", { permission, reason })`.
3. 호출할 때마다 그에 맞는 범위를 최대한 좁게 넘깁니다.

어휘(`fs:read`, `fs:write`, `proc:spawn`, `net:fetch`, `audio:capture`, `ui:surface`,
`ui:notify`, `plugin:manage`, `brain:converse`, `cmd:invoke`, `cmd:advise`, `settings:read`, `log:read`,
`events:subscribe`, `perm:manage`, `data:read`, `connector:manage`, `view:manage`)는 `specs/plugin/v0/README.md`에 있습니다.

## 기여 항목

플러그인은 `plugin.json` 의 `contributes` 로 코드 없이 데스크의 기본 정책에 더할 수 있습니다(ADR 0017).
팔레트에 나오고 키로 실행되는 커맨드, 키 바인딩, 배치 규칙, 그 플러그인이 여는 파일, 테마, 기본값이 있는
설정, 프로필입니다. 커맨드, 설정, 테마의 id 는 플러그인 id 로 시작합니다.

```json
"contributes": {
  "commands": [{ "id": "example.my-plugin.new", "title": "New note" }],
  "keys": [{ "key": "Mod+Shift+N", "command": "example.my-plugin.new" }],
  "display": [{ "match": { "plugin": "example.my-plugin" }, "area": "right", "size": { "pixels": 360 } }],
  "files": [{ "pattern": "*.md", "plugin": "example.my-plugin" }],
  "settings": { "example.my-plugin.folder": { "kind": "string", "default": "~/notes" } }
}
```

자기 커맨드에는 `ctx.commands.on` 으로 답하고, 데스크에 있는 어떤 커맨드든 `ctx.commands.run` 으로
실행합니다. 둘 다 코어의 커맨드 레지스트리(`cmd.*`)를 거칩니다. 자기가 제공하지 않는 커맨드를 실행하려면
그 id 를 덮는 `cmd:invoke` 권한이 있어야 합니다. 예: `{ "permission": "cmd:invoke", "ids": ["desk.theme.*"] }`.

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

파일을 여는 플러그인은 `desk.files.visit`, `desk.files.save`, `desk.files.revert` 에 답하고, 저장하지 않은
변경은 `desk.buffers.update { id, modified: true }` 로 알립니다. 테마는 프레임에 `--desk-*` CSS 속성과
`ctx.theme` 으로 전달됩니다. 프레임 안에서 누른 키 조합은 `preventDefault()` 를 부르지 않는 한 데스크의
키맵에 전달됩니다. 기본 정책과 각각이 정하는 것은 `plugins/README.md` 에 있습니다.

## 아이템과 뷰

사람이 연결한 앱의 내용은 하나의 모양을 가진 아이템으로 데스크에 들어옵니다(`specs/item/v0`, ADR 0032).
일정, 할 일, 메시지, 노트 등이 어느 소스에서 오든 같은 모양입니다. `ctx.data`는 `data:read` 권한으로
데스크의 색인을 읽고, 쿼리에 필요한 가장 좁은 범위를 넘깁니다. `ctx.views`는 `view:manage`로 그 사람의
뷰를 읽고 저장합니다.

```js
const { items } = await ctx.data.query({
  kinds: ["task"],
  where: [{ field: "due", op: "lt", value: "2026-10-31T00:00:00+09:00" }],
});
const stop = await ctx.data.subscribe({ kinds: ["task"] }, (changes) => redraw(changes));
await ctx.commands.run("desk.views.open", { id: "desk.today" });
```

뷰는 코드가 아니라 데이터입니다(`specs/view/v0`). 내장 플러그인 `desk.views`가 `@endue-ai/ui` 요소
(`desk-list`, `desk-table`, `desk-agenda`, `desk-stat`, `desk-markdown`, `desk-card`)로 그리고, 템플릿은
시계를 압니다(`{today}`, `{tomorrow}`). 앱이 이 요소들을 제공하게 되면 여러분의 페이지도 import map
(`"@endue-ai/ui": "/_desk/ui.js"`)으로 같은 요소를 불러올 수 있습니다. 지금은 런타임의 테스트 서버가
제공합니다.

## 테스트

`@endue-ai/plugin-sdk/testing`을 쓰면 브라우저 없이 모의 브리지를 상대로 플러그인을 실행할 수 있습니다.

```ts
import { defineUiPlugin } from "@endue-ai/plugin-sdk";
import { createTestHost } from "@endue-ai/plugin-sdk/testing";

const host = createTestHost({ pluginId: "example.my-plugin", handlers: { "perm.query": () => ({ grants: [] }) } });
await defineUiPlugin(myPlugin, host.transport);
await host.settle();
// host.calls, host.state, host.emit(event), host.upsert(item)
```

공개하기 전에 `desk plugin validate <folder>`를 통과해야 합니다. CI는 `plugins/`와 `examples/` 안의 모든 폴더에
대해 이 명령을 실행합니다.
