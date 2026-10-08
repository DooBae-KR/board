# 하네스 규칙

이 저장소의 에이전트 하네스는 아래 규칙을 따른다. 사람과 에이전트(Claude Code 포함) 모두에게 적용된다.
규칙끼리 충돌하면 번호가 작은 쪽을 따른다.

## 1. 역할 분리: 정의는 MD, 상태는 Supabase, 실행은 Agent Substrate, 모션은 HyperFrames

| 무엇 | 어디에 | 기준(source of truth) |
|---|---|---|
| 에이전트 정의 (이름, 역할, 캐릭터, 기본 부서, 도구, 작업 지침) | `agents/<id>.md` | 저장소 |
| 런타임 상태 (현재 부서, 업무, 단계, 진행률, 상태, 이동 기록) | Supabase `harness_*` 테이블 | Supabase |
| 에이전트 실행 | Agent Substrate Actor (에이전트 1명 = Actor 1개) | 클러스터 |
| 캐릭터 모션 영상 | `motion/<id>/<state>/index.html` → HyperFrames 렌더 → Supabase Storage | 저장소(원본) + Storage(결과물) |

- 정의를 바꾸려면 MD를 고치고 `node scripts/agents-sync.js`로 Supabase에 반영한다. Supabase에서 정의 필드를 직접 고치지 않는다(다음 동기화 때 덮어써진다).
- 런타임 상태는 MD에 쓰지 않는다. 진행률·현재 업무를 MD에 커밋하지 않는다.

## 2. 데이터: Supabase

1. 하네스 테이블은 `public.harness_` 접두사를 쓴다. 같은 프로젝트의 기존 테이블(`agent_team`, `agent_staff`, `agent_job` 등 다른 앱 소유)을 읽거나 쓰지 않는다.
2. 스키마 변경은 `supabase/migrations/`에 새 파일로만 추가한다. 이미 적용된 마이그레이션 파일은 고치지 않는다.
3. 모든 `harness_` 테이블은 RLS를 켠다. 대시보드(anon/authenticated)는 읽기만, 쓰기는 하네스 서버(`src/server.js`)나 관리자 스크립트가 `SUPABASE_SERVICE_ROLE_KEY`로만 한다. 브라우저는 Supabase에 직접 닿지 않고 서버 API(`/api/harness/*`)만 쓴다.
4. 서비스 롤 키는 서버 환경변수/`.env`에만 둔다. 브라우저 코드, 로그, 커밋, 에이전트 메시지에 넣지 않고, 에이전트(Actor)에게도 주지 않는다. 에이전트는 `HARNESS_API_TOKEN`(보고·섹션·위젯 쓰기만 가능)만 받는다.
5. 에이전트의 진행 보고는 `scripts/harness-report.js`(서버 API `POST /api/harness/report`)로만 한다. 테이블에 직접 insert/update하는 코드를 에이전트 안에 따로 만들지 않는다.
6. 진행률은 단계(`steps`)가 있으면 끝낸 단계 비율로 계산한다. 단계가 없을 때만 숫자를 직접 보고한다.

## 3. 에이전트 정의: `agents/<id>.md`

1. 파일 하나에 에이전트 한 명. 파일 이름의 `<id>`는 영문 소문자·숫자·하이픈이고 frontmatter의 `id`와 같아야 한다.
2. 형식은 `agents/_template.md`를 따른다. 필수 frontmatter: `id`, `name`, `role`, `department`, `pose`, `substrate_template`, `motions`.
3. `department`는 기본 배치 부서 이름이다. 실제 현재 부서는 Supabase가 기준이며 이동은 `harness-report.js assign`으로 한다.
4. 본문에는 작업 지침만 쓴다. 비밀값, 개인 정보, 실제 고객 데이터를 쓰지 않는다.
5. 에이전트를 삭제할 때는 MD를 지우고 `agents-sync.js --prune`을 실행한다. 진행 기록(`harness_agent_events`)은 남는다.

## 4. 실행: Agent Substrate

1. 에이전트 1명은 Actor 1개다. Actor 이름 = 에이전트 `id`. 템플릿은 MD의 `substrate_template`(기본 `harness-agent`).
   - 생성: `kubectl ate create actor <id> -a harness --template=<substrate_template>`
2. 매니페스트는 `substrate/`에 둔다. 이미지는 태그가 아니라 다이제스트(`@sha256:...`)로 고정한다.
3. Actor는 유휴 시 메모리·파일 스냅샷으로 멈췄다가 요청이 오면 복원된다. **열린 연결(DB, MCP, WebSocket)은 복원되지 않으므로** 요청을 처리할 때마다 Supabase 클라이언트를 새로 만들거나 연결을 다시 확인한다.
4. 스냅샷은 재개를 빠르게 하기 위한 것일 뿐 기록이 아니다. 업무 시작·단계 완료·종료는 반드시 Supabase에 보고한다.
5. 한 ActorTemplate에는 VM 종류 하나만 쓴다. GPU 패스스루와 `EgressPolicy`는 지원되지 않으므로 그것에 기대는 에이전트를 만들지 않는다.
6. Agent Substrate는 현재 평가·비운영 용도로 제공된다. 운영 전환 전에는 사람의 승인을 받는다.

## 5. 모션: HyperFrames (by HeyGen)

1. 캐릭터 모션은 HyperFrames HTML 컴포지션으로만 만든다. GIF나 손으로 만든 CSS 루프를 대시보드에 직접 넣지 않는다.
2. 상태마다 클립 하나: `idle`, `working`, `walk`(부서 이동), `done`, `blocked`. 경로는 `motion/<id>/<state>/index.html`.
   - 개별 클립이 없으면 `motion/templates/<state>/index.html`을 쓴다.
3. 컴포지션 규칙
   - 루트: `id="stage"`, `data-composition-id="<id>-<state>"`, `data-start="0"`, `data-width`, `data-height`.
   - 요소: `class="clip"` + `data-start`, `data-duration`, `data-track-index`.
   - 애니메이션은 GSAP `gsap.timeline({ paused: true })`로 만들고 `window.__timelines["<composition-id>"]`에 등록한다. 렌더러가 프레임 단위로 탐색(seek)하므로 `setTimeout`, `requestAnimationFrame`, `Math.random()`, 현재 시각에 기대는 움직임을 쓰지 않는다.
   - 타임라인에 올라가는 요소는 모두 루트 바로 아래의 `clip`이고 고유한 `id`를 가진다(요소 안에 clip을 중첩하지 않는다).
   - 캐릭터 이미지는 `src/assets/char/`의 스프라이트만 쓴다. 컴포지션 안에서는 `assets/char.png`로 참조하고, 렌더 스크립트가 에이전트 포즈에 맞게 넣는다(`done`=happy, `blocked`=flustered, 그 외=에이전트 `pose`).
4. 렌더는 `node scripts/render-motions.js [id] [--upload]`로만 한다. 스크립트가 `npx hyperframes lint`(오류·경고 0)를 통과한 컴포지션만 `npx hyperframes render`로 렌더한다. Node 22+, FFmpeg, Chrome이 필요하다. 결정적 렌더는 Linux에서만 보장되므로 최종본은 Linux(CI)에서 만든다.
5. 결과물은 Supabase Storage `agent-motions/<id>/<state>.mp4`에 올리고 `harness_agent_motions`에 경로와 해시를 기록한다. 대시보드는 에이전트 상태에 맞는 클립을 재생한다.
6. 영상 안에 실제 사람 얼굴, 실존 인물 이름, 저작권 있는 캐릭터·음악을 넣지 않는다.

## 6. 진행 보고 규칙 (모든 에이전트)

```
node scripts/harness-report.js <id> start   "업무 이름" --steps "단계1|단계2|단계3"
node scripts/harness-report.js <id> step    "끝낸 단계에 대한 한 줄"
node scripts/harness-report.js <id> progress 60 "진행 메모"
node scripts/harness-report.js <id> blocked "사람 확인이 필요한 이유"
node scripts/harness-report.js <id> done    "결과 한 줄" [산출물 경로]
node scripts/harness-report.js <id> fail    "원인"
node scripts/harness-report.js <id> assign  "부서 이름" ["새 업무"]
```

- 업무를 시작하면 `start`, 단계를 끝낼 때마다 `step`, 끝나면 `done` 또는 `fail`. 사람 승인이 필요하면 `blocked`로 멈춘다.
- 메시지에 토큰, 비밀번호, 개인 정보를 넣지 않는다.
- 60분 넘게 보고가 없으면 대시보드가 "응답 없음"으로 표시한다.

## 6-1. 서버 (src/server.js)

배포된 서버가 대시보드와 보고 API를 모두 제공한다. `SUPABASE_URL`·`SUPABASE_SERVICE_ROLE_KEY`가 없으면 하네스 API는 503이다. 서버는 시작할 때 `agents/*.md`를 Supabase에 동기화한다(`HARNESS_SYNC=0`이면 끔. 실패해도 웹훅은 계속 돈다).

| 경로 | 토큰 | 용도 |
|---|---|---|
| `GET /harness` | `DASHBOARD_TOKEN` | 대시보드 페이지 (`?token=`) |
| `GET /api/harness` | 위와 같음 | 전체 상태 (ETag) |
| `POST /api/harness/report` | 대시보드 또는 `HARNESS_API_TOKEN` | 진행 보고 (6장 종류와 같음) |
| `POST /api/harness/sections` | 대시보드 또는 에이전트 | 섹션 추가 → 메뉴에 동적으로 생김 |
| `PUT /api/harness/widgets` | 대시보드 또는 에이전트 | 섹션 위젯 갱신 (섹션+제목이 같으면 덮어씀) |
| `DELETE /api/harness/sections/:id` | `DASHBOARD_TOKEN`만 | 섹션 삭제 |
| `GET /api/harness/motion/:id/:state` | `DASHBOARD_TOKEN` | 렌더된 모션 클립(서명 URL로 이동) |

환경변수: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `DASHBOARD_TOKEN`, `HARNESS_API_TOKEN`. 에이전트 쪽은 `HARNESS_API_URL` + `HARNESS_API_TOKEN`을 두면 `harness-report.js`가 서버로 보낸다.

### Netlify 배포 (samgukji.netlify.app)

`netlify.toml`이 같은 API를 Netlify Function(`netlify/functions/harness.mjs`)으로 낸다. 빌드는 `scripts/netlify-build.js`(페이지·스프라이트 생성, 운영 배포에서만 `agents/*.md` 동기화). 환경변수는 Netlify 사이트 설정에 위 네 개를 넣고 `SUPABASE_SERVICE_ROLE_KEY`는 Secret으로 표시한다. Netlify에는 디스크·상시 프로세스가 없으므로 인스타 웹훅과 토큰 갱신은 이 배포에 포함되지 않는다(Docker/Render 서버 담당). 이 사이트는 예전에 DooBae-KR/smagukji에 연결돼 있었고, 그 저장소의 Netlify 연결을 끊은 뒤 이 저장소(`main`)에 연결한다. smagukji의 DB 테이블은 같은 Supabase 프로젝트에 있지만 2장 1항에 따라 건드리지 않는다.

## 7. 기존 기능과의 관계

- `.claude/agents/*`(repo-scout 등)는 Claude Code 하위 에이전트 정의이며 기존 `scripts/log-activity.js` 기록을 그대로 쓴다. 하네스로 옮길 때는 `agents/`에 정의를 새로 만들고 보고를 `harness-report.js`로 바꾼다.
