# endue Desk 디자인 시스템 요구사항

2026-11-05 · Team endue

> 디자인 시스템이 갖춰야 할 것을 번호를 붙여 적은 문서입니다. `theme-requirements.md` 와 짝을 이루고, 그 문서의 ID(TH · TS · TC · TP)를 그대로 가리킵니다. 토큰과 컴포넌트의 이름 · 쓰임은 `docs/design-system.md` 가, 디자인 시스템이 코어 시스템인 이유는 ADR 0090 이, 테마 파이프라인을 같이 쓰는 이유는 ADR 0091 이 말합니다. 코드와 어긋나면 이 문서를 고치고, 되돌리기 어려운 갈림길은 ADR 로 남깁니다.

테마가 *토큰에 어떤 값이 들어가나* 를 정한다면, 디자인 시스템은 *컴포넌트가 어떤 토큰으로 어떻게 만들어지나* 를 정합니다. 버튼의 모서리가 `radius-md` 인지 `radius-full` 인지, 주 버튼이 꽉 찬 채움인지 옅은 채움인지 테두리뿐인지, 입력칸이 상자인지 밑줄인지, 목록의 선택 행이 채움인지 왼쪽 막대인지 — 이것이 디자인 시스템입니다. 데스크의 모든 UI 는 디자인 시스템의 컴포넌트로만 그려지고, 컴포넌트는 컴포넌트 토큰만 읽고, 컴포넌트 토큰은 테마 토큰을 가리킵니다. 그래서 테마와 디자인 시스템은 따로 고르고 자유롭게 섞입니다.

## 한눈에

```text
 design-system 플러그인 (kind design-system)        theme 플러그인 (kind theme)
 plugin.json 의 designSystem 블록 (컴포넌트 레시피)   plugin.json 의 theme 블록 (여섯 층의 값)
        │ desk.design.active                                │ desk.theme.active
 packages/runtime  고르기 → 컴파일(레시피 → 컴포넌트 토큰) ─┐   고르기 → 컴파일 → 게이트
                                                          └→ 테마 토큰 위에 얹어 한 번에 적용
        │ --desk-<component>-* = var(--desk-<theme token>)  (CSSOM · desk:theme 메시지)
 ├ 셸 키트 (.btn · .input · .segment · .menu-item · .dialog · .badge · .tooltip …)
 ├ @endue-ai/ui 요소 (<desk-button> · <desk-input> · <desk-list> · <desk-menu> …)
 └ base.css 키트 클래스 (.desk-btn · .desk-field · .desk-tabs · .desk-card · .desk-row …) → 플러그인 화면
        │ theme.save · theme.import · theme.export · theme.remove · theme.market.* (theme:manage)
 crates/desk-core  사용자 폴더(<data>/themes) · .desk-design 묶음 · 마켓 색인(kind)
        │ cmd.tools (agent 커맨드) · brain.ask (도구 propose_design_system)
 Eris · 에이전트
```

## 테마와의 경계

| | 테마 (ADR 0056 · 0057) | 디자인 시스템 (ADR 0090) |
| --- | --- | --- |
| 정하는 것 | 토큰의 값: 색 · 재질 · 글꼴 · 크기 단계 · 모서리 단계 · 모션 · 배경 | 컴포넌트의 구성: 어느 단계 · 어느 역할 색 · 어느 변형을 쓰나 |
| 예 | `radius-md` 는 8px, `primary` 는 라벤더 | 버튼은 `radius-full`, 주 버튼은 옅은 채움, 입력칸은 밑줄 |
| 값의 형태 | 색 · 수치 · 프리셋 | 이름 붙은 선택지만(자유 수치 없음) |
| 결과 토큰 | `--desk-primary` · `--desk-radius-md` … | `--desk-button-radius: var(--desk-radius-full)` … |
| 고르기 | `desk.theme.active` | `desk.design.active` |
| 대비 | 게이트가 역할 쌍을 보정 | 게이트가 이미 보정한 쌍만 고를 수 있다 |

디자인 시스템은 값을 만들지 않으므로 어떤 테마와 섞여도 대비를 깨지 않습니다(DC-05).

## 사용자 넷의 관점

| 사용자 | 디자인 시스템에서 바라는 것 | 요구사항 |
| --- | --- | --- |
| 쓰는 사람 | 갤러리에서 디자인 시스템을 골라 1초 안에 바꾸고, 셸과 모든 플러그인이 같이 바뀐다 | DS-01 · DS-02 · DC-01 |
| 꾸미는 사람 | 컴포넌트마다 모양 · 크기 · 변형을 직접 고르거나, 한 문장으로 받는다 | DS-03 · DS-06 |
| 만드는 사람 | 파일로 내보내고 가져오고, 남이 만든 것을 마켓에서 받는다. 플러그인은 키트만 쓰면 따라온다 | DT · DS-04 · DS-05 · DC-02 |
| Eris · 에이전트 | 사람과 같은 커맨드로 목록을 읽고, 고르고, 컴포넌트 값을 바꾼다 | DE |

## 하지 않는 것

- CSS 를 주입하지 않고 코드를 돌리지 않습니다. 이름 붙은 선택지만 갖습니다. 권한이 필요 없습니다.
- 값을 만들지 않습니다. 색 · 글꼴 · 크기 단계의 값은 테마의 것입니다.
- 레이아웃(창의 배치, 플러그인 화면의 구조)과 아이콘은 바꾸지 않습니다.
- 파일 내용(문서 · 이미지 · 슬라이드)의 모양은 디자인 시스템 밖입니다.

## 디자인 시스템의 모양

`plugin.json` 의 `designSystem` 블록입니다. 모든 컴포넌트와 속성에 기본값(endue 디자인 시스템)이 있어서, 버튼 하나만 적은 디자인 시스템도 완전합니다. 선택지는 `@endue-ai/ui/design` 의 카탈로그(`catalogue.ts`)가 단일 출처이고, `specs/plugin/v0/design-system.schema.json` 이 계약이며, 둘이 같은지는 테스트가 지킵니다.

| 컴포넌트 | 키 | 속성 (첫 값이 기본) | 그리는 곳 |
| --- | --- | --- | --- |
| 버튼 | `button` | `shape` md · none · sm · lg · full, `size` sm · xs · md · lg, `weight` medium · regular · semibold · bold, `case` none · uppercase, `padding` normal · tight · roomy, `primary` solid · soft · outline, `secondary` outline · soft · ghost, `elevation` none · sm | `.btn*` · `<desk-button>` · `.desk-btn*` |
| 아이콘 버튼 | `iconButton` | `shape` md · none · sm · lg · full, `size` md · xs · sm · lg, `style` ghost · soft · outline | `.icon-button` · `.desk-icon-btn` |
| 입력칸 | `field` | `style` outline · filled · underline, `shape` md · none · sm · lg · full, `size` md · xs · sm · lg, `focus` ring · border | `.input` · `<desk-input>` · `.desk-field` |
| 체크 | `check` | `accent` primary · text, `size` md · sm · lg | `.desk-check` |
| 탭 | `tabs` | `style` boxed · pill · underline, `shape` md · none · sm · lg · full, `size` sm · xs · md · lg | `.segmented` · `.desk-tabs` |
| 카드 | `card` | `style` outline · elevated · filled · plain, `shape` md · none · sm · lg, `padding` normal · tight · roomy | `<desk-card>` · `.desk-card` |
| 목록 행 | `row` | `selection` fill · soft · bar, `shape` md · none · sm, `size` sm · xs · md | `.menu-item` · `<desk-list>` · `<desk-menu>` · `.desk-row` |
| 메뉴 | `menu` | `shape` md · none · sm · lg, `elevation` md · none · sm · lg, `border` outline · none | `<desk-menu>` · `.desk-menu` |
| 대화상자 | `dialog` | `shape` lg · none · sm · md, `elevation` lg · md, `scrim` blur · dim, `padding` roomy · normal | `.dialog` · `.scrim` · `<desk-dialog>` · `.desk-dialog` |
| 토스트 | `toast` | `style` outline · soft · inverse, `shape` lg · none · sm · md · full, `elevation` md · none · sm · lg | `<desk-toast>` |
| 배지 | `badge` | `style` soft · solid · outline, `shape` full · none · sm · md, `case` none · uppercase | `.badge` · `.desk-badge` |
| 툴팁 | `tooltip` | `shape` md · none · sm · full, `elevation` sm · none · md | `.tooltip` · `.desk-tooltip` |
| 표 | `table` | `rows` lines · striped · plain, `header` plain · muted, `size` sm · xs · md | `<desk-table>` · `.desk-table` |
| 진행 | `progress` | `thickness` normal · thin · thick, `shape` full · none | `<desk-progress>` · `.desk-progress` |
| 포커스 | `focus` | `width` normal · thin · thick, `offset` near · none · far | 모든 컴포넌트의 `:focus-visible` |

`shape` 는 테마의 모서리 단계(`radius-sm/md/lg/full`, 또는 0)를, `size` 는 컨트롤 높이 단계(`control-xs…lg`)를, `elevation` 은 그림자 단계(`shadow-sm/md/lg`)를 가리킵니다. 색 변형은 게이트가 보정한 역할 쌍에서만 고릅니다: `solid` = `primary` 위 `primary-foreground`, `soft` = `primary-soft` 위 `primary-text`, `outline` = 투명 위 `primary-text` 와 `primary-border`. `danger` 버튼은 주 버튼과 같은 변형을 `danger*` 로 그립니다.

```json
{
  "id": "local.studio-sharp",
  "name": "Studio Sharp",
  "version": "1.0.0",
  "kind": "design-system",
  "description": "Square corners, caps on buttons, underlined fields.",
  "designSystem": {
    "author": "Team endue",
    "license": "CC0-1.0",
    "origin": { "prompt": "각진 모서리에 대문자 버튼, 밑줄 입력칸" },
    "components": {
      "button": { "shape": "none", "case": "uppercase", "weight": "semibold" },
      "field": { "style": "underline", "shape": "none" },
      "tabs": { "style": "underline" },
      "row": { "selection": "bar", "shape": "none" }
    }
  }
}
```

## 요구사항

표의 *현재* 는 2026-11-05 `main`(aee9dc1) 기준(있음 · 일부 · 없음)입니다.

### 형식 · 엔진 (DH)

| ID | 요구사항 | 현재 |
| --- | --- | --- |
| DH-01 | 디자인 시스템은 메인 UI 의 코어 시스템이다. 고르기 · 컴파일 · 적용 · 스튜디오를 런타임이 갖는다 (ADR 0090) | 없음 |
| DH-02 | kind `design-system`: `plugin.json` 의 `designSystem` 블록. entry · permissions · contributes · surfaces · 자산이 없고 늘 켜져 있다 | 없음 |
| DH-03 | 카탈로그(§디자인 시스템의 모양): 15개 컴포넌트, 이름 붙은 선택지, 모든 속성에 기본값. 모르는 키는 버린다 | 없음 |
| DH-04 | 컴파일: 레시피 → 컴포넌트 토큰(`--desk-<component>-<part>`). 값은 테마 토큰의 `var()` 또는 범위 안의 고정 값(굵기 · 대소문자 · 테두리 두께)뿐이다 | 없음 |
| DH-05 | 고르기: 설정 `desk.design.active`(빈 값 = endue 디자인 시스템). 설치는 적용이 아니다. 프로필 · `init.yaml` 이 실어 나른다 | 없음 |
| DH-06 | 해석 순서: 테마 해석(TH-06) 결과 → 활성 디자인 시스템의 컴포넌트 토큰 → 동작 줄이기. 테마와 같은 경로로 셸과 모든 프레임에 리로드 없이 간다 | 없음 |
| DH-07 | 기본 컴포넌트 토큰은 `tokens.css` 에 생성되어, 런타임 없이 열린 페이지도 endue 디자인 시스템으로 그려진다 | 없음 |

### 컴포넌트 계약 (DC)

| ID | 요구사항 | 현재 |
| --- | --- | --- |
| DC-01 | UI 의 모든 컨트롤은 디자인 시스템의 컴포넌트로 그린다: 셸 키트 클래스, `@endue-ai/ui` 요소, 또는 `base.css` 의 키트 클래스 | 일부 (셸 키트 · 요소는 있으나 토큰이 컴포넌트 단위가 아님, 플러그인은 네이티브 컨트롤 약 250개) |
| DC-02 | 세 가지 구현(셸 키트 · 요소 · 키트 클래스)은 같은 컴포넌트 토큰을 읽는다. 하나를 바꾸면 셋이 같이 바뀐다 | 없음 |
| DC-03 | 버튼 변형은 의미로 고른다: 기본(secondary) · `primary` · `danger` · `quiet`. 모양은 디자인 시스템이 정한다 | 일부 (셸 `.btn-primary/-outline/-ghost`) |
| DC-04 | `scripts/ds-lint.mjs` 가 `just check` 에서 래칫으로 지킨다: 키트 클래스 없는 네이티브 `button` · `input` · `select` · `textarea` 를 대상별 baseline 으로 센다. 숨은 · 파일 · 범위 · 색 입력과 `ds: own` 주석은 예외 | 없음 |
| DC-05 | 컴포넌트의 글자 · 바탕 쌍은 게이트가 보정한 역할 쌍에서만 나온다. 어떤 테마 × 디자인 시스템 조합도 대비를 깨지 않는다 | 없음 |

### 스튜디오 (DS) — 메인 UI

| ID | 요구사항 | 현재 |
| --- | --- | --- |
| DS-01 | 디자인 시스템 스튜디오는 셸의 시스템 창이다: 커맨드 `desk.design.studio`(팔레트 "Design systems"), 테마 스튜디오에서 건너가기 | 없음 |
| DS-02 | 갤러리: endue · 기본 제공 · 내 것 · 받은 것을 카드로. 카드는 자기 토큰으로 그린 견본(버튼 · 입력칸 · 탭 · 배지 · 행)이다. 포커스는 미리보기, Enter 는 적용, Esc 는 되돌림 | 없음 |
| DS-03 | 다듬기: 컴포넌트별 선택지 편집기, 데스크 전체 실시간 미리보기, "내 디자인 시스템으로 저장"(`local.<이름>`) | 없음 |
| DS-04 | 공유: `.desk-design` 내보내기 · 가져오기(파일 열기 · 끌어놓기) | 없음 |
| DS-05 | 마켓: 색인의 디자인 시스템을 카드로 보고, 미리보고, 받는다(해시 확인) | 없음 |
| DS-06 | 말하기: 한 문장 → `brain.ask`(도구 `propose_design_system`) → 정리 → 미리보기 → 적용 · 다듬기 · 버리기. 오프라인이면 말하기만 닫힌다 | 없음 |

### Eris · 에이전트 (DE)

| ID | 요구사항 | 현재 |
| --- | --- | --- |
| DE-01 | agent 커맨드(ADR 0088): `desk.design.list` · `desk.design.get`(읽기), `desk.design.use` · `desk.design.default` · `desk.design.set`(컴포넌트 값 바꾸기) · `desk.design.export` · `desk.design.import` | 없음 |
| DE-02 | `desk.design.set` 은 활성 디자인 시스템이 사람의 것(`local.`)이면 그것을 고치고, 아니면 바뀐 사본을 `local.` 로 저장해 고른다. 기본 제공 · 받은 것은 덮어쓰지 않는다 | 없음 |
| DE-03 | Eris 에게 "디자인 시스템" 을 말하면(예: "디자인 시스템을 각지게 바꿔줘") 스튜디오의 말하기가 그 문장으로 열린다. 사람이 만드는 앱의 디자인 이야기는 대화에 남는다 | 없음 |
| DE-04 | 사람과 Eris 는 같은 커맨드 · 같은 저장 경로를 쓴다. 둘 중 무엇으로 바꿔도 스튜디오 · 설정 · 프로필에 같은 상태가 보인다 | 없음 |

### 전달 · 공유 (DT)

| ID | 요구사항 | 현재 |
| --- | --- | --- |
| DT-01 | 사용자 디자인 시스템은 사용자 테마 폴더(`<data>/themes/<id>/`)에 산다. `theme.save` · `theme.import` · `theme.export` · `theme.remove` 가 kind `design-system` 도 받는다 (ADR 0091) | 없음 |
| DT-02 | `.desk-design`: `.desk-theme` 과 같은 묶음 형식(`desk-theme/1`), 매니페스트의 kind 가 `design-system`. 자산이 없다 | 없음 |
| DT-03 | 마켓 색인 항목의 `kind`(기본 `theme`). 첫 마켓은 이 레포의 `market/design-systems/index.json` 이고 `desk.theme.markets` 기본값에 들어간다. `scripts/theme-market.mjs` 가 검사한다 | 없음 |
| DT-04 | 기본 제공 디자인 시스템: endue(기본값) 와 쇼케이스 둘 이상(`plugins/design-*`) | 없음 |

### 이주 (DM)

| ID | 요구사항 | 현재 |
| --- | --- | --- |
| DM-01 | 셸 키트 · `@endue-ai/ui` 요소 · 두 스튜디오가 컴포넌트 토큰을 읽는다 | 없음 |
| DM-02 | 플러그인은 물결(wave)로 키트 클래스 · 요소로 옮기고, 물결마다 ds-lint baseline 이 내려간다. 0 이 된 플러그인은 baseline 파일을 지운다 | 없음 |

## 권장안과 대안

| 안 | 내용 | 판단 |
| --- | --- | --- |
| A | 테마에 일곱 번째 층 `components` 를 더한다 | 기각. 테마와 따로 고를 수 없고, "디자인 시스템도 테마처럼 여러 개" 를 만족하지 못한다 |
| **B (권장)** | 별개의 코어 시스템(kind `design-system`, `desk.design.active`). 저장 · 묶음 · 마켓은 테마 파이프라인을 같이 쓴다 | 채택. 고르기는 독립, 전달은 검증된 경로 하나 (ADR 0090 · 0091) |
| C | B 와 같되 브리지 `design.*` 메서드 · 권한 · 폴더 · 마켓을 따로 둔다 | 기각. 같은 일을 하는 경로가 둘이 되고, 코드 · 스펙 · 테스트가 두 배다 |
| D | 디자인 시스템을 스타일시트로 둔다(셸 CSS 를 덮어쓰기) | 기각. 코드 없는 데이터라는 원칙(ADR 0057)과 CSP, 검증 가능성이 깨진다 |

## 단계

| 단계 | 끝나는 조건 | 담는 것 |
| --- | --- | --- |
| D0 코어 | 갤러리에서 디자인 시스템을 바꾸면 셸 · 요소 · 키트 클래스가 리로드 없이 같이 바뀐다. 기본값은 오늘의 모양 | DH 전부, DC-01–05, DS-01–04, DE-01–04, DT 전부, DM-01 |
| D1 말하기 · 마켓 | 문장 하나가 디자인 시스템 하나가 되고, 마켓에서 받아 미리본다 | DS-05 · DS-06 |
| D2 이주 | 모든 플러그인의 ds-lint baseline 이 0 | DM-02 |

## 결정 기록

| 질문 | 결정 |
| --- | --- |
| 디자인 시스템과 테마는 하나인가 | 둘이다. 테마는 값, 디자인 시스템은 컴포넌트의 구성이고 따로 고른다 |
| 디자인 시스템의 자리 | 메인 기능. 테마 스튜디오와 같은 레벨의 시스템 창이고 플러그인이 아니다 |
| 사람이 바꾸나 Eris 가 바꾸나 | 둘 다. 같은 커맨드와 저장 경로를 쓴다 (DE-04) |
| 여러 개 · 공유 | 기본 제공 · 내 것 · 받은 것을 갤러리에 두고, `.desk-design` 파일과 마켓으로 나눈다 |
| 저장 경로 | 테마와 같은 사용자 폴더 · 브리지 · 권한(ADR 0091) |
