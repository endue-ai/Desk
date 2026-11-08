# endue Desk 메일(Mail) 요구사항

2026-10-31 · Team endue

> `desk-requirements.md` 의 기본 플러그인 표에서 `calendar · mail` 행이 "endue 커넥터 표면(장면 6 · 7)" 으로 비워 둔 자리 가운데 *메일* 을 채우는 문서입니다. 메일 표면은 UI 플러그인 **`endue.mail`**(`plugins/mail`)이 맡고, 메일을 *가져오는* 일은 커넥터 플러그인(ADR 0032, `specs/connector/v0`)이 맡습니다. 요구사항 한 줄이 Task 이슈 하나의 요구사항 칸이 됩니다. 코드와 어긋나면 이 문서를 고치고, 되돌리기 어려운 갈림길은 ADR 로 남깁니다.

메일 플러그인은 색인을 *읽는* 플러그인이지 *쓰는* 플러그인이 아닙니다. `data.query` · `data.subscribe` 로 `message` 항목을 읽고(권한 `data:read`), 읽음 · 깃발 · 보관 · 보내기 같은 모든 변경은 커넥터가 제공하는 커맨드(`<커넥터>.mail.send` · `.mail.move` · `.mail.flag`)를 `cmd.invoke` 로 부릅니다. 그래서 IMAP · JMAP · Gmail · 사내 메일 어떤 커넥터를 꽂아도 메일 표면은 같고, 메일 표면을 다른 것으로 갈아끼워도 "어디서 가져오고 어떻게 보내는가" 는 바뀌지 않습니다.

## 결정

| 갈림길 | 결정 | 이유 |
| --- | --- | --- |
| 메일을 누가 가져오는가 | 커넥터 플러그인. 메일 플러그인은 색인의 `message` 항목만 읽는다 | ADR 0032 의 한 모델 · 한 색인. IMAP 소켓은 브리지에 없고(`net.fetch` 는 HTTP 만), 계정 비밀은 코어의 키체인에만 둔다(`instanceSettings.secret`) |
| 변경은 어떻게 하는가 | 커넥터의 커맨드 세 개를 이름 규약으로 부른다: `<커넥터>.mail.send` · `.mail.move` · `.mail.flag` | ADR 0032 "행동은 커맨드"(`data:write` 없음). 팔레트 · Eris · 에이전트 · 뷰가 같은 id 를 부른다. 규약은 커넥터 명세의 `resources[].actions` 에 올라야 할 것(§명세에 필요한 것) |
| 메일함을 어떻게 나누는가 | `raw.mailbox` 의 *역할* 여섯(inbox · archive · sent · drafts · trash · junk), 없으면 inbox. 받은편지함 = 다른 다섯이 아닌 것(`ne` 조건 다섯) | `ItemQuery.where` 는 AND 만 있고 `ne` 는 빠진 필드에 참이라 "없으면 inbox" 가 질의 한 번으로 된다. 폴더 이름(사용자 폴더)은 `raw.folder` · `raw.labels` 의 몫 |
| 표준 캘린더 명세 | iCalendar(RFC 5545) 파싱 · iTIP(RFC 5546) REQUEST · CANCEL · REPLY · PUBLISH 읽기 · iMIP(RFC 6047) 로 `METHOD:REPLY` 보내기. RRULE 은 쓰인 그대로 보존 · 표시 | 초대장은 메일의 표준 캘린더 사용처다. 반복 규칙 전개 · 캘린더에 넣기는 캘린더 플러그인의 일(§하지 않는 것). 시간대는 Intl 로 풀고, 모르는 TZID 는 VTIMEZONE 의 표준 오프셋으로 근사하고 그렇다고 적는다 |
| 내가 누구인가 (답장 · RSVP) | 설정 `endue.mail.addresses`, 없으면 그 메시지의 수신자(to · cc) 가운데 참석자인 사람 | 메일 플러그인은 `connector:manage` 가 없어 계정 주소를 못 본다. 커넥터가 `send` 때 자기 발신 주소를 쓰므로 보내기엔 필요 없고, REPLY 의 ATTENDEE 와 전체 답장의 제외에만 쓴다 |
| HTML 본문 | 보여 주지 않는다. `body` 는 텍스트 · 마크다운이고 `<pre>` 로 그린다 | 샌드박스 iframe 안이라도 원격 이미지 · 추적 픽셀 · 스크립트 가능성을 열지 않는다. 변환은 커넥터가 한다 |
| 자리 | 표면 `center` 하나. 작성 창은 같은 표면 안의 패널 | 세 열(메일함 · 목록 · 읽기/작성)이 메일의 관용 배치. `ui:surface` 권한을 더 넓히지 않는다 |
| 상태를 어디에 두는가 | 설정 5개(page · notify · mark-read · signature · addresses)는 settings, 보던 메일함 · 선택 · 임시 보관함 · 초대 답변은 store | 설정은 사람이 바꾸는 값(init.yaml · 설정 UI). store 는 플러그인의 작업 상태. 임시 글은 커넥터 없이도 남아야 한다 |
| 공개 SDK 만 | 커뮤니티 플러그인과 같은 형식, 런타임 내부 API 없음 | 규칙 9. 메일이 되면 커뮤니티 메일 클라이언트도 된다 |

## 필수 기능

1단계(지금 `plugins/mail`)에 들어가는 것입니다. 전부 bridge v0 그대로 됩니다.

1. **메일함 8개**: Inbox · Unread · Flagged · Sent · Drafts · Archive · Trash · Junk. 각각 `ItemQuery` 하나(`kinds: [message]` · `raw.mailbox` 조건 · `receivedAt` 내림차순 · `page` 개씩). Drafts 는 이 플러그인이 쓴 임시 글.
2. **스레드**: 한 페이지의 메시지를 `thread` 로 묶어 한 줄로. 최신 메시지의 제목 · 보낸 사람들 · 시각 · 미리보기, 안 읽은 수 · 개수 · 깃발 · 첨부 · 초대 표식. 열면 같은 스레드의 이전 메시지를 색인에서 더 읽어 아래에 나열.
3. **읽기 창**: From · To · Cc · 날짜 · 제목 · 본문(텍스트) · 첨부 이름과 크기 · 원래 앱으로 가는 `deepLink`. 열면 설정대로 읽음 처리(`mark-read: open`).
4. **초대장 카드**: `raw.calendar`(text/calendar 부분)를 iTIP 으로 읽어 제목 · 언제(내 시간대 + 주최자 시간대) · 어디 · 주최자 · 참석자와 PARTSTAT · 반복 규칙(쓰인 그대로) · 취소 여부. Accept · Maybe · Decline 은 `METHOD:REPLY` 를 만들어 커넥터의 `send` 로 주최자에게 보내고(제목 `Accepted: …`), 답변을 store 에 기억해 카드에 적는다.
5. **행동 7개**: 답장 · 전체 답장 · 전달 · 보관 · 휴지통 · 깃발 · 읽음/안 읽음. 화면은 즉시 바뀌고(낙관적) 커넥터가 거절하면 되돌리고 문장으로 적는다. 커넥터가 제공하지 않는 행동의 버튼은 꺼진다(`cmd.list` 로 확인).
6. **작성**: To · Cc · Bcc · 제목 · 본문. 주소는 `Name <addr>` · `addr` · 쉼표 · 세미콜론 목록을 읽고 틀린 것은 문장으로. 답장은 `Re:` 한 번 · 인용(`> `) · 서명, 전체 답장은 내 주소 제외 · 중복 제거, 전달은 `Fwd:` 와 헤더 블록. `In-Reply-To` · `References` 는 `raw.messageId` · `raw.references` 에서. 임시 글은 입력 뒤 300 ms 에 store 로 자동 저장, Drafts 메일함에서 이어 쓴다.
7. **검색**: `ItemQuery.text`(제목 · 본문 · 미리보기 전문 검색)를 현재 메일함 조건과 함께. `/` 또는 팔레트(`desk.palette.pick`, free).
8. **실시간**: `data.subscribe { kinds: [message] }`. 새 항목은 메일함에 맞으면 끼어들고, 바뀐 항목은 갱신, 빠진 항목은 떠난다. 받은편지함에 새 안 읽은 메일이 오면 `ui.notify`(설정 `notify`).
9. **계정 필터**: `catalog.get` 이 알려 주는 `message` 커넥터 인스턴스들. 둘 이상이면 선택 상자, 기본은 전체.
10. **키보드**: 목록은 WAI-ARIA listbox(`role=option` · roving tabindex), `j` `k` ↑↓ Home End Enter. 글자 키 `c r a f e # s u /`, 초대엔 `y m n`, 작성은 `Mod+Enter` 보내기 · Escape 닫기(임시 글 유지). Mod 코드는 데스크로 통과.
11. **권한**: `data:read { kinds: [message] }` · `cmd:invoke { ids: [*.mail.send, *.mail.move, *.mail.flag, desk.palette.pick] }` · `ui:notify`. 읽기 거절은 세션에 한 번 `perm.request`, 다시 거절되면 문장으로.
12. **보존**: 메일함 · 계정 · 선택은 store `view`, 임시 글은 `drafts`, 초대 답변은 `answers`. 재시작과 표면 리로드 뒤 같은 자리.
13. **상태 줄**: `role=status`, 실패는 전부 문장으로("Not allowed to read messages.", "acme.imap cannot move mail: it provides no acme.imap.mail.move."). 다음 성공이 비운다.
14. **커맨드 15개 · 키 1개**: `endue.mail.{open,show,mailbox,search,refresh,compose,reply,forward,send,discard,archive,trash,flag,toggle-unread,rsvp}`, `Mod+Shift+I`. 팔레트 · 키 · Eris · 에이전트 · 버튼이 같은 id 를 부른다. 에이전트는 `{ source, id }` 로 열려 있지 않은 메시지도 가리킬 수 있다.

## 요구사항

*현재* 는 `plugins/mail` 의 첫 PR 기준(있음 · 일부 · 없음), *단계* 는 `desk-requirements.md` §단계의 번호입니다.

### 읽기 (MAIL-01 ~ 09)

| ID | 요구사항 | 현재 | 단계 |
| --- | --- | --- | --- |
| MAIL-01 | 메일함 8개가 각각 `ItemQuery` 하나. 받은편지함은 `raw.mailbox` 가 archive · sent · drafts · trash · junk 가 아닌 것(없으면 inbox) | 있음 | 1 |
| MAIL-02 | 페이지: `endue.mail.page`(기본 50, 최대 500)개씩, "Show more" 가 `cursor` 로 다음 페이지를 이어 붙인다 | 있음 | 1 |
| MAIL-03 | 스레드 묶기: 같은 `source` 의 같은 `thread`. 최신이 대표, 안 읽은 수 · 개수 · 참여자 | 있음 | 1 |
| MAIL-04 | 읽기 창: 헤더 네 줄 · 본문 텍스트 · 첨부 이름/크기 · 원래 앱 링크 · 스레드의 이전 메시지(색인에서 `thread eq` 로 보충) | 있음 | 1 |
| MAIL-05 | 받은편지함 안 읽은 수 뱃지(500 넘으면 "500+"), 변경마다 디바운스 재계산 | 있음 | 1 |
| MAIL-06 | 열면 읽음(`mark-read: open`), `never` 면 손으로만 | 있음 | 1 |
| MAIL-07 | 본문의 링크 인식 · 인용 접기 · 긴 본문 접기 | 없음 | 2 |
| MAIL-08 | HTML 본문의 안전한 렌더링(원격 자원 차단 · 스크립트 제거), 또는 커넥터의 텍스트 변환 품질 규약 | 없음 (결정: 1단계는 텍스트만) | 2 |
| MAIL-09 | 첨부 열기 · 저장 — 커넥터의 `mail.attachment` 행동과 `fs:write` 가 먼저 | 없음 | 2 |

### 초대장 · 표준 캘린더 (MAIL-10 ~ 19)

| ID | 요구사항 | 현재 | 단계 |
| --- | --- | --- | --- |
| MAIL-10 | RFC 5545 내용 줄: 접기/펼치기(75 옥텟, UTF-8 경계) · 파라미터(따옴표 · RFC 6868) · TEXT 이스케이프 · 컴포넌트 트리. 읽을 수 없는 줄은 건너뛰고 문장으로 적는다, 던지지 않는다 | 있음 | 1 |
| MAIL-11 | 값: DATE · DATE-TIME(UTC · TZID · 부동) · DURATION · UTC-OFFSET. DTEND 없으면 DURATION, 그것도 없으면 종일은 +1일 · 시각은 같은 순간(§3.6.1) | 있음 | 1 |
| MAIL-12 | 시간대: IANA TZID 는 Intl 로(DST 포함, 틈은 뒤로 · 겹침은 앞 오프셋), Olson 경로 꼬리(`/mozilla.org/…/Europe/Berlin`) · `X-LIC-LOCATION` 인식, 그 밖은 VTIMEZONE 의 STANDARD 오프셋으로 근사하고 "근사" 라고 적는다. 부동 시간은 내 시간대로 보이고 그렇다고 적는다 | 있음 | 1 |
| MAIL-13 | iTIP 읽기: METHOD REQUEST · CANCEL · REPLY · PUBLISH · ADD, UID · SEQUENCE · DTSTAMP · RECURRENCE-ID · ORGANIZER · ATTENDEE(CN · PARTSTAT · ROLE · RSVP) · STATUS · RRULE(그대로) · EXDATE 수 | 있음 | 1 |
| MAIL-14 | 카드: 제목 · 언제(내 시간대, 주최자 시간대가 다르면 함께) · 어디 · 주최자 · 참석자와 상태 · 반복 규칙 · 취소 · 내 답변 | 있음 | 1 |
| MAIL-15 | REPLY 쓰기(RFC 5546 §3.2.3): VERSION · PRODID · METHOD:REPLY, VEVENT 에 UID · SEQUENCE(에코) · DTSTAMP(지금, UTC) · ORGANIZER(에코) · ATTENDEE 하나(PARTSTAT) · RECURRENCE-ID · SUMMARY · DTSTART · DTEND(에코) · 쓰인 TZID 의 VTIMEZONE | 있음 | 1 |
| MAIL-16 | iMIP 보내기(RFC 6047): 커넥터 `send` 에 `calendar: { method: "REPLY", ics }`, 수신자는 ORGANIZER, 제목 `Accepted: <summary>` · `Tentative:` · `Declined:`, 본문 한 문장, `inReplyTo` 는 초대 메일의 `messageId` | 있음 | 1 |
| MAIL-17 | 답변 가능 조건: METHOD 가 REQUEST(또는 없음) · 취소 아님 · 주최자 주소 있음. 내 주소를 못 찾으면 `{ address }` 인자 또는 문장으로 묻는다 | 있음 | 1 |
| MAIL-18 | 개정 판단(§2.1.5): 같은 UID · RECURRENCE-ID 에서 SEQUENCE, 같으면 DTSTAMP 로 더 새 초대를 안다(`supersedes`). 옛 초대 카드에 "더 새 버전이 있다" 표시 | 일부 (함수는 있음, 카드 표시는 없음) | 1 · 2 |
| MAIL-19 | 캘린더에 넣기 · 겹침 확인 · COUNTER 제안 · 위임(DELEGATED) — 캘린더 플러그인의 커맨드가 생기면 그것을 부른다 | 없음 | 2 |

### 쓰기 · 행동 (MAIL-20 ~ 29)

| ID | 요구사항 | 현재 | 단계 |
| --- | --- | --- | --- |
| MAIL-20 | 커넥터 행동 규약: `<커넥터>.mail.send { instance, to, cc, bcc, subject, body, inReplyTo, references, replyTo, calendar }` · `.mail.move { instance, id, mailbox }` · `.mail.flag { instance, id, unread, flagged }`. `cmd.list`(자기 패턴 scope) 로 있는 것만 버튼을 켠다 | 있음 | 1 |
| MAIL-21 | 낙관적 갱신: 깃발 · 읽음 · 이동은 화면에서 먼저, 커넥터 거절은 되돌리고 문장으로. 색인의 `data.changed` 가 최종 | 있음 | 1 |
| MAIL-22 | 주소 파싱: `Name <a@b>` · `"Park, Jun" <a@b>` · `a@b` · `<a@b>`, 쉼표 · 세미콜론 구분, 따옴표 안 쉼표 보존, 중복 제거, 틀린 조각은 문장으로 | 있음 | 1 |
| MAIL-23 | 답장: 보낸 사람에게, `Re:` 한 번(`RE:` 인식), `On <date>, <from> wrote:` + `> ` 인용, 서명, In-Reply-To · References(최근 20개) | 있음 | 1 |
| MAIL-24 | 전체 답장: 보낸 사람 + To 를 To 로, Cc 는 Cc 로, 내 주소(`endue.mail.addresses`)와 중복 제외. 비면 보낸 사람 | 있음 | 1 |
| MAIL-25 | 전달: `Fwd:`(`FW:` 인식), `---------- Forwarded message ----------` 헤더 블록, References 는 원본의 것 | 있음 | 1 |
| MAIL-26 | 보내기 전 검사: 계정 · 수신자 하나 이상 · 주소 형식. 문제는 작성 창 위에 문장으로 나열, 첫 문장이 커맨드의 오류 | 있음 | 1 |
| MAIL-27 | 임시 글: 입력 300 ms 뒤 store `drafts` 자동 저장, Drafts 메일함에 나열, 열어 이어 쓰기, 보내면 삭제, Discard 로 삭제, Escape 는 유지 | 있음 | 1 |
| MAIL-28 | 첨부 보내기(`attachments: [{ name, mime, content }]`) — 브리지 파일 선택 창(`dialog`)과 커넥터 규약이 먼저 | 없음 | 2 |
| MAIL-29 | 되돌리기(보관 · 삭제 뒤 10초), 일괄 선택 · 일괄 행동, 스레드 단위 보관 | 없음 | 2 |

### 실시간 · 계정 (MAIL-30 ~ 34)

| ID | 요구사항 | 현재 | 단계 |
| --- | --- | --- | --- |
| MAIL-30 | `data.subscribe { kinds: [message] }` 하나. upserted 는 현재 메일함 조건(`inMailbox`, 색인의 `eq` · `ne` 의미와 같음) · 계정 · 검색어로 판단해 끼우거나 뺀다, removed 는 뺀다. 열린 메시지도 갱신 | 있음 | 1 |
| MAIL-31 | 새 안 읽은 받은편지함 메시지(시작 1분 전 이후 수신)에 `ui.notify`(보낸 사람 · 제목). 설정 `notify` 로 끈다 | 있음 | 1 |
| MAIL-32 | 계정: `catalog.get` 의 `message` 커넥터 인스턴스. 둘 이상이면 선택 상자, 선택은 store 에. 없으면 "No mail account is connected yet." | 있음 | 1 |
| MAIL-33 | 커넥터 상태(동기화 중 · 오류 · 재인증 필요) 표시 — `connector.changed` 는 `connector:manage` 가 필요해 메일 플러그인은 못 듣는다. 코어가 `catalog.get` 에 상태를 싣거나 별도 이벤트가 필요 | 없음 | 2 |
| MAIL-34 | 계정 추가 · 연결 창은 메일 플러그인이 아니라 연결 관리 플러그인(`connector:manage`)의 일. 메일은 그 커맨드를 부르는 링크만 | 없음 | 2 |

### 권한 · 안전 (MAIL-40 ~ 44)

| ID | 요구사항 | 현재 | 단계 |
| --- | --- | --- | --- |
| MAIL-40 | 매니페스트 선언은 `data:read { kinds: [message] }` · `cmd:invoke` 네 패턴 · `ui:notify` 뿐. 선언과 호출의 일치를 테스트가 잡는다(동적 id 는 접미 규약으로) | 있음 | 1 |
| MAIL-41 | 모든 읽기의 scope 는 `data:read { kinds: [message] }`. 거절은 세션에 한 번 `perm.request`(이유 문장), 다시 거절되면 문장 | 있음 | 1 |
| MAIL-42 | HTML 을 그리지 않는다 · 본문은 `textContent` · 링크는 `deepLink` 만 `rel=noopener` 로. 첨부는 이름만 | 있음 | 1 |
| MAIL-43 | 커넥터 커맨드의 거절(`permission_denied`) · 없음(`unknown_command`) · 실패를 각각 다른 문장으로. 보내기 실패 때 임시 글은 남는다 | 있음 | 1 |
| MAIL-44 | 에이전트가 `endue.mail.send` · `.rsvp` · `.trash` 를 부를 때의 확인 정책 — 코어의 커맨드 확인(CORE-03) 이 정해지면 따른다 | 없음 (코어) | 2 |

### 설정 · 상태 (MAIL-50 ~ 53)

| ID | 요구사항 | 현재 | 단계 |
| --- | --- | --- | --- |
| MAIL-50 | `contributes.settings` 다섯: `page`(integer) · `notify`(boolean) · `mark-read`(open · never) · `signature`(string) · `addresses`(array). 값은 settings → init.yaml → 기본값 | 있음 | 1 |
| MAIL-51 | 밖에서 바뀐 값(`settings.changed`)도 즉시 적용 | 있음 | 1 |
| MAIL-52 | store `view`(메일함 · 계정 · 선택) · `drafts` · `answers`, 재시작 · 리로드 뒤 복원. 없는 계정 · 메일함은 버린다 | 있음 | 1 |
| MAIL-53 | 프로필별 서명 · 주소: 프로필의 `settings` 가 덮는다 | 있음 (런타임의 계층) | 1 |

### 접근성 (MAIL-60 ~ 63)

| ID | 요구사항 | 현재 | 단계 |
| --- | --- | --- | --- |
| MAIL-60 | 키보드만으로 모든 기능. 목록은 `role=listbox` · `option` · `aria-selected` · `aria-posinset/setsize` · roving tabindex, 행마다 `aria-label` 에 제목 · 사람 · 상태 | 있음 | 1 |
| MAIL-61 | 상태 줄 `role=status`, 보내기 전 문제는 `role=alert`, 목록 로딩은 `aria-busy`, 도구는 `role=toolbar` | 있음 | 1 |
| MAIL-62 | 색은 `--desk-*` 토큰만, 좁은 폭(720 px 미만)은 두 줄 배치, `prefers-reduced-motion` 에서 애니메이션 없음 | 있음 (대비는 토큰에 의존) | 1 |
| MAIL-63 | `@endue-ai/ui` 의 `desk-list` · `desk-dialog` · `desk-toast` 로 교체 — 앱이 번들을 서빙하면 | 없음 (ADR 0022) | 2 |

### 성능 (MAIL-70 ~ 72)

| ID | 요구사항 | 현재 | 단계 |
| --- | --- | --- | --- |
| MAIL-70 | 시작 시 호출: `init.get` · settings 5 · store 3 · `catalog.get` · `data.query` 2(메일함 · 안 읽은 수) · `data.subscribe`. 같은 틱의 호출은 한 메시지로(SDK 배치) | 있음 | 1 |
| MAIL-71 | 50행 페이지 그리기는 `data.query` 응답 뒤 50 ms 이내. 재그리기는 목록 전체 `replaceChildren` — 500행까지 충분, 그 위는 가상화 | 측정 없음 | 1 · 2 |
| MAIL-72 | 안 읽은 수 재계산은 변경 묶음마다 한 번(250 ms 디바운스), 최대 500개 질의 | 있음 | 1 |

### 품질 (MAIL-90 ~ 93)

| ID | 요구사항 | 현재 | 단계 |
| --- | --- | --- | --- |
| MAIL-90 | 단위 테스트는 SDK 테스트 호스트 위에서 DOM 없이: 메일함 질의 · 스레드 · 메시지 읽기(raw 규약) · 주소 · 답장/전달 · iCalendar 줄 · 값 · 시간대 · iTIP 읽기/REPLY · 컨트롤러(시작 · 메일함 · 검색 · 열기와 읽음 · 보관 · 거절 · 구독 변경과 알림 · 작성과 보내기 · RSVP · 보존) · 매니페스트(스키마 · 키 충돌 · 선언과 호출 일치 · 모든 커맨드에 핸들러) | 있음 | 1 |
| MAIL-91 | 런타임 e2e(WebKit): 실제 `plugin.json` 으로 마운트, 키보드로 열고 답장하고 초대에 답하는 흐름 | 없음 | 1.5 |
| MAIL-92 | `desk plugin validate` 통과, `plugin-validate` · `e2e` 워크플로 녹색 | 있음 (validate) | 1 |
| MAIL-93 | 파일 400줄 이내 · README 40줄 이내 · 공개 SDK 만 import | 있음 | 1 |

## 명세에 필요한 것 (`specs/`, 유지보수자의 몫)

| 항목 | 쓰는 요구사항 | 비고 |
| --- | --- | --- |
| 커넥터 명세에 메일 행동 규약: `resources[kind=message].actions` 의 표준 이름 `mail.send` · `mail.move` · `mail.flag` 와 인자 스키마 | MAIL-20 | 지금은 이 문서와 README 의 규약. 명세에 오르면 `desk plugin validate` 가 커넥터 쪽을 잡는다 |
| `message` 항목의 선택 필드: `cc` · `flagged` · `mailbox`(역할) · `attachments` · `calendar` · `messageId` · `inReplyTo` · `references` | MAIL-01 · 04 · 10 · 23 | 지금은 `raw` 규약. ADR 0032 가 "다섯 커넥터 뒤 종류 재검토" 라 했으니 그때 올린다 |
| `ItemQuery` 에 OR 또는 `nin`(not in) | MAIL-01 | `ne` 다섯 개 대신 한 조건. 선택 사항 |
| `data.count` 또는 `ItemPage.total` | MAIL-05 | 안 읽은 수를 500개 질의 없이 |
| `catalog.get` 에 인스턴스 상태, 또는 `connector.changed` 를 `data:read` 보유자에게도 | MAIL-33 | 메일 표면이 "동기화 중 · 재인증 필요" 를 보이려면 |
| 커넥터 `send` 의 첨부와 브리지 파일 선택 창(`dialog`) | MAIL-28 | 탐색기 요구사항 EXP-86 과 같은 권한 |
| `cmd.register` 의 인자 스키마를 `contributes.commands` 에도 | MAIL-44 | 에이전트가 틀린 인자를 보내면 코어가 `invalid_params` |

## 비기능 예산

| 항목 | 예산 | 어떻게 지키나 |
| --- | --- | --- |
| 첫 그림 | 표면 마운트 → 받은편지함 첫 페이지까지 `data.query` 응답 + 50 ms | MAIL-71 |
| 실시간 | 변경 한 묶음 → 목록 · 읽기 창 갱신 한 번, 재계산은 250 ms 디바운스 | MAIL-30 · 72 |
| 메모리 | 메일함 전환 때 이전 페이지는 버린다. 열린 스레드의 메시지는 200개까지 | MAIL-02 · 04 |
| 접근성 | WCAG 2.1 AA: 키보드 완전 조작, 역할 · 이름 · 상태, 모션 축소 | MAIL-60 ~ 62 |
| 보안 | deny by default, 읽기 scope 는 `message` 종류만, 쓰기는 커맨드만, HTML 미렌더, 비밀은 코어 | MAIL-40 ~ 43 |
| 표준 | RFC 5545 · 5546 · 6047 · 6868 의 읽기 쪽 전체, 쓰기는 REPLY. RFC 5322 주소의 흔한 형태 | MAIL-10 ~ 16 · 22 |

## 단계

| 단계 | 끝나면 되는 것 | 요구사항 |
| --- | --- | --- |
| 1 (지금) | 커넥터가 가져온 메일을 메일함 · 스레드로 보고, 키보드만으로 다니고, 읽고, 답장 · 전달 · 새 글을 쓰고 보내고, 보관 · 깃발 · 읽음을 바꾸고, 초대장을 읽고 답한다. 실시간으로 따라가고 알린다 | MAIL-01~06 · 10~17 · 20~27 · 30~32 · 40~43 · 50~53 · 60~62 · 70 · 72 · 90 · 92 · 93 |
| 1.5 | 런타임 e2e, 성능 측정, 개정 표시 | MAIL-18(카드) · 71(측정) · 91 |
| 2 | 첨부 열기/보내기, HTML 본문, 되돌리기 · 일괄, 커넥터 상태, 계정 연결 링크, 캘린더 플러그인 연동(넣기 · 겹침 · COUNTER), UI 컴포넌트 교체 | MAIL-07~09 · 19 · 28 · 29 · 33 · 34 · 44 · 63 |

## 하지 않는 것

- 메일을 직접 가져오지 않는다(IMAP · JMAP · OAuth). 커넥터 플러그인의 일이고, 브리지의 `net.fetch` 는 HTTP 만 있다.
- HTML 본문을 그리지 않는다 — 텍스트만. 커넥터가 텍스트로 바꾼다.
- 캘린더에 일정을 만들거나 반복 규칙을 전개하지 않는다 — 캘린더 플러그인의 일. RRULE 은 쓰인 그대로 보여 준다.
- 서버 쪽 임시 글(`raw.mailbox: drafts`)을 편집하지 않는다 — Drafts 메일함은 이 플러그인이 쓴 글만.
- 연락처 자동 완성 — `person` 항목을 읽는 별도 권한이 필요해 1단계엔 없다.
- 암호화 · 서명(S/MIME · PGP), 규칙 · 필터, 서명 여럿, 라벨 — 2단계 이후 또는 커넥터의 일.

## 열린 질문

- **행동 규약의 자리**: `<커넥터>.mail.send` 같은 이름 규약은 메일 플러그인과 커넥터가 암묵적으로 맞춘 것이다. `specs/connector/v0` 가 종류별 표준 행동 이름을 갖는 날 그쪽이 SoT 가 되고, 이 플러그인은 `resources[].actions` 를 읽어 버튼을 켠다.
- **내 주소**: 커넥터 인스턴스의 발신 주소를 메일 플러그인이 볼 길이 없다(`connector:manage` 필요). `catalog.get` 이 인스턴스의 공개 설정을 싣는 것이 가장 작은 변화다.
- **스레드의 경계**: 지금은 커넥터가 준 `thread` 를 믿는다. `thread` 가 없는 커넥터를 위해 `References` · `In-Reply-To` 로 묶는 fallback 을 둘지는 그런 커넥터가 나오면 정한다.
- **캘린더 플러그인과의 분업**: 초대 수락 뒤 "캘린더에 넣기" 는 `endue.calendar.*` 커맨드가 생기면 그것을 부른다. 반대로 캘린더 플러그인이 초대 메일을 보낼 때(REQUEST) `endue.mail.compose { calendar }` 를 부를 수 있도록 `compose` 가 `calendar` 인자를 받는 것은 2단계.
