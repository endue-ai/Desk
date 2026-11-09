> 이 문서는 [영문판](../../../plugins/authoring.md)을 옮긴 번역본이며, 내용이 다르면 영문판이 우선합니다.

# Desk 플러그인 작성하기

Desk 플러그인은 폴더 하나입니다. 내장 기능도 똑같은 형식을 쓰므로, Desk 자신이 화면에서 하는 일은 무엇이든
직접 만든 플러그인도 할 수 있습니다. 이 문서는 플러그인의 종류와 템플릿에서 시작해, UI 플러그인을 자세히
다루고 마지막으로 테마를 다룹니다. 도구(MCP) 플러그인은 나중에 추가됩니다.

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
| `theme` | 디자인 시스템의 값과, 그 값이 가리키는 폰트와 이미지. 코드 없음("테마 만들기", ADR 0056) | `examples/plugin-hello-theme` |

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

- `ui`, `view`, `policy`, `theme`과 Wasm이 없는 나머지 종류: `tests/*.test.js` 또는 `*.test.ts`를 jsdom 페이지
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

한동안 아무도 보지 않은 서피스(다른 창 뒤나 화면 밖)는 메모리를 아끼려고 언로드될 수 있고, 다시
보이면 다시 로드됩니다(ADR 0070). 원래대로 돌아오려면 남길 것을 등록하세요.
`surface.onUnload(() => ({ open, caret, scroll }))`가 데스크의 `ui.surface.state`에 64 KiB까지의 JSON으로
답하고, 다시 로드된 페이지는 `surface.restored`에서 그것을 받습니다. 제공자가 없으면 처음 상태로
돌아오며, 위의 `state`는 그대로 돌아옵니다.

### 서피스의 오리진

사이트를 격리하는 엔진이 창마다 프로세스를 따로 줄 수 있도록, 서피스는 저마다 자기 오리진에서
로드됩니다. macOS와 Linux에서는 `desk-plugin://<surface>.<label>/<id>/<path>`, Windows에서는
`http://desk-plugin.<surface>.<label>.localhost/<id>/<path>`입니다. `<surface>`는 서피스의 `id`(선언이
없으면 `main`)이고, `<label>`은 플러그인 id의 `-`를 모두 두 번 쓴 뒤 `.`를 하나의 `-`로 바꾼 것이라
`example.my-plugin`은 `example-my--plugin`이 됩니다. 경로는 `/<id>/`를 그대로 두므로 상대 URL,
`import.meta.url`, 임포트 맵의 `/_desk/` 경로, `fs.url`의 URL은 전과 같이 풀립니다. 자기 오리진에서 다른
플러그인 id 아래의 경로를 요청하면 403이 돌아옵니다. 라이브러리(ADR 0049)와 매니페스트의 `imports`에 적은
플러그인(`"imports": ["endue.eris"]`)은 예외이며, 그 코드는 여러분의 플러그인으로 실행됩니다. URL은 오리진이
아니라 상대 경로로 만드세요.

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

## 자기 프로세스와 자기 origin

지금은 모든 플러그인 프레임이 Desk의 한 페이지와 한 프로세스를 나눠 씁니다. Desk는 Chromium으로 옮겨 가는
중이며, 거기서는 표면마다 자기 프로세스에서 돕니다(ADR 0140). 플러그인 코드는 바뀌지 않습니다. 매니페스트,
import map, `@endue-ai/plugin-sdk`, 브리지와 CSP는 이 문서가 설명하는 그대로입니다.

* 표면마다 `desk-plugin` 스킴 위에 자기 origin을 갖습니다. 플러그인마다가 아니라 표면마다입니다. 자기 파일은
  상대 URL로 불러오고 호스트를 박아 넣지 마세요. 남겨야 할 것은 `localStorage`나 IndexedDB가 아니라
  `state`나 `store.*`에 둡니다. 한 플러그인의 두 창은 그것들을 나눠 쓰지 않습니다.
* 플러그인의 무한 루프, 메모리 누수, 크래시는 그 창 하나에만 영향을 줍니다. 한동안 보이지 않던 창은 잠들 수
  있고, `surface.onUnload`가 남긴 것을 들고 돌아옵니다(ADR 0142).
* 엔진이 Chromium이 되면 WebGPU(`navigator.gpu`)를 모든 OS에서 쓸 수 있습니다. 지금은 Linux의 WebKitGTK에는
  없고 macOS는 26 이상이 필요하니, 있는지 확인하고 대안을 두세요.
* worker, WebAssembly, `fs.url` URL에 `Range`를 붙인 `fetch`는 그대로 동작합니다(ADR 0048).

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

## 에이전트를 위한 커맨드

endue AI 의 에이전트나 로컬 두뇌는 사람이 실행하는 것과 같은 커맨드로 데스크를 다룹니다(ADR 0088). 커맨드에
`agent` 를 표시하고, 무엇을 하는지, 무엇을 받고 무엇을 돌려주는지 적으세요. 코어는 모든 호출의 인자를 `args`
로 검사하고, 커맨드를 `cmd.tools` 에 올리며, 데스크의 두뇌 턴에서 id 를 딴 이름의 도구
(`example_my-plugin_notes`)로 제공합니다.

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

`readOnly` 는 커맨드가 데이터만 돌려주고 사람이 가진 것을 아무것도 바꾸지 않는다는 뜻입니다. 커맨드는
에이전트가 아니라 플러그인의 권한으로 돌기 때문에, 프로그램을 실행하거나 보내거나 지우거나 게시하는 것에는
`irreversible` 를 표시하세요. 그러면 에이전트의 호출은 인자를 보여 준 뒤 사람의 승인을 기다립니다. 팔레트에서
인자 없이 실행할 때 빠지는 인자는 필수로 두지 말고 핸들러에서 검사하세요. 실행 중에 등록하는 커맨드도
`cmd.register` 로 같은 필드(`description`, `argsSchema`, `resultSchema`, `agent`, `readOnly`)를 받고,
`ctx.commands.tools()` 는 내 권한이 닿는 에이전트 커맨드를 나열합니다. 내장 git, terminal, docker,
calendar, database 플러그인이 예시입니다.

## 파일 편집: 편집 등급

파일을 여는 플러그인은 먼저 읽고, 편집은 나중에 더합니다(ADR 0045). 편집을 시작하면 여는 모든 형식은 읽기
등급과 함께, 세 가지 중 하나의 편집 등급을 가집니다(ADR 0071).

| 편집 등급 | 약속하는 것 | 저장할 때 |
| --- | --- | --- |
| `lossless` | 바꾸지 않은 파일을 저장하면 같은 바이트가 되고, 편집은 바꿔야 하는 바이트만 바꿉니다 | 파일을 덮어씁니다 |
| `text` | 내용은 남지만 서식(주석, 공백, 키 순서)은 남지 않을 수 있습니다 | 파일마다 처음 저장할 때 "Save as copy"(기본값)와 "Overwrite" 중 무엇을 할지 묻습니다 |
| `read-only` | 아무것도 저장하지 않습니다 | `desk.files.save` 를 거절합니다 |

모든 형식의 등급을 README(형식별 읽기 등급과 편집 등급 표)와, 첫 편집 전의 화면에 밝힙니다. 화면에는
`@endue-ai/ui` 의 `desk-edit-tier` 요소를 씁니다. 등급을 밝히지 않은 형식은 `read-only` 이고, 완전한 읽기
등급으로 열리지 않은 파일도 마찬가지입니다. 하는 것보다 적게 약속하는 것은 괜찮지만, 더 많이 약속해서는 안
됩니다. 요소의 `label` 과 `detail` 속성에는 직접 쓴 문구를 넣을 수 있습니다.

```html
<desk-edit-tier tier="lossless" format="CSV"></desk-edit-tier>   <!-- CSV · Lossless editing -->
```

`lossless` 는 바이트에 대한 약속이므로 `@endue-ai/plugin-sdk/testing` 의 두 검사로 증명합니다. 픽스처에는 그
형식의 까다로운 경우를 담습니다: BOM, CRLF 와 섞인 줄바꿈, 마지막 줄바꿈 없음, 따옴표와 이스케이프.

```ts
import { assertMinimalEdit, assertRoundTrip } from "@endue-ai/plugin-sdk/testing";

const model = assertRoundTrip(bytes, parse, serialize); // serialize(parse(bytes)) must be bytes
setCell(model, "B2", "Busan");                           // B2 held "Seoul"
assertMinimalEdit(bytes, serialize(model), { find: "Seoul", bytes: "Busan" });
```

`parse` 는 `Uint8Array` 를 받고, 문자열은 UTF-8 로 다룹니다. 구간은 파일의 바이트 단위 `{ offset, length }`
이거나, 그 바이트가 단 한 번 나오는 곳인 `{ find }` 입니다. `bytes` 는 그 구간이 무엇이 되어야 하는지를
정하고, 없으면 구간은 무엇이 되어도 됩니다. 실패하면 처음 달라진 바이트와 그 줄과 열, 주변의 16진수와
텍스트, 구간 밖의 변경을 알려 줍니다. 검사는 아무것도 import 하지 않으므로, 평범한 Node 테스트도
`packages/plugin-sdk/src/testing/round-trip.ts` 를 경로로 import 할 수 있습니다.

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

### 유니버설 뷰

유니버설 뷰(`specs/view/v0/universal.schema.json`, ADR 0087)는 한 가지 YAML 형식, 곧 유니버설 데이터 형식을
내주는 출처라면 어디에서든 엔트리를 받아 타임라인, 캘린더, 칸반, 리스트, 텍스트, 채팅, 에이전트 실행으로
보여 줍니다. 뷰는 데이터로 두고 `ctx.universal` 로 엽니다. 출처는 인라인 데이터, 플러그인 폴더의 파일
(`asset`, 권한 없음), URL(`net:fetch`), 데스크의 파일(`fs:read`), 다른 플러그인의 커맨드, 데스크의 아이템
중 무엇이든 되고, 뷰는 그대로입니다.

```js
const board = ctx.universal.open(document.getElementById("root"), {
  type: "kanban",
  types: ["kanban", "list", "timeline", "calendar"],
  source: { asset: "data/board.yaml" },
  map: { group: "column", start: "due" },
  move: { command: "example.board.move", args: { id: "{id}", to: "{move.to}" } },
});
```

그리는 것은 `@endue-ai/ui` 의 `<desk-universal-view>` 입니다. `ctx.universal.load(source)` 와
`ctx.universal.parse(text)` 는 문서 자체를 돌려줍니다. 플러그인을 직접 만들지 않아도
`desk.universal.open` 커맨드로 열 수 있습니다. 가장 작은 예는 `examples/plugin-hello-universal` 입니다.

## 플러그인 사이의 드래그 앤 드롭

플러그인은 `ctx.dnd`로 서로에게 *데스크 데이터*를 끌어다 놓습니다(ADR 0119). 모든 드래그는 데스크가
중개합니다. 드래그 이미지를 모든 프레임 위에 그리고, 포인터 아래의 프레임에 드래그를 제안하며, 항목은
떨어진 프레임에만 넘깁니다.

| 타입 | 항목 |
| --- | --- |
| `desk/paths` | `{ paths: [{ path, kind? }] }`: 절대 브리지 경로. 소스가 알면 `kind`는 `file` 또는 `folder` |
| `desk/text` | `{ text }` |
| `desk/uri` | `{ uri, title? }` |
| `desk/json` | `{ kind, value }`. `desk/json:<kind>` 타입으로 제안됩니다(예: `desk/json:db/rows`) |
| `text/plain` | `{ text }`: 드래그에 없을 때 데스크가 덧붙이는 대체 텍스트 |

```js
// 소스: 포인터가 DRAG_THRESHOLD를 넘게 움직여야 행이 드래그되므로, 클릭은 클릭으로 남습니다.
ctx.dnd.draggable(list, {
  item: (target) => {
    const row = target.closest("li");
    return row && { items: [{ type: "desk/paths", paths: [{ path: row.dataset.path, kind: "file" }] }] };
  },
});

// 대상: 받는 타입을 밝히면 그 타입만 받고, 수행한 효과로 답합니다.
ctx.dnd.onDrop(document, async (drop) => {
  for (const { path } of drop.paths ?? []) await open(path);
  return "link";
}, { accept: ["desk/paths", "text/plain"] });
```

* `startDrag({ items, effectAllowed, image })`는 직접 처리하는 포인터에서 드래그를 시작하고, 끝나면
  `{ effect, to }`로 이행합니다.
* 드래그가 대상 위에 있는 동안, 떨어질 요소에는 CSS용 `data-desk-drop="copy|move|link"`가 붙습니다.
* `options.at(element)`가 그 요소를, `options.effect(over)`가 효과를 고릅니다. 기본으로 Alt는 복사,
  Mod는 이동, 둘을 함께 누르면 링크입니다.
* 드래그의 어떤 타입도 받지 않는 프레임은 그 드래그를 알지 못합니다.
* 운영체제에서 끌어온 파일은 `os`가 보낸 `desk/paths`로 도착하며, 복사와 링크가 허용됩니다.

드롭은 경로와 데이터를 넘길 뿐, 접근 권한을 넘기지 않습니다. 떨어진 경로는 자신의 권한으로 `fs.read`를
호출해 읽고, 권한이 닿지 않으면 `perm.request`로 요청하세요.

테스트에는 `createTestHost`의 `host.dnd`를 씁니다.

* `host.dnd.drop({ items, over })`는 데스크처럼 대상에 항목을 제안하고, 효과로 이행합니다.
* `host.dnd.release()`는 플러그인이 시작한 드래그를 그 플러그인 위에 떨어뜨립니다.
* `host.dnd.drags`는 플러그인이 시작한 드래그 목록입니다.

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

## 테마 만들기

테마는 kind 가 `theme` 인 플러그인입니다. 디자인 시스템의 값과 그 값이 가리키는 글꼴 · 이미지 파일만 담고
코드는 없으므로, 권한을 요청하지 않습니다(ADR 0056, ADR 0057). 템플릿이나 예제에서 시작합니다.

```bash
pnpm --filter @endue-ai/create-plugin build                       # once
node packages/create-plugin/dist/create-plugin.js ../my-theme --kind theme
DESK_DEV_PLUGINS=$PWD/../my-theme just dev
cargo run -p desk-cli -- theme apply local.my-theme
```

패키지가 공개되면 `pnpm create @endue-ai/plugin my-theme --kind theme` 으로 같은 일을 합니다. 템플릿에는
두 scheme 의 모든 역할 색, 기본값에 둔 나머지 층, 각 값이 무엇을 칠하는지 설명하는 README 가 들어 있습니다.
`examples/plugin-hello-theme` 은 글꼴 하나와 배경 하나를 가진 가장 작은 테마입니다. 테마를 설치해도 적용되지는
않습니다. 적용 중인 테마는 설정 `desk.theme.active` 가 가리키며, 테마 스튜디오(오른쪽 위의 팔레트 버튼, 또는
커맨드 팔레트의 Themes), `desk.theme.use`, `desk theme apply` 로 고릅니다.

스튜디오에서도 테마를 만듭니다. "Tune a copy"(또는 `desk.theme.edit`)는 고른 테마의 사본으로, "New theme" 은 endue
테마로 편집기를 엽니다. 글꼴과 배경 이미지까지 모든 층에 조작 요소가 있고, 데스크 전체가 바뀌는 초안을 그대로 보여
주며, 게이트의 보정 내역이 팔레트 아래에 나오고, Save 는 그 결과를 내 테마(`local.<이름>`)로 저장합니다. 테마를
레포에 두고, 테스트하고, 공개하는 길은 폴더입니다.

### theme 블록

`plugin.json` 은 kind `theme` 과 `theme` 블록(`specs/plugin/v0/theme.schema.json`)을 갖고, `entry`,
`permissions`, `surfaces`, `contributes`, `autoload` 는 갖지 않습니다.

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

`author`, `license`(테마와 그 파일들의 SPDX 라이선스 식), `tags`, `preview`(갤러리 카드에 쓰는 색, 다섯 개까지),
`origin`(테마를 묘사한 문장과 출발한 테마)은 테마를 설명합니다. `light` 와 `dark` 는 scheme 을 하나씩 담습니다.
테마에는 둘 중 하나가 있어야 하고, 없는 쪽은 데스크 자신의 테마가 대신합니다.

### 층과 프리셋

층은 여섯 개이고 모두 기본값이 있어서, 팔레트만 있어도 테마가 됩니다.

| 층 | 키 | 값 |
| --- | --- | --- |
| 팔레트 | `<scheme>.colors` | 토큰 이름(camelCase) → CSS 색. `docs/design-system.md` 의 역할, 셸과 Eris 의 토큰. 빠진 역할은 데스크의 값을 씁니다 |
| 재질 | `<scheme>.material` | `opacity` 0.6–1, `blur` 0–24 px, `noise` 0–0.15, `border` 0–2 px, `shadow` none · soft · strong |
| 타이포 | `type` | `sans` · `mono` 글꼴 스택, `scale` 0.85–1.25, `tracking` −0.02–0.05 em, `fonts` |
| 형태 | `shape` | `radius` none · subtle · soft · round, `density` compact · comfortable · spacious |
| 모션 | `motion` | `personality` snappy · smooth · calm |
| 배경 | `<scheme>.backdrop` | `color`, `angle` 방향의 2–4색 `gradient`, 또는 `fit` 이 cover · tile 인 `image`. 그리고 `glow` |

`<scheme>.terminal.ansi` 는 터미널의 16색을, `<scheme>.contrast` 는 고대비에서 바뀌는 팔레트를 정합니다. 모서리,
밀도, 모션, 글자 크기 배율, 그림자는 프리셋입니다. 런타임이 이름을 토큰으로 바꾸므로(`docs/design-system.md` 의
"Choosing a theme") 데스크가 프리셋을 다시 조율해도 테마는 그대로 동작합니다. 숫자에는 범위가 있고 값에는
`url()` 이 들어갈 수 없어서, 유효한 테마는 언제나 쓸 수 있는 상태로 남습니다.

### 게이트

데스크는 적용하는 모든 테마를 게이트(`@endue-ai/ui/theme`)에 통과시킵니다. 글자는 바탕에 대해 4.5:1, 테두리와
채움은 3:1, 고대비에서는 7:1 과 4.5:1 에 이르러야 합니다. 모자란 전경색은 OKLCH 명도만, 비율에 닿는 만큼만
움직이고 바탕색은 바꾸지 않습니다. `contrast` 팔레트가 없으면 테마의 고대비도 같은 방법으로 자기 색에서
유도됩니다. 게이트가 고칠 것이 없도록 두 scheme 모두에서 색 쌍을 확인하세요.

### 자산과 한도

글꼴은 `.woff2`, 이미지는 `.png`, `.jpg`, `.webp` 파일이고(스크립트를 품을 수 있는 SVG 는 안 됩니다) 폴더 안에
있어야 하며, 파일당 2 MiB, 합쳐서 8 MiB 까지입니다. 글꼴의 라이선스는 `license` 에 적고 라이선스 파일을 옆에
둡니다. 내장 테마는 `fonts/OFL.txt` 와, 원본 위치와 체크섬을 적은 `fonts/SOURCE.md` 를 둡니다. 데스크는 테마의
글꼴을 셸과 모든 플러그인 프레임에 `FontFace` 로 불러오고, 배경은 셸만 그립니다.

### 테마 테스트

```bash
cargo run -p desk-cli -- plugin validate ../my-theme
cargo run -p desk-cli -- plugin test ../my-theme
```

`desk plugin validate` 는 블록을 스키마에, 파일을 한도에 비추어 검사합니다. `desk plugin test` 는 템플릿의
`tests/theme.test.ts` 를 SDK의 테스트 호스트 위의 vitest로 실행합니다. 이 테스트는 데스크가 테마를 적용하기
전에 하듯 두 scheme 을 `compileTheme` 으로 컴파일하고 endue 팔레트 위에서 `gate` 로 검사하며, 게이트가
고칠 것이 있으면 그 내역을 모두 보이며 실패합니다.

### `.desk-theme` 으로 나누기

```bash
cargo run -p desk-cli -- theme export local.my-theme     # local.my-theme.desk-theme in Downloads
cargo run -p desk-cli -- theme import ~/Downloads/dusk.desk-theme
```

`.desk-theme` 은 JSON 파일 하나입니다. `format` 은 `desk-theme/1`, `manifest` 는 테마의 `plugin.json`, `files` 는
블록이 가리키는 파일들의 base64 이며, 16 MiB 를 넘지 않습니다(ADR 0058). 가져오면 테마 플러그인으로 검사한 뒤
사용자의 테마 폴더에 설치하고, id 가 `local.` 과 `market.` 밖이면 `local.<이름>` 으로 바꿉니다. `desk theme list`
가 보여 주고 `desk theme remove` 가 지웁니다. 스튜디오의 Export 와 Import 도 같은 일을 하고, 스튜디오에 끌어다
놓은 `.desk-theme` 도 받습니다.

### 마켓

스튜디오의 Market 탭은 설정 `desk.theme.markets` 가 색인의 https URL 로 가리키는 마켓들의 테마를 보여 줍니다
(ADR 0060). 기본값은 이 저장소 `main` 의 `market/themes/index.json` 이고,
`https://raw.githubusercontent.com/endue-ai/Desk/main/market/themes/index.json` 에서 읽습니다. 다른 마켓의
색인은 `init.yaml` 에서 그 뒤에 덧붙입니다. 두 마켓이 같은 id 를 실으면 앞의 마켓이 이깁니다.

```yaml
settings:
  desk.theme.markets:
    - https://raw.githubusercontent.com/endue-ai/Desk/main/market/themes/index.json
    - https://themes.example.com/index.json
```

카드는 테마의 미리보기 색, 이름, 만든 이, 라이선스와 이 데스크에서의 상태(Available, Installed, Update
available, Edited)를 보여 줍니다. Preview 는 `.desk-theme` 을 받아 sha256 을 확인하고, 설치하지 않은 채 데스크
전체에 보여 줍니다. Install 은 URL 과 sha256 을 넘기는 `theme.import` 로 `market.` 아래 id 그대로 들여오고,
Apply 가 그 테마를 적용합니다. 업데이트는 내가 고치지 않은 마켓 테마만 바꿉니다. 내가 고친 테마는 내 것으로
남습니다.

테마를 올리려면 묶음과 색인 항목을 `market/themes/` 에 더하는 풀 리퀘스트를 엽니다.

1. 테마를 내보냅니다(`desk theme export <id> <file>`, 또는 스튜디오의 Export). id 는 `market.` 아래로 하고,
   버전과 `theme.author`, `theme.license`(글꼴과 이미지까지 덮는 SPDX 식)를 붙입니다.
2. 파일을 `market/themes/` 에 `<name>.desk-theme` 으로 두고 `index.json`
   (`specs/plugin/v0/theme-index.schema.json`)에 항목을 더합니다. `id`, `name`, `version`, `description`,
   `author`, `license`, `tags`, 다섯 개까지의 `preview` 색, `url`(파일 이름), `sha256`, `size` 입니다.
3. `node scripts/theme-market.mjs` 를 실행합니다. `just check` 에 들어 있는 이 마켓 검사기는 틀린 해시나
   크기, 빠진 라이선스, 겹친 id, 올바른 테마 플러그인이 아닌 묶음을 거부하고, 테스트가 모든 마켓 테마를 두
   scheme 에서 게이트에 통과시킵니다.

업데이트는 새 버전과 그 새 묶음, sha256, 크기입니다. 같은 단계가 `market/themes/README.md` 에도 있습니다.
