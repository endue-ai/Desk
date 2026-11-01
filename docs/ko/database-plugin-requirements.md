# endue Desk 데이터베이스 플러그인 요구사항

2026-10-31 · Team endue

> Desk 의 기본 플러그인 `endue.database`(`plugins/database`) 가 PostgreSQL · MySQL / MariaDB · SQLite 의
> 클라이언트를 맡으려면 무엇이 있어야 하는지를 번호를 붙여 적은 문서입니다. `desk-requirements.md` 의 BASE 표에서 한
> 줄(`database`)을 차지하고, 이 문서가 그 줄을 펼칩니다. 요구사항 한 줄이 Task 이슈 하나의 요구사항 칸이 됩니다. 코드와
> 어긋나면 이 문서를 고치고, 되돌리기 어려운 갈림길은 ADR 로 남깁니다(ADR 0038). *현재* 열은 이 문서와 함께 들어간
> `plugins/database` 의 첫 판(0.1.0) 기준입니다.

좋은 DB 클라이언트의 값어치는 네 가지입니다. 연결이 한 곳에 모여 있고, 스키마를 펼쳐 보며 SQL 을 쓰고, 결과가
**정확**하고(NULL 과 빈 문자열과 문자열 'NULL' 이 다르게 보이고, 숫자가 반올림되지 않고), 운영 DB 에서 실수하기 어렵습니다.
Desk 에서는 둘이 더 붙습니다. 모든 동작이 커맨드라 키 · 팔레트 · Eris · 에이전트가 같은 길로 일하고, 플러그인은 권한
경계(`proc:spawn` 의 프로그램 넷) 밖으로 한 발도 나가지 못합니다.

## 약속

| # | 약속 | 뜻 | 지키는 요구사항 |
| --- | --- | --- | --- |
| 1 | 클라이언트 넷, 셸 없이 | `proc:spawn` 은 `psql` `mysql` `mariadb` `sqlite3` 뿐. 각 클라이언트를 DB 밖으로 손을 뻗지 못하는 모드로 띄운다(psql `-c` 한 문장씩, mysql `--binary-mode`, sqlite3 `-safe`) | NF-01 |
| 2 | 비밀번호는 남지 않는다 | store · state · 로그 · 인자 어디에도 없다. 클라이언트의 자격 파일을 그대로 쓰고, 서버가 물으면 세션 동안 메모리에만 | DB-04 · NF-01 |
| 3 | 결과는 정확하다 | NULL · `''` · `'NULL'` 이 셋으로 보이고, 값은 서버가 보낸 글자 그대로(바이너리는 16진) | DB-09 · NF-10 |
| 4 | 운영 DB 에서 실수하기 어렵다 | 읽기 전용 연결은 실행 전에 거절하고 서버 쪽에서도 막는다. production 태그 · 위험한 문장 · 에이전트의 쓰기는 묻는다 | DB-12 · DB-17 |
| 5 | 모든 동작은 커맨드 | `endue.database.*` 스물둘 + 에이전트용 셋(인자 스키마) | DB-01~18 |

## 빌린 개념

DataGrip · DBeaver · TablePlus · psql 의 관용을 빌립니다. 연결 트리 · 콘솔 · 결과 탭은 그대로, 버퍼와 커맨드는 Desk 의
것으로 바꿔 답니다.

| 관용 | Desk `endue.database` | 요구사항 |
| --- | --- | --- |
| 연결 목록 · 그룹 · 색 | 탐색기의 연결 줄, 환경 태그(development · staging · production)와 색, production 은 표면 위 띠 | DB-01 · NF-05 |
| 연결 문자열 붙여 넣기 | URI 로 새 연결(`postgresql://` `mysql://` `mariadb://` `sqlite:`), 비밀번호는 세션에만 | DB-02 |
| Database Navigator | 연결 → 스키마 → 테이블 · 뷰 → 열(타입 · PK · NOT NULL · 기본값), 펼칠 때 읽는다 | DB-06 |
| SQL 콘솔, 커서의 문장 실행 | 연결마다 콘솔 버퍼, `Mod+Enter` 커서의 문장(또는 선택 영역), `Mod+Shift+Enter` 스크립트 전체 | DB-07 |
| 결과 탭 · 그리드 | 결과 집합마다 탭 + Messages 탭, 보이는 행만 그리는 그리드, 정렬, 블록 선택, `Mod+C` | DB-09 |
| setMaxRows · "더 불러오기" | `max-rows` 만 들고 "더 있음", 읽기 하나면 상한+1 행에서 클라이언트를 멈춘다. More rows 는 네 배로 다시 | DB-10 |
| 쿼리 취소 | SIGINT → psql 은 서버에 cancel, mysql 은 KILL QUERY, sqlite3 는 interrupt. 1초 뒤 SIGKILL | DB-11 |
| 테이블 데이터 보기 | 테이블 버퍼: 필터(WHERE) · 정렬(ORDER BY) · 페이지 · 개수 | DB-13 |
| 쿼리 기록 | 연결마다 최근 문장 · 시각 · 결과 요약, 팔레트로 골라 편집기에 | DB-15 |
| "결과 복사 형식" | TSV · CSV · JSON · Markdown · INSERT | DB-16 |

## 아키텍처 매핑

- **종류**: `kind: ui`. 문장 나누기 · 출력 읽기는 JS 로 충분하고 권한 경계는 브리지 하나다(가정 1).
- **실행 모델**(ADR 0038): 실행 한 번 = `proc.spawn` 한 번 = 연결 하나. 문장마다 뒤에 표지(marker)를 붙여 출력을 문장별로
  가른다. psql 은 `\echo`/`\warn` 표지 줄(행 수 포함), mysql 은 표지 이름의 `SELECT ROW_COUNT(), @@warning_count`, sqlite3 는
  표지 이름의 `SELECT total_changes()`. 표지와 NULL 글자에는 실행마다 새 난수(nonce)가 들어간다.
- **권한**: `proc:spawn { commands: ["psql", "mysql", "mariadb", "sqlite3"] }`, `cmd:invoke` 넷(`desk.palette.pick` ·
  `desk.buffers.open` · `.update` · `.close`). `fs:*` · `net:*` 는 없다. 다른 경로의 클라이언트(설정)는 `perm.request` 로 한 번 묻는다.
- **표면**: `main` 하나(`center`). 콘솔과 테이블 보기는 각각 데스크 버퍼(`desk.buffers.open`)로, `desk.buffers.show` · `.closed` 를 답한다.
  `*.sqlite` `*.sqlite3` `*.db3` 는 `desk.files.visit` 로 열린다.
- **기여**: 커맨드 22 · 키 1(`Mod+Shift+B` → `endue.database.open`) · 설정 10 · 파일 3. 에이전트용 `endue.database.connections` ·
  `.schema` · `.query` 는 `cmd.register` 로 인자 스키마와 함께.
- **모듈**: `sql/`(lexer · split · classify · quote) · `engines/`(postgres · mysql · sqlite · readers · text · common) · `run` ·
  `clients` · `execute` · `connections` · `manage` · `catalog` · `explorer` · `consoles` · `tabs` · `results` · `history` · `agent` ·
  `database`(컨트롤러) · `view*` · `keys`. 파일마다 400 줄 이하, DOM 없는 모듈은 전부 vitest 로.

## 요구사항

### 기능 (DB)

| ID | 요구사항 | 현재 | 단계 |
| --- | --- | --- | --- |
| DB-01 | 연결: 만들기 · 고치기 · 복제 · 지우기(확인, 기록 · 콘솔 텍스트도). 이름(대소문자 무시 유일) · 엔진 · 호스트 · 포트 · DB · 사용자 · TLS 모드 · CA 파일 · (SQLite) 파일 · 환경 태그 · 읽기 전용. 필드마다 검사하고 틀린 필드를 문장으로. store `connections`(64 KiB) | 있음 | A |
| DB-02 | URI: `postgres(ql)://` `mysql://` `mariadb://` `sqlite:` 읽기(`sslmode` · `ssl-mode` · `sslrootcert` · IPv6 · 퍼센트 인코딩)와 쓰기(비밀번호 없이, `copy-uri`) | 있음 | A |
| DB-03 | 연결 시험: 버전 쿼리, 걸린 시간 · 서버 버전, 실패는 클라이언트의 말로. 폼에서도 저장 전에 | 있음 | A |
| DB-04 | 비밀번호: 클라이언트가 인증 실패 · 비밀번호 없음을 말하면 표면 안의 가려진 입력으로 한 번 묻고 다시 실행. 메모리에만(연결 끊기 · 종료까지). 넘기는 길은 `PGPASSWORD` · `MYSQL_PWD` 뿐. `.pgpass` · `~/.my.cnf` · `PGSERVICE` 는 그대로 동작 | 있음 | A |
| DB-05 | 클라이언트 점검: 찾기(데스크 PATH → 설정 `path` → Homebrew `libpq` · `mysql-client` · Postgres.app), `--version` 으로 종류(mysql · mariadb)와 최소 버전, 없으면 설치 안내 | 있음 | A |
| DB-06 | 탐색기: 연결 → 스키마(MySQL 은 DB, SQLite 는 main) → 테이블 · 뷰 · 머티리얼라이즈드 뷰 · 외부 테이블 → 열(타입 · PK · NOT NULL · 기본값). 펼칠 때 읽고 캐시, 새로고침, 시스템 스키마는 설정으로. 키보드 트리 | 있음 | A |
| DB-07 | 콘솔: 연결마다 데스크 버퍼, 텍스트는 store 에(재시작 뒤에도). 커서의 문장 · 선택 영역 · 스크립트 전체 · 한 트랜잭션으로 · 시험 실행(끝에 ROLLBACK) · EXPLAIN(SQLite 는 QUERY PLAN) | 있음 | A |
| DB-08 | 문장 나누기: PG(`''` · `E''` · 달러 인용 · `""` · 중첩 주석 · 괄호 안 `;` · `CREATE FUNCTION … BEGIN ATOMIC … END`), MySQL(백슬래시 이스케이프 · 백틱 · `#` · `-- ` · `DELIMITER`), SQLite(`[]` · 백틱 · `CREATE TRIGGER … BEGIN … END`). 줄 · 열을 남겨 오류 위치를 편집기로 | 있음 | A |
| DB-09 | 결과: 결과 집합마다 탭 + Messages(문장마다 행 수 · 영향 행 · 경고 수 · 오류 코드와 DETAIL · HINT · 실행 안 됨), 요약(문장 수 · 시간 · 모드). NULL 은 따로 그린다, 숫자 열 오른쪽 정렬, 긴 값 줄임 + Enter 로 전체 | 있음 | A |
| DB-10 | 행 상한: `max-rows`(500). 읽기 하나면 상한+1 행에서 클라이언트를 멈춘다(PG 는 `FETCH_COUNT` 커서, MySQL 은 `sql_select_limit`, SQLite 는 줄 세기). More rows 는 네 배(최대 100,000) | 있음 | A |
| DB-11 | 취소 · 시간 제한: Cancel · 편집기 Escape · `endue.database.cancel`. `timeout-seconds` 는 PG 서버의 `statement_timeout` + 클라이언트 쪽 제한 | 있음 | A |
| DB-12 | 안전: 읽기 전용 연결은 쓰기 · DDL · 읽기 전용을 푸는 SET/BEGIN 을 실행 전에 거절하고, 서버 쪽에서도(PG `default_transaction_read_only`, MySQL `SET SESSION TRANSACTION READ ONLY`, SQLite `-readonly`). `confirm` 이 켜져 있으면 production 의 쓰기와 어디서든 DROP · TRUNCATE · WHERE 없는 UPDATE/DELETE · ALTER … DROP 을 문장을 보여 주고 묻는다 | 있음 | A |
| DB-13 | 테이블 보기: 탐색기의 테이블 → `SELECT * … WHERE … ORDER BY … LIMIT … OFFSET …` 페이지, 앞뒤, 개수(요청 시). 필터 · 정렬은 식 하나(`;` · 주석 · 짝 안 맞는 괄호 거절) | 있음 | A |
| DB-14 | 데이터 편집: PK 가 있는 테이블에서 셀 고치기 · 행 추가 · 삭제를 대기 변경으로 모아 SQL 미리 보기 뒤 한 트랜잭션으로 | 없음 | B |
| DB-15 | 기록: 연결마다 최근 `history-max`(200) 문장 · 시각 · 결과 요약. 비밀번호를 담은 듯한 문장(`PASSWORD` · `IDENTIFIED BY` …)은 남기지 않는다. 팔레트로 골라 편집기에 | 있음 | A |
| DB-16 | 복사 · 내보내기: 결과(또는 블록)를 TSV · CSV · JSON(정확히 돌아오는 숫자만 숫자) · Markdown · INSERT 로 복사(A). 파일로 내보내기는 좁은 `fs:write` 를 묻는 길(D3) 뒤 | 일부 (복사만) | A · B |
| DB-17 | 에이전트: `endue.database.connections`(비밀번호 없이) · `.schema` · `.query`(maxRows ≤ 1000). 쓰기는 태그와 무관하게 사람에게 묻고, 비밀번호 입력은 띄우지 않는다 | 있음 | A |
| DB-18 | SQLite 파일 열기: `*.sqlite` `*.sqlite3` `*.db3` 를 데스크가 열면 그 파일의 연결(처음이면 추가)과 콘솔이 그 버퍼에 | 있음 | A |
| DB-19 | 객체 더 보기: 인덱스 · 외래 키 · 루틴 · 트리거 · 시퀀스, 테이블 DDL(MySQL `SHOW CREATE TABLE`, SQLite `sqlite_master.sql`, PG 는 카탈로그로) | 없음 | B |
| DB-20 | 편집기: 구문 강조 · 자동 완성(키워드 · 스키마 · 테이블 · 열) · 서식 정리 | 없음 | B |
| DB-21 | 세션 유지: 실행 사이에 트랜잭션 · `SET` · 임시 테이블이 이어지는 연결. 코어 드라이버 또는 psql `\restrict`(17.6+) 위에서만 안전하다(ADR 0038 다음 결정) | 없음 | C |
| DB-22 | SSH 터널(`ssh -N -L`, `proc:spawn ssh`) | 없음 | C |
| DB-23 | 가져오기 · 덤프: CSV 가져오기, `pg_dump` · `mysqldump` · `.dump` | 없음 | C |
| DB-24 | 다른 엔진: DuckDB(`duckdb -safe`) · SQL Server(`sqlcmd`) · ClickHouse | 범위 밖 — 엔진 모듈 하나씩 | — |

### 비기능 (NF)

| ID | 요구사항 | 현재 | 단계 |
| --- | --- | --- | --- |
| NF-01 | 보안: 셸 없음, 인자 배열. psql `-X -w`, 문장마다 `-c`(서버로 그대로: 메타 커맨드 · 변수 없음), `\` 로 시작하는 문장 · `COPY … STDIN/STDOUT` 거절, 연결 값은 `PG*` 환경 변수. mysql `--binary-mode`(`\!` · `system` · `source` 꺼짐) `--local-infile=0` `--skip-reconnect`, 연결 값은 `--opt=값` 한 인자. sqlite3 `-safe`(`.shell` · `.load` · `ATTACH` · `load_extension` 꺼짐), `.` 으로 시작하는 문장 거절. 비밀은 환경 변수로만 | 있음 | A |
| NF-02 | 오류 문구: 클라이언트 접두사(`psql: error:` · `ERROR:` · `ERROR 1064 (42000) at line n:` · `Error: in prepare,`)를 떼고 코드(SQLSTATE · errno · SQLite 코드)와 DETAIL · HINT, 위치(PG `LINE`/캐럿, MySQL `near '…'`, SQLite 캐럿)를 편집기 선택으로 | 있음 | A |
| NF-03 | 성능: 실행당 출력 64 MiB 상한, 행 상한(DB-10), 그리드는 보이는 행만(10만 행), 탐색기 지연 로딩 · 캐시, 클라이언트 탐지는 세션에 한 번 | 있음 | A |
| NF-04 | 접근성: 키보드만으로 전부. 탐색기 `role=tree`, 결과 `role=grid` + `aria-rowcount` · `aria-colcount` · `aria-sort`, 탭 `role=tablist`, 상태 줄 live region. 편집기는 `Mod+Enter` · `Mod+Shift+Enter` 만 가로채고 Escape 는 실행 중일 때만 | 있음 | A |
| NF-05 | 테마: `--desk-*` 토큰, 환경 색 셋은 플러그인 소유, production 은 표면 위 띠. 두 테마 대비 검사 | 일부 (대비 테스트 없음) | A · B |
| NF-06 | 국제화: 문자열은 영어 한 곳에. RT-13 번들이 오면 `locales` | 없음 | C |
| NF-07 | 최소 버전: psql 13(`--csv` · `\warn`), mysql 8.0.19 · mariadb 10.5(`--binary-as-hex`), sqlite3 3.37(`-safe`). 낮으면 무엇 때문인지 말한다 | 있음 | A |
| NF-08 | Windows: `.exe` · 경로 · 신호. 클라이언트 탐색 폴더가 비어 있다 | 없음 | C |
| NF-09 | 테스트: lexer · 분류 · 엔진 계획과 읽기(실제 출력 고정) · URI · 결과 · 컨트롤러(가짜 psql/sqlite3 가 실제 프로토콜로 답한다) · 매니페스트(Ajv · `desk plugin validate`). 실제 클라이언트 통합(`live.test.ts`): sqlite3 는 PATH 에 있으면, PG · MySQL 은 `ENDUE_DB_TEST_*` URI 가 있으면 | 있음 (런타임 e2e 는 D4 뒤) | A · B |
| NF-10 | 값: 서버가 보낸 글자 그대로. 날짜 · 시간은 PG `DateStyle=ISO`, MySQL `YYYY-MM-DD hh:mm:ss`, SQLite 는 저장된 텍스트 — 로컬 시간대로 바꾸지 않는다. SQLite REAL 은 같은 double 의 가장 짧은 꼴, 정수는 2^53 너머도 그대로 | 있음 | A |

## 의존: Desk 쪽에서 해야 하는 것

플러그인은 공개 API 만 쓰므로 아래는 전부 플러그인 밖의 일이고, 이 문서와 함께 들어간 변경은 `plugins/database/**` 와 문서뿐이다.

| ID | 무엇 | 어디 | 없으면 |
| --- | --- | --- | --- |
| D1 | 런타임이 플러그인 프레임에 `allow="clipboard-write"` (보안 판단과 함께) | `packages/runtime/src/surfaces.ts` | 팔레트에서 부른 Copy as 는 실패할 수 있다; 그리드의 `Mod+C`(copy 이벤트)는 된다 |
| D2 | 비밀 보관(SYS-06 키체인): 플러그인이 비밀번호를 코어에 맡기고 다시 꺼내지 못하는 길 | `specs/bridge` · 코어 | 재시작마다 다시 묻는다(자격 파일을 쓰면 묻지 않는다) |
| D3 | 좁게 묻는 `fs:write` — 매니페스트에 선언하지 않은 경로 하나를 `perm.request` 로 | `specs/plugin` · 코어 | DB-16 파일로 내보내기 없음 |
| D4 | `browserStub` 의 가짜 `proc`(BR-07): 스크립트로 답하는 `psql` · `sqlite3` | `packages/bridge` | 런타임 e2e 에서 이 플러그인을 못 돌린다 |
| D5 | 코어가 `settings.*` 를 서빙 (#81) | `crates/desk-core` | `init.get` 레이어만 읽는다; 바뀐 설정은 Check the clients 로 다시 읽는다 |
| D6 | (선택) 코어 DB 드라이버 또는 세션 프로세스 — DB-21 | ADR 0038 다음 결정 | 실행 사이에 트랜잭션이 이어지지 않는다 |

## 단계

| 단계 | 끝나면 되는 것 | 요구사항 |
| --- | --- | --- |
| A | 연결을 만들고(URI 포함) 시험하고, 스키마를 펼치고, 콘솔에서 문장 · 스크립트를 돌리고(트랜잭션 · 시험 실행 · EXPLAIN), 결과를 정확히 보고 정렬 · 복사하고, 테이블을 페이지로 보고, 운영 DB 에서 막히거나 묻는다. 에이전트가 읽고, 쓰기는 사람이 허락한다 | DB-01~13 · 15 · 16(복사) · 17 · 18, NF-01~05 · 07 · 09(단위 · 실제 클라이언트) · 10 |
| B | 날마다 쓰는 나머지: 데이터 편집, 파일로 내보내기, 객체 더 보기 · DDL, 구문 강조 · 자동 완성, 대비 검사, 런타임 e2e | DB-14 · 16(파일) · 19 · 20, NF-05 대비, NF-09 e2e |
| C | 세션 유지, SSH 터널, 가져오기 · 덤프, Windows, 국제화 | DB-21~23, NF-06 · 08 |

## 가정과 결정 (뒤집으려면 거절에 한 줄로)

1. `kind: ui`. Wasm 로직 플러그인이 더 안전하지 않다: 권한 경계는 브리지 하나다.
2. 엔진 셋의 **공식 클라이언트**를 `proc.spawn` 으로 돌린다(ADR 0038). 코어에 드라이버를 넣지 않는다 — 스펙 · 코어 변경 없이 커뮤니티 형식 그대로.
3. 실행 한 번이 연결 하나다. 한 실행 안의 `BEGIN … COMMIT` 은 돈다. 실행 사이의 트랜잭션은 C 단계(DB-21).
4. 첫 오류에서 멈춘다(psql `ON_ERROR_STOP`, mysql 은 `-e` 에서 `--force` 가 듣지 않는다, sqlite3 `-bail`). "계속" 모드는 두지 않는다.
5. mysql 클라이언트는 DELIMITER 를 15 자까지만 읽는다(`char delimiter[16]`): 구분자는 `;;` + 난수 11 자 + `;;`.
6. MySQL 서버의 `SLEEP()` 은 KILL QUERY 에 오류 대신 1 을 돌려줘 클라이언트가 다음 문장으로 간다: 취소는 SIGINT 1 초 뒤 SIGKILL 로 끝내고, 그 사이 끝난 문장은 Messages 가 말한다.
7. SQLite 와 MySQL 은 행 없는 결과에 열 이름을 주지 않는다(PG 는 준다): "No rows" 와 함께 그렇게 말한다.
8. sqlite3 의 `unistr()` 출력은 원래 백슬래시를 이스케이프하지 않는다. 글자 그대로의 `\u0001` 과 제어 문자가 함께 든 값은 다르게 읽힐 수 있다.
9. `*.db` 는 SQLite 만의 확장자가 아니라 연결하지 않는다(`*.sqlite` `*.sqlite3` `*.db3` 만).
10. 표지 · NULL 글자는 실행마다 12 자 난수. 데이터가 그 글자와 같을 확률은 무시한다.
11. 에이전트의 쓰기는 `confirm` 설정과 무관하게 묻는다. 에이전트에게는 비밀번호 입력을 띄우지 않는다(사람이 콘솔에서 먼저 연결).
12. 기본 키 `Mod+Shift+B`(비어 있음). macOS 의 `Cmd+Shift+Q`(로그아웃)는 피했다.
13. 코어 · 스펙 · 런타임은 이 작업에서 손대지 않는다. D1~D6 은 각각 Task 이슈로 간다.

## Task 이슈 분할안

| 순서 | 이슈 | Scope | 선행 |
| --- | --- | --- | --- |
| T1 | `plugins/database` 편입 (A 단계, 이 문서 · ADR 0038) | `plugins/database/**` · `plugins/README.md` · `docs/ko/database-plugin-requirements.md` · `docs/ko/desk-requirements.md` · `docs/adr/0038-*` · `docs/qa/TESTING.md` | — |
| T2 | D4: 스텁의 가짜 `psql` · `sqlite3` 와 `packages/runtime/e2e/database.spec.ts` | `packages/bridge/src/**` · `packages/runtime/e2e/**` | T1 |
| T3 | DB-14 데이터 편집 | `plugins/database/**` | T1 |
| T4 | DB-19 · 20 객체 · DDL · 자동 완성 | `plugins/database/**` | T1 |
| T5 | D3 + DB-16 파일로 내보내기 | `specs/plugin/**` · `crates/desk-core/**` · `plugins/database/**` | — |
| T6 | D1 클립보드 쓰기 허용 (보안 검토) | `packages/runtime/src/surfaces.ts` · ADR | — |

## 열린 질문

- 비밀번호를 재시작 뒤에도: SYS-06 키체인이 오면 "이 기기에 기억" 을 연결마다 켤지, 자격 파일(`.pgpass`)을 대신 써 줄지.
- 아주 큰 결과: 64 MiB 상한 너머는 터미널로 보낼지(`psql -c … > file`), 파일 내보내기(D3)로 흘릴지.
- 세션 유지(DB-21): 코어 드라이버(타입 있는 값 · 취소 · TLS 를 코어가)와 psql `\restrict` + stdin 세션 중 어느 쪽이 먼저인가.
