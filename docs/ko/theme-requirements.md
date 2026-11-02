# endue Desk 테마 요구사항

2026-11-02 · Team endue

> 테마 시스템이 갖춰야 할 것을 번호를 붙여 적은 문서입니다. `desk-requirements.md` 의 RT-09 · BR-05 · PKG-07 · DX-04 · MKT 를 테마 단위로 펼친 것이고, 그 문서의 ID 를 그대로 가리킵니다. 토큰의 이름과 쓰임은 `docs/design-system.md` 가, 테마가 코어 시스템인 이유는 ADR 0056 이 말합니다. 코드와 어긋나면 이 문서를 고치고, 되돌리기 어려운 갈림길은 ADR 로 남깁니다.

테마는 *디자인 시스템의 값* 입니다. 디자인 시스템이 "무엇을 어떤 토큰으로 그리나" 를 정한다면, 테마는 그 토큰에 어떤 값이 들어가나를 정합니다. 그래서 테마 시스템은 데스크의 모든 UI — 셸, `@endue-ai/ui` 요소, `base.css`, 모든 플러그인 화면 — 를 한 번에 다스리고, 각 UI 와 플러그인은 테마에 맞춰 구성됩니다. 빌더는 테마를 고르고, 다듬고, 말로 만들고, 파일 하나로 나눕니다.

## 한눈에

```text
 theme 플러그인 (kind theme)                       contributes.themes (policy: desk.theme · desk.shell …)
 plugin.json 의 theme 블록 + fonts/ · images/      늘 겹쳐지는 토큰 기여
        │ plugin.list                                      │
 packages/runtime  테마 엔진: 고르기(desk.theme.active) → 컴파일(여섯 층 → 토큰) → 게이트(대비 · 범위) → 적용
        │ --desk-* (CSSOM) · FontFace · desk:theme 메시지
 ├ 셸(메인 UI) · 테마 스튜디오(갤러리 · 다듬기 · 말하기 · 마켓)
 └ 플러그인 프레임: SDK 가 변수 · 글꼴을 적용 → base.css · @endue-ai/ui 요소 · 플러그인 CSS 는 토큰만 읽는다
        │ theme.save · theme.import · theme.export · theme.remove (theme:manage)
 crates/desk-core  사용자 테마 폴더(<data>/themes) · .desk-theme 묶음 · 마켓 색인
        │ brain.ask (도구 propose_theme)
 brain (endue AI · examples/brain-echo)
```

## 사용자 넷의 관점

| 사용자 | 테마에서 바라는 것 | 요구사항 |
| --- | --- | --- |
| 쓰는 사람 | 마음에 드는 테마를 골라 1초 안에 바꾸고, 어느 화면도 깨지지 않는다 | TS-01 · TS-02 · TP |
| 꾸미는 사람 | 색 · 재질 · 글꼴 · 모서리 · 모션 · 배경을 다듬고, 한 문장으로 새 테마를 받는다 | TS-03 · TS-06 · TH-03 |
| 만드는 사람 | 테마를 파일로 레포에 두고, 검사하고, 나누고, 마켓에 올린다. 고객 브랜드로 데스크를 입힌다 | TC · TD · TS-09 |
| 에이전트 | 사람과 같은 커맨드로 테마를 고르고, 사람의 문장을 테마 값으로 옮긴다 | TC-04 · TB |

## 하지 않는 것

- 테마는 CSS 를 주입하지 않고 코드를 돌리지 않습니다. 값만 갖습니다. 그래서 권한이 필요 없습니다.
- 레이아웃, 아이콘의 의미, `brand/` 의 endue · Eris 자산은 바꾸지 않습니다.
- 파일 내용의 색(문서 글자색, 슬라이드 배경, 이미지 픽셀)은 테마 밖입니다. 터미널 ANSI 16색만 예외입니다(작업 표면이라서).
- brain 에게 파일이나 화면을 보내지 않습니다(TB-04).

## 테마의 모양

테마는 여섯 층의 값입니다. 모든 층에 기본값이 있어서 팔레트만 적은 테마도 완전한 테마입니다. 층은 컴파일되어 `--desk-*` 토큰이 되고, 런타임은 그 토큰만 뿌립니다.

| 층 | `theme` 블록의 키 | 값 | 되는 토큰 |
| --- | --- | --- | --- |
| 팔레트 | `light.colors` · `dark.colors` (+ `contrast`) | 역할 색 이름 → CSS 색. 셸 · Eris 토큰(`eris*`)도 포함 | 그 이름 그대로 |
| 재질 | `<scheme>.material` | `opacity` 0.6–1 · `blur` 0–24px · `noise` 0–0.15 · `border` 0–2px · `shadow` none / soft / strong | `surfaceOpacity` · `blur` · `noise` · `borderWidth` · `shadowSm/Md/Lg` |
| 타이포 | `type` | `sans` · `mono` 글꼴 스택, `scale` 0.85–1.25, `tracking` −0.02–0.05em, `fonts[]`(woff2) | `fontSans` · `fontMono` · `text*` × scale · `tracking` |
| 형태 | `shape` | `radius` none / subtle / soft / round, `density` compact / comfortable / spacious | `radiusSm/Md/Lg` · `control*` |
| 모션 | `motion` | `personality` snappy / smooth / calm | `motion*` · `easing` |
| 배경 | `<scheme>.backdrop` | `color` · `gradient`(2–4색) · `angle` · `image` · `fit` cover / tile · `glow` | `backdrop` · `backdropSize` · `glow` · `glowEnd` |
| (터미널) | `<scheme>.terminal` | `ansi` 16색 | `ansi0` … `ansi15` |

```json
{
  "id": "endue.theme-paper",
  "name": "Paper & Ink",
  "version": "1.0.0",
  "kind": "theme",
  "description": "Warm paper, ink-blue accents, soft corners.",
  "theme": {
    "author": "Team endue",
    "license": "CC0-1.0",
    "origin": { "prompt": "따뜻한 종이 질감에 잉크색 포인트" },
    "type": { "sans": "\"Literata\", Georgia, serif", "scale": 1, "fonts": [{ "family": "Literata", "src": "fonts/literata.woff2", "weight": "200 900" }] },
    "shape": { "radius": "soft", "density": "comfortable" },
    "motion": { "personality": "smooth" },
    "light": {
      "colors": { "background": "#f6f1e7", "text": "#1d1a16", "primary": "#1f3a93" },
      "material": { "noise": 0.06, "shadow": "soft" },
      "backdrop": { "gradient": ["#f6f1e7", "#ede4d3"], "glow": "rgba(217, 201, 168, 0.4)" }
    }
  }
}
```

## 요구사항

표의 *현재* 는 2026-11-02 `main`(fa7a4af) 기준(있음 · 일부 · 없음)이고, *단계* 는 §단계의 이름입니다.

### 엔진 (TH)

| ID | 요구사항 | 현재 | 단계 |
| --- | --- | --- | --- |
| TH-01 | 테마는 메인 UI 의 코어 시스템이다. 고르기 · 컴파일 · 적용 · 스튜디오를 런타임이 갖고, 플러그인으로 갈아끼우지 않는다 (ADR 0056) | 일부 (런타임이 해석 · 적용) | M0 |
| TH-02 | kind `theme`: `plugin.json` 의 `theme` 블록과 자산. entry · permissions · contributes · surfaces 는 없다 | 없음 | M0 |
| TH-03 | 여섯 층과 터미널 어휘(§테마의 모양). 층마다 기본값이 있다 | 일부 (팔레트만) | M1 |
| TH-04 | scheme 별 변형 `light` · `dark`. 없는 쪽은 endue 테마. 고대비는 테마의 `contrast` 또는 게이트가 유도한다 | 없음 | M0 |
| TH-05 | 고르기: 설정 `desk.theme.active`(테마 id, 빈 값 = endue). 설치는 적용이 아니다. 프로필 · `init.yaml` 이 실어 나른다 | 없음 (같은 scheme 기여가 전부 겹침) | M0 |
| TH-06 | 해석 순서: 기본 토큰 → policy 기여(scheme · 고대비 층) → 활성 테마 → 고대비(테마의 것 또는 유도) → 동작 줄이기 | 일부 | M0 |
| TH-07 | 게이트: 대비 쌍(본문 4.5:1 · 비텍스트 3:1, 고대비 7:1 · 4.5:1), OKLCH 명도 보정, 범위 자르기, 모르는 키 무시. 보정 내역을 돌려준다 | 일부 (테스트에만 대비 쌍) | M0 |
| TH-08 | 전달: 셸과 모든 프레임에 `--desk-*`(CSSOM), 글꼴은 FontFace(셸 · SDK), 배경은 셸만. 리로드 없이 바뀐다 | 일부 (토큰 · 리로드 없음) | M1 |
| TH-09 | 자산: woff2 · png · jpg · webp, 파일당 2 MiB · 합 8 MiB. SVG · HTML · 스크립트는 거부. `desk plugin validate` 가 검사한다 | 없음 | M1 |
| TH-10 | 메인 웹뷰 CSP 가 `desk-plugin` 스킴의 글꼴 · 이미지를 받는다 | 없음 | M1 |

### 스튜디오 (TS) — 메인 UI

| ID | 요구사항 | 현재 | 단계 |
| --- | --- | --- | --- |
| TS-01 | 테마 스튜디오는 셸의 시스템 창이다: 커맨드 `desk.theme.studio`(팔레트 "Themes"), 셸의 버튼, 단축키로 연다 | 없음 | M0 |
| TS-02 | 갤러리: 기본 · 내 테마 · 받은 테마를 카드(미리보기 색 · 이름 · 설명)로. 포커스는 미리보기, Enter 는 적용, Esc 는 되돌림 | 없음 | M0 |
| TS-03 | 다듬기: 층별 편집기(색 · 슬라이더 · 프리셋 · 글꼴 · 배경 이미지), 실시간 미리보기, 게이트 보정 표시 | 없음 | M1 |
| TS-04 | 저장: "내 테마로 저장". 기본 테마는 복제해서 다듬는다 (`theme.save`) | 없음 | M1 |
| TS-05 | 공유: `.desk-theme` 내보내기 · 가져오기(파일 열기 · 끌어놓기) | 없음 | M1 |
| TS-06 | 말하기: 한 문장 → `brain.ask` → 게이트 → 미리보기 → 적용 · 다듬기("더 따뜻하게") · 버리기 | 없음 | M2 |
| TS-07 | Eris 대화에서도 말하기: Eris 에게 테마를 말하면 같은 흐름이 스튜디오에서 열린다 | 없음 | M2 |
| TS-08 | 마켓: 색인의 테마를 카드로 보고, 받고(해시 확인), 미리보고, 적용한다 | 없음 | M3 |
| TS-09 | 브랜드에서 추출: 로고 이미지에서 대표 색 5개를 기기 안에서 뽑아 말하기 입력에 붙인다 | 없음 | M3 |

### 코어 · 공유 (TC)

| ID | 요구사항 | 현재 | 단계 |
| --- | --- | --- | --- |
| TC-01 | 사용자 테마 폴더 `<data>/themes/<id>/`: 코어가 설치하고 감시한다(내장 아님) | 없음 | M1 |
| TC-02 | 브리지 `theme.save` · `theme.import` · `theme.export` · `theme.remove`, 권한 `theme:manage`(runtime · cli) | 없음 | M1 |
| TC-03 | `.desk-theme` 묶음: JSON 하나(`format`, `manifest`, `files` base64), 16 MiB 이하 | 없음 | M1 |
| TC-04 | CLI: `desk theme list · apply · import · export`, `desk plugin validate` 의 테마 검사 | 없음 | M1 |
| TC-05 | 마켓 색인 형식과 설정 `desk.theme.markets`(URL 목록). 받기는 sha256 을 확인한다 | 없음 | M3 |

### Brain (TB)

| ID | 요구사항 | 현재 | 단계 |
| --- | --- | --- | --- |
| TB-01 | 브리지 `brain.ask { prompt, tool }` → `{ turnId }`. 답은 `brain.turn` 의 구조화 결과. 권한 `brain:ask`(대화를 읽지 못한다) | 없음 (`brain.say` 뿐) | M2 |
| TB-02 | brain 계약: `createTurn` 에 `tools` · `toolChoice`, 코어가 여는 일회성 세션 | 없음 | M2 |
| TB-03 | `examples/brain-echo` 가 `propose_theme` 을 낱말로 흉내 낸다(개발 · 테스트) | 없음 | M2 |
| TB-04 | 보내는 것은 넷뿐: 스키마, 현재 테마 값, 규칙(역할 설명 · 대비 쌍 · 범위), 문장(+ 추출 색) | 없음 | M2 |
| TB-05 | brain 이 오프라인이거나 크레딧이 없으면 말하기만 닫히고 고르기 · 다듬기는 그대로다 | 없음 | M2 |

### 플러그인 적합성 (TP)

| ID | 요구사항 | 현재 | 단계 |
| --- | --- | --- | --- |
| TP-01 | UI 는 색 · 글꼴 · 글자 크기 · 모서리 · 시간을 토큰으로만 읽는다: CSS, 페이지의 `<style>` · `style=""`, 스크립트의 문자열(캔버스 포함) | 일부 (셸 · ui 거의 다, 플러그인 리터럴 636개) | M0 · M1 |
| TP-02 | 파일 내용의 색은 `theme: content` 주석으로만 예외로 둔다 | 없음 | M0 |
| TP-03 | `scripts/ui-lint.mjs` 가 `just check` 에서 래칫으로 지킨다: 대상별 baseline, 0 이 되면 지운다 | 있음 (이 변경) | M0 |
| TP-04 | 이주가 끝난 플러그인은 `tests/theme.test.ts` 로 0 을 지킨다 | 없음 | M0 · M1 |
| TP-05 | 터미널은 ANSI 16색 · 커서 · 선택을 테마에서 읽는다 | 일부 (화면 · 글자 · 커서) | M1 |

### 도구 · 문서 (TD)

| ID | 요구사항 | 현재 | 단계 |
| --- | --- | --- | --- |
| TD-01 | 기본 테마: endue(기본값) 와 쇼케이스 테마 넷 이상. 각자 자산과 두 scheme 을 갖는다 | 일부 (endue 만) | M1 |
| TD-02 | `pnpm create @endue-ai/plugin --kind theme` 템플릿과 `examples/plugin-hello-theme` | 없음 | M3 |
| TD-03 | `docs/plugins/authoring.md` 의 "테마 만들기" 와 번역 5종, `docs/design-system.md` 의 테마 절 | 일부 | M1 · M3 |

## 단계

| 단계 | 끝나는 조건(게이트) | 담는 것 |
| --- | --- | --- |
| M0 고르기 | 갤러리에서 1초 안에 바꾸고, 대비 실패 0, 이주가 끝난 플러그인은 lint 0 | TH-01 · 02 · 04–07, TS-01 · 02, TP-02–04, 엔진 · 래칫 · 가장자리 플러그인 |
| M1 다듬기 | 문서 없이 10분 안에 테마 파일을 만들고 저장 · 공유한다 | TH-03 · 08–10, TS-03–05, TC-01–04, TP-01 · 05, TD-01 · 03 |
| M2 말하기 | 문장 10개가 테마 10개가 되고, 대비 실패 0, 적용까지 5초 안 | TB-01–05, TS-06 · 07 |
| M3 나누기 | 마켓에서 받아 미리보기로 들어오고, 브랜드 색으로 시작한다 | TC-05, TS-08 · 09, TD-02 |

## 결정 기록

2026-11-02 기획 문서("Desk 테마 기획") 의 열린 질문에 대한 답입니다.

| 질문 | 결정 |
| --- | --- |
| Eris 의 색(`eris*`)을 테마가 바꾸나 | 바꾼다. 팔레트의 일부다 |
| 기본 테마와 사용자 테마 | 기본 제공 테마가 있고, 사용자도 만들고 공유하며, 테마 마켓이 있다 |
| 편집기 · 갤러리의 자리 | 테마는 별개의 시스템이고 편집기 · 갤러리와 같은 레벨, 곧 메인 UI 다. 플러그인이 아니다 (ADR 0056) |
| Eris 대화의 말하기 | M2 |
| 테마 자산(글꼴 · 이미지) | M1 |
| 남은 질문 | 로컬 brain(Ollama) 연결, `--desk-accent` 폐기 시점, 마켓 색인의 호스팅 위치 |
