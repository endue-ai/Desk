> 이 문서는 [영문판](../../../plugins/authoring.md)을 옮긴 번역본이며, 내용이 다르면 영문판이 우선합니다.

# Desk 플러그인 작성하기

Desk 플러그인은 폴더 하나입니다. 내장 기능도 똑같은 형식을 쓰므로, Desk 자신이 화면에서 하는 일은 무엇이든
직접 만든 플러그인도 할 수 있습니다. 이 문서는 UI 플러그인(v0)과 테마를 다룹니다. 로직(Wasm) 플러그인과 도구(MCP)
플러그인은 나중에 추가됩니다.

## 예제에서 시작하기

```bash
cp -R examples/plugin-hello-ui ../my-plugin      # then change the id in plugin.json
cargo run -p desk-cli -- plugin validate ../my-plugin
```

작업 중인 플러그인을 Desk에서 보려면, 그 폴더를 개발용 플러그인으로 지정해 Desk를 실행합니다.

```bash
DESK_DEV_PLUGINS=$PWD/../my-plugin just dev
```

폴더 안의 파일을 저장하면 해당 플러그인의 서피스만 1초 안에 다시 로드됩니다. Desk의 나머지 부분과 플러그인의
상태는 그대로 유지됩니다.

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
pnpm exec vitest run --root ../my-theme
```

`desk plugin validate` 는 블록을 스키마에, 파일을 한도에 비추어 검사합니다. 템플릿의 `tests/theme.test.ts` 는
데스크가 테마를 적용하기 전에 하듯 두 scheme 을 `compileTheme` 으로 컴파일하고 endue 팔레트 위에서 `gate` 로
검사하며, 게이트가 고칠 것이 있으면 그 내역을 모두 보이며 실패합니다.

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

테마 마켓이 준비 중입니다(`docs/ko/theme-requirements.md` 의 TC-05, TS-08). `.desk-theme` 파일들과 그 sha256 을
담은 색인이고, 스튜디오가 이를 보여 주고 미리 보고 `market.` 아래 id 로 설치합니다. `theme.import` 는 이미
`https` URL 과 묶음의 `sha256` 을 받고, 바이트가 맞지 않으면 거부합니다. 마켓이 열리기 전에는 파일 자체를
나누세요.
