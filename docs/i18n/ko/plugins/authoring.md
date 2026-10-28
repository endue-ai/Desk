> 이 문서는 [영문판](../../../plugins/authoring.md)을 옮긴 번역본이며, 내용이 다르면 영문판이 우선합니다.

# Desk 플러그인 작성하기

Desk 플러그인은 폴더 하나입니다. 내장 기능도 똑같은 형식을 쓰므로, Desk 자신이 화면에서 하는 일은 무엇이든
직접 만든 플러그인도 할 수 있습니다. 이 문서는 UI 플러그인(v0)을 다룹니다. 로직(Wasm) 플러그인과 도구(MCP)
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
`ui:notify`, `plugin:manage`)는 `specs/plugin/v0/README.md`에 있습니다.

## 테스트

`@endue-ai/plugin-sdk/testing`을 쓰면 브라우저 없이 모의 브리지를 상대로 플러그인을 실행할 수 있습니다.

```ts
import { defineUiPlugin } from "@endue-ai/plugin-sdk";
import { createTestHost } from "@endue-ai/plugin-sdk/testing";

const host = createTestHost({ pluginId: "example.my-plugin", handlers: { "perm.query": () => ({ grants: [] }) } });
await defineUiPlugin(myPlugin, host.transport);
await host.settle();
// host.calls, host.state, host.emit(event)
```

공개하기 전에 `desk plugin validate <folder>`를 통과해야 합니다. CI는 `plugins/`와 `examples/` 안의 모든 폴더에
대해 이 명령을 실행합니다.
