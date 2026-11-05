# endue Desk 채팅(Chat) 요구사항

2026-11-04 · Team endue

> Slack · Discord · Microsoft Teams · Telegram · Matrix · IRC 같은 여러 채팅 서비스를 *하나의 인터페이스* 에서 읽고, 답하고, 정리하기 위한 문서입니다. 채팅 표면은 UI 플러그인 **`endue.chat`**(`plugins/chat`)이 맡고, 채팅을 *가져오는* 일은 서비스마다의 커넥터 플러그인(ADR 0032, `specs/connector/v0`)이 맡습니다. 한눈에 보는 대시보드는 데이터만 있는 뷰 플러그인 **`endue.chat-digest`**(`plugins/chat-digest`)를 `desk.views` 가 그립니다. 요구사항 한 줄이 Task 이슈 하나의 요구사항 칸이 됩니다. 코드와 어긋나면 이 문서를 고치고, 되돌리기 어려운 갈림길은 ADR 로 남깁니다.

채팅 플러그인은 메일 플러그인(`docs/ko/mail-requirements.md`)과 같은 길을 갑니다. 색인의 `message` 항목을 `data.query` · `data.subscribe` 로 *읽기만* 하고(권한 `data:read`), 보내기 · 반응 · 읽음 · 고치기 · 지우기는 커넥터가 제공하는 커맨드(`<커넥터>.chat.send` · `.chat.react` · `.chat.read` · `.chat.edit` · `.chat.delete`)를 `cmd.invoke` 로 부릅니다. 그래서 어떤 서비스의 커넥터를 꽂아도 채팅 화면은 같고, 서비스가 늘어도 화면을 고치지 않습니다.

## 목표를 이루는 데 필요한 것 (리스트업)

| # | 필요한 것 | 어디서 | 이번 PR |
| --- | --- | --- | --- |
| 1 | 여러 서비스의 메시지를 담는 *한 모델*: `message` 항목 + 채팅 프로필(`raw.channel` 등, 아래 §채팅 프로필) | 이 문서, `plugins/chat/README.md` | 있음 |
| 2 | 서비스와 상관없는 *한 행동 규약*: `<커넥터>.chat.{send,react,read,edit,delete}` | 이 문서, `plugins/chat/ui/actions.js` | 있음 |
| 3 | 통합 채팅 UI 플러그인 `endue.chat`: 서비스 · 워크스페이스 · 대화 탐색, 읽기, 쓰기, 스레드, 반응 | `plugins/chat` | 있음 |
| 4 | 다양한 뷰: 대화(Conversation) · 받은 메시지(Inbox) · 타임라인(Timeline) · 칼럼(Columns), 스마트 필터 5개, 밀도 2개 | `plugins/chat` | 있음 |
| 5 | 한눈에 보는 대시보드 뷰(데이터만): 안 읽은 수 · 멘션 · DM · 최근 대화 | `plugins/chat-digest` | 있음 |
| 6 | 메일과 채팅의 분리: 메일함은 `raw.channel` 이 있는 항목을 보이지 않는다 | `plugins/mail/ui/model.js` | 있음 |
| 7 | 키보드 · 팔레트 · Eris · 에이전트가 같은 커맨드 19개로 움직이고, 팔레트에서 대화를 바로 찾는다(팔레트 제공자) | `plugins/chat/plugin.json` | 있음 |
| 8 | 서비스별 커넥터(Slack Web API, Discord REST, ...) | 커넥터 플러그인 | 없음 — §명세에 필요한 것의 비밀 주입이 먼저 |
| 9 | 실시간 푸시(Slack Events · Socket Mode, Discord Gateway) | 커넥터 + 호스트 | 없음 — `net.fetch` 는 HTTP 만, 웹소켓 없음 |

## 결정

| 갈림길 | 결정 | 이유 |
| --- | --- | --- |
| 채팅을 누가 가져오는가 | 커넥터 플러그인. 채팅 플러그인은 색인의 `message` 항목만 읽는다 | ADR 0032 의 한 모델 · 한 색인. 서비스 토큰은 코어만 쥔다(`instanceSettings.secret`) |
| 채팅 메시지는 어떤 종류인가 | 새 종류를 만들지 않고 `message`. 채팅임은 `raw.channel` 이 있음으로 안다 | ADR 0032 는 다섯 커넥터 전까지 종류 수를 늘리지 않는다. `message` 의 `from` · `receivedAt` · `unread` · `thread` 가 채팅에도 맞다 |
| 메일과 섞이지 않게 | 메일함 질의마다 `raw.channel exists false`, 채팅 질의마다 `raw.channel exists` | `exists` 는 색인(SQLite)과 스텁이 같은 뜻으로 답한다. 한 조건으로 둘이 깔끔히 갈린다 |
| 서비스를 어떻게 아는가 | `raw.platform`, 없으면 커넥터 id 의 마디(`acme.slack` → slack), 그것도 없으면 "Chat" | 커넥터 id 만으로도 대부분 맞고, 사내 커넥터는 `raw.platform` 으로 말한다 |
| 서비스 표시 | 이름 글자 + 테마의 차트 색(`--desk-chart-1…8`). 로고 · 상표 이미지는 쓰지 않는다 | 테마가 모든 색을 정한다(ui-lint). 남의 상표 자산을 저장소에 두지 않는다 |
| 대화 목록을 어떻게 아는가 | 최근 채팅 메시지 500개와 안 읽은 메시지 500개를 읽어 대화로 묶는다 | 색인에 대화(채널) 항목이 없다. 두 질의로 목록 · 최신 · 안 읽은 수 · 멘션 수가 나온다 |
| 스레드 | 답글은 `thread` 가 뿌리 메시지 id 이고 `thread ≠ id`. 본 타임라인에선 숨기고 뿌리에 답글 수, 오른쪽 스레드 창에서 읽고 쓴다. `raw.broadcast` 는 본 타임라인에도 | Slack 스레드 · Discord 스레드 · Teams 답글이 모두 이 모양으로 옮겨진다 |
| 본문 서식 | 공통 마크다운 일부(굵게 · 기울임 · 취소선 · 코드 · 코드 블록 · 인용 · 링크 · 멘션 · 채널 · `:이모지:`)를 DOM 노드로만 그린다. HTML 은 그리지 않는다 | `innerHTML` 없이 그려 스크립트 · 원격 자원 · 추적 픽셀이 없다. 서비스마다의 서식 변환은 커넥터의 일 |
| 링크 | `shell.open` 으로 http · https · mailto 만 연다(ADR 0047) | 프레임 안에서 아무것도 내려받지 않는다 |
| 보내기의 낙관적 표시 | 보낸 글은 "보내는 중" 으로 바로 보이고, 커넥터가 돌려준 `id` 또는 내 글(`raw.self`)이 색인에 오면 바뀐다. 거절되면 "보내지 못함" 과 다시 보내기 | 채팅은 즉시성이 핵심. 색인의 `data.changed` 가 최종 |
| 지우기 | 사람이 누를 땐 팔레트로 한 번 확인. 에이전트가 부르면 ADR 0078 의 승인 대기를 따른다 | 되돌릴 수 없는 행동 |
| 자리 | 표면 `center` 하나. 스레드 창 · 작성 칸은 같은 표면 안 | 메일과 같은 배치 원칙. `ui:surface` 를 넓히지 않는다 |
| 상태 | 설정 6개는 settings, 보던 뷰 · 필터 · 대화 · 고정 칼럼 · 임시 글 · 저장한 메시지는 store | 설정은 사람이 바꾸는 값, store 는 작업 상태 |
| 공개 SDK 만 | 커뮤니티 플러그인과 같은 형식 | 규칙 9 |

## 채팅 프로필 (`message` 항목의 `raw`)

`raw.channel` 이 있으면 채팅 메시지입니다. 나머지는 모두 선택이고, 없으면 괄호 안의 기본값입니다.

| 필드 | 뜻 |
| --- | --- |
| `channel` | 대화 id(인스턴스 안에서 유일). Slack 채널 · DM, Discord 채널 · 스레드 채널, Teams 채팅 |
| `channelName` | 보이는 이름("general", DM 이면 상대 이름). (channel) |
| `channelKind` | `channel` · `private` · `dm` · `group`. (channel) |
| `platform` | `slack` · `discord` · `teams` · `telegram` · `matrix` · `irc` · `whatsapp` · `signal` · `mattermost` · `rocketchat` · `zulip` · `googlechat` · `line` · `kakaotalk` · 그 밖의 문자열. (커넥터 id 에서) |
| `workspace` | 워크스페이스 · 서버(길드) · 팀 이름. (인스턴스 이름) |
| `topic` | 대화 주제. 가장 최근 메시지의 값을 쓴다 |
| `self` | 내가 보낸 글. 고치기 · 지우기는 내 글에만 |
| `mentioned` | 나를 부른 글(@me, @here 은 커넥터가 정한다) |
| `replyCount` · `lastReplyAt` | 뿌리 메시지의 답글 수 · 마지막 답글 시각 |
| `broadcast` | 스레드 답글이지만 채널에도 보인다 |
| `reactions` | `[{ emoji, count, self? }]`. `emoji` 는 유니코드 또는 `:name:` |
| `attachments` | `[{ name, mime?, size?, url? }]`. `url` 은 `shell.open` 으로 |
| `editedAt` · `pinned` · `bot` | 고친 시각 · 고정됨 · 봇 |

봉투는 그대로: `from`(이름), `receivedAt`(보낸 시각), `unread`, `body`(본문), `title`(첫 줄), `thread`, `deepLink`(원래 앱).

## 커넥터 행동 규약

| 커맨드 | 인자 | 결과 |
| --- | --- | --- |
| `<커넥터>.chat.send` | `{ instance, channel, text, thread? }` | `{ id? }` 새 메시지 id |
| `<커넥터>.chat.react` | `{ instance, channel, id, emoji, on }` | — |
| `<커넥터>.chat.read` | `{ instance, channel, id }` 이 메시지까지 읽음 | — |
| `<커넥터>.chat.edit` | `{ instance, channel, id, text }` | — |
| `<커넥터>.chat.delete` | `{ instance, channel, id }` | — |

`cmd.list`(자기 패턴 scope)로 커넥터가 제공하는 것만 버튼을 켭니다. 없는 행동은 "acme.slack cannot react: it provides no acme.slack.chat.react." 처럼 문장으로 말합니다.

## 필수 기능 (1단계, `plugins/chat`)

1. **탐색**: 서비스 칩(전체 · 서비스별, 안 읽은 수), 스마트 필터 5개(All · Unread · Mentions · Direct · Saved), 워크스페이스별로 묶은 대화 목록(DM 은 따로), 대화마다 안 읽은 수 · 멘션 뱃지 · 고정 표시.
2. **뷰 4개**: *Conversation*(목록 · 타임라인 · 스레드 창), *Inbox*(안 읽은 대화를 카드로, 멘션 · DM 먼저, 카드에서 바로 답장 · 읽음), *Timeline*(모든 서비스의 메시지를 한 줄기로, 필터 · 검색 적용), *Columns*(고정한 대화를 나란히, 없으면 최근 대화 3개, 칼럼마다 작성 칸). `1` `2` `3` `4` · 도구 막대 · `endue.chat.layout`.
3. **타임라인**: 날짜 구분선, "새 메시지" 구분선, 같은 사람의 5분 안 연속 글 묶기, 아바타(이니셜 + 테마 색), 고친 표시 · 봇 · 고정, 반응 칩(누르면 토글), 첨부, 답글 수, "이전 메시지" 로 커서 페이지.
4. **쓰기**: 대화 · 스레드 · 카드 · 칼럼마다 작성 칸과 임시 글(store, 300 ms 디바운스). Enter 보내기 · Shift+Enter 줄바꿈(설정 `enter-sends`), 빈 칸에서 ↑ 는 내 마지막 글 고치기, Escape 는 고치기 취소.
5. **행동**: 보내기 · 스레드 답장 · 반응(빠른 6개 + 팔레트) · 고치기 · 지우기(확인) · 읽음 · 모두 읽음 · 저장 · 칼럼 고정. 낙관적 표시, 거절은 되돌리고 문장으로.
6. **검색**: `ItemQuery.text` 를 모든 서비스에, 결과는 Timeline 에. `/` 또는 팔레트.
7. **실시간 · 알림**: `data.subscribe { kinds: [message], where: [raw.channel exists] }`. 새 DM · 멘션은 `ui.notify`(설정 `notify`: `mentions` · `all` · `none`). 열려 있는 대화는 열면 읽음(`mark-read: open`).
8. **커맨드 19개 · 키 1개 · 팔레트 제공자 1개**: `endue.chat.{open,show,conversation,layout,filter,platform,search,refresh,next-unread,send,reply,react,edit,delete,mark-read,mark-all-read,save,pin,find}`, `Mod+Shift+J`, 팔레트의 "Chats" 묶음(`endue.chat.find`). 에이전트는 `{ source, channel, text }` 로 열지 않은 대화에도 보낸다. `send` · `delete` 는 `irreversible` 이라 에이전트가 부르면 사람의 승인을 기다린다(ADR 0078).
9. **대시보드** `endue.chat-digest`: stat(안 읽은 채팅) · list(멘션, DM) · table(최근 대화). 항목의 행동은 `endue.chat.show`.

## 요구사항

*현재* 는 이 PR 기준입니다.

### 탐색 · 읽기 (CHAT-01 ~ 12)

| ID | 요구사항 | 현재 | 단계 |
| --- | --- | --- | --- |
| CHAT-01 | 채팅 프로필 읽기: `raw.channel` 이 있는 `message` 만, 모든 기본값 포함 | 있음 | 1 |
| CHAT-02 | 서비스 판별: `raw.platform` → 커넥터 id 마디 → "Chat". 알려진 14개는 이름 · 두 글자 · 색 | 있음 | 1 |
| CHAT-03 | 대화 목록: 최근 500 + 안 읽은 500 질의로 대화 · 최신 · 안 읽은 수 · 멘션 수. 정렬은 최신 순 | 있음 | 1 |
| CHAT-04 | 워크스페이스별 묶음, DM · 그룹 DM 은 "Direct messages" 묶음 | 있음 | 1 |
| CHAT-05 | 대화 열기: `raw.channel eq` · 출처 하나 · 최신 `page` 개를 오래된 순으로. "Load earlier" 는 커서 | 있음 | 1 |
| CHAT-06 | 날짜 구분선 · 새 메시지 구분선 · 5분 묶기 | 있음 | 1 |
| CHAT-07 | 스레드: 답글은 본 타임라인에서 숨기고(`broadcast` 제외) 뿌리에 답글 수, 스레드 창은 `thread eq` 오래된 순 | 있음 | 1 |
| CHAT-08 | 본문 서식: 굵게 · 기울임 · 취소선 · 인라인 코드 · 코드 블록 · 인용 · 링크(`<url|label>` 포함) · @멘션 · #채널 · `:shortcode:` 를 DOM 으로만 | 있음 | 1 |
| CHAT-09 | 반응 칩 · 첨부(이름 · 크기, `url` 은 열기) · 고친 표시 · 봇 · 고정 | 있음 | 1 |
| CHAT-10 | 원래 앱으로(`deepLink`) | 있음 | 1 |
| CHAT-11 | 이미지 · 미리보기 카드(원격 자원) | 없음 (결정: 1단계는 이름만) | 2 |
| CHAT-12 | 사용자 프로필 · 상태(접속 중) — `person` 항목과 잇기 | 없음 | 2 |

### 뷰 (CHAT-20 ~ 27)

| ID | 요구사항 | 현재 | 단계 |
| --- | --- | --- | --- |
| CHAT-20 | Conversation: 목록 · 타임라인 · 스레드 창 세 칸, 좁으면 스레드 창이 위로 덮는다 | 있음 | 1 |
| CHAT-21 | Inbox: 안 읽은 대화마다 카드(최근 안 읽은 3개), 멘션 → DM → 최신 순, 카드에서 답장 · 읽음 · 열기 | 있음 | 1 |
| CHAT-22 | Timeline: 모든 서비스를 한 줄기로(최신이 위), 대화 표지, 필터 · 서비스 · 검색 적용, 누르면 그 대화 | 있음 | 1 |
| CHAT-23 | Columns: 고정한 대화(최대 6) 또는 최근 3개를 칼럼으로, 칼럼마다 작성 칸 · 고정 해제 | 있음 | 1 |
| CHAT-24 | 스마트 필터: All · Unread · Mentions · Direct · Saved, 목록과 Timeline 에 적용 | 있음 | 1 |
| CHAT-25 | 밀도: comfortable · compact(설정 `density`) | 있음 | 1 |
| CHAT-26 | 대시보드 뷰 `endue.chat-digest`(stat · list · table) | 있음 | 1 |
| CHAT-27 | 칸반(서비스별) · 차트(시간대별 메시지 수) — `desk.views` 의 kanban · chart 가 먼저 | 없음 | 2 |

### 쓰기 · 행동 (CHAT-30 ~ 38)

| ID | 요구사항 | 현재 | 단계 |
| --- | --- | --- | --- |
| CHAT-30 | 행동 규약 5개, `cmd.list` 로 있는 것만 켠다 | 있음 | 1 |
| CHAT-31 | 보내기: 보내는 중 → 확정(결과 `id` 또는 내 글 도착) · 실패 → 다시 보내기 | 있음 | 1 |
| CHAT-32 | 반응 · 읽음 · 고치기 · 지우기의 낙관적 갱신과 되돌리기 | 있음 | 1 |
| CHAT-33 | 임시 글: 대화 · 스레드마다 store `drafts`, 300 ms 디바운스, 재시작 뒤 그대로 | 있음 | 1 |
| CHAT-34 | Enter 보내기 · Shift+Enter 줄바꿈(`enter-sends` false 면 Mod+Enter), ↑ 마지막 내 글 고치기 | 있음 | 1 |
| CHAT-35 | 지우기 확인(팔레트 pick), 에이전트는 ADR 0078 | 있음 | 1 |
| CHAT-36 | 저장(Saved): store `saved` 의 키, `data.get` 으로 읽기(최대 100) | 있음 | 1 |
| CHAT-37 | 파일 올리기 — `fs:read` 와 커넥터의 `chat.upload` 가 먼저 | 없음 | 2 |
| CHAT-38 | 멘션 자동완성 — 대화 참여자 목록(`person` 항목) | 없음 | 2 |

### 실시간 · 알림 (CHAT-40 ~ 43)

| ID | 요구사항 | 현재 | 단계 |
| --- | --- | --- | --- |
| CHAT-40 | `data.changed` 로 새 글은 끼어들고, 바뀐 글은 갱신, 빠진 글은 떠난다. 목록 · 카운트는 디바운스 재계산 | 있음 | 1 |
| CHAT-41 | 알림: 시작 뒤 새로 온 안 읽은 DM · 멘션(`mentions`), 모든 글(`all`), 끔(`none`). 내 글 · 지금 보는 대화는 알리지 않는다 | 있음 | 1 |
| CHAT-42 | 열린 대화는 열면 읽음(`mark-read: open`, 마지막 메시지 id 로 `chat.read`) | 있음 | 1 |
| CHAT-43 | 타이핑 표시 · 접속 상태 — 커넥터 푸시가 먼저 | 없음 | 2 |

### 권한 · 안전 (CHAT-50 ~ 53)

| ID | 요구사항 | 현재 | 단계 |
| --- | --- | --- | --- |
| CHAT-50 | `data:read { kinds: [message] }` · `cmd:invoke { *.chat.send, *.chat.react, *.chat.read, *.chat.edit, *.chat.delete, desk.palette.pick }` · `ui:notify` · `shell:open { http, https, mailto }` | 있음 | 1 |
| CHAT-51 | 읽기 거절은 세션에 한 번 `perm.request`, 다시 거절되면 문장으로 | 있음 | 1 |
| CHAT-52 | 본문 · 이름 · 주제는 `textContent` 로만, `innerHTML` 없음(테스트가 `<script>` 를 넣어 본다) | 있음 | 1 |
| CHAT-53 | `javascript:` · `data:` · `file:` 링크는 열지 않고 글자로 둔다 | 있음 | 1 |

### 설정 · 상태 (CHAT-60 ~ 62)

| ID | 요구사항 | 현재 | 단계 |
| --- | --- | --- | --- |
| CHAT-60 | 설정 6개: `page`(100, 최대 500) · `notify` · `mark-read` · `enter-sends` · `density` · `quick-reactions` | 있음 | 1 |
| CHAT-61 | store `view`(뷰 · 필터 · 서비스 · 대화 · 칼럼) · `drafts` · `saved`, 재시작 뒤 같은 자리 | 있음 | 1 |
| CHAT-62 | 상태 줄 `role=status`, 실패는 문장, 다음 성공이 비운다 | 있음 | 1 |

### 접근성 (CHAT-70 ~ 73)

| ID | 요구사항 | 현재 | 단계 |
| --- | --- | --- | --- |
| CHAT-70 | 메시지 목록은 `role=log` + 메시지마다 `role=article`, 대화 목록은 `role=listbox`(roving tabindex) | 있음 | 1 |
| CHAT-71 | 글자 키: `j` `k` 메시지, `[` `]` 대화, `n` 다음 안 읽은 대화, `r` 스레드, `e` 고치기, `+` 반응, `s` 저장, `m` 읽음, `c` 작성 칸, `/` 검색, `1`–`4` 뷰, Escape. Mod 조합은 데스크로 통과 | 있음 | 1 |
| CHAT-72 | 뱃지 · 반응 · 서비스 칩에 aria-label("3 unread, 1 mention") | 있음 | 1 |
| CHAT-73 | 움직임 줄이기(`prefers-reduced-motion`) · 모든 색은 테마 토큰(ui-lint) | 있음 | 1 |

### 품질 (CHAT-90 ~ 93)

| ID | 요구사항 | 현재 | 단계 |
| --- | --- | --- | --- |
| CHAT-90 | 모델 · 서식 · 묶기는 순수 함수와 Node 테스트, 흐름은 SDK 테스트 호스트, DOM 은 jsdom | 있음 | 1 |
| CHAT-91 | `plugin.json` 이 스키마를 통과하고, `cmd:invoke` 패턴이 코드가 부르는 커맨드를 정확히 덮는다 | 있음 | 1 |
| CHAT-92 | 파일 400줄 · README 40줄 이하 | 있음 | 1 |
| CHAT-93 | 실제 커넥터와의 e2e(Slack · Discord 샌드박스) | 없음 | 2 |

## 명세에 필요한 것 (`specs/`, 유지보수자의 몫)

1. **채팅 프로필을 명세로**: 위 §채팅 프로필을 `specs/connector/v0/README.md` 의 프로필 절로(메일의 `raw.mailbox` 와 함께). 다섯 커넥터가 생기면 `message` 를 넘어 `chat` 종류가 필요한지 다시 본다(ADR 0032).
2. **행동 이름 규약**: `resources[].actions` 에 `chat.send` 같은 *역할* 이름을 둘 수 있게. 지금은 커맨드 id 의 꼬리로 안다.
3. **비밀 주입**: Wasm 커넥터는 비밀을 받지 못한다(ADR 0036). Slack · Discord 토큰으로 HTTP 를 부르려면 `net.fetch` 가 헤더 값 `{secret:token}` 을 호스트에서 채워 주는 방식(코드에는 끝까지 안 보임, `net:fetch` scope 의 호스트에만)이 필요하다. ADR 과 `desk-host.wit` 변경.
4. **OAuth 흐름**: `auth.kind: oauth` 는 선언만 있다. Slack · Discord · Teams 앱 설치는 OAuth 라 흐름이 필요하다.
5. **푸시**: Slack Socket Mode · Discord Gateway 는 웹소켓. Wasm 호스트에 웹소켓이 없어 MCP 바인딩(VM) 또는 호스트 소켓이 필요하다. 그 전엔 `sync.intervalSeconds` 60 의 당기기.

## 단계

1. 이 PR: `endue.chat` · `endue.chat-digest` · 메일 분리 · 이 문서.
2. 비밀 주입(§3) 뒤 `endue.slack` · `endue.discord` 커넥터(당기기), 이미지 미리보기, 파일 올리기, 멘션 자동완성.
3. 푸시(§5) 뒤 타이핑 · 접속 상태 · 즉시 도착, Teams · Telegram · Matrix 커넥터.

## 하지 않는 것

- 음성 · 영상 통화, 화면 공유.
- 서비스 고유 기능(Slack 워크플로, Discord 역할 관리, 서버 설정)은 각 서비스 앱으로(`deepLink`).
- HTML 본문 그리기, 원격 이미지 자동 로드.

## 열린 질문

- 같은 사람이 여러 서비스에 있을 때 하나로 묶을까(`person` 항목의 `emails` 로)?
- 채널 목록(메시지 없는 채널)을 색인에 둘까 — `record` 종류의 `channel` 스키마?
