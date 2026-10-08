# repo-dm-bot

유용한 GitHub 레포를 소개하는 숏츠/릴스 영상에서, **댓글 → 팔로우 검증 → DM으로 GitHub 주소 전송**을 자동화합니다.
한국어/영어 인스타그램 계정을 분리해서 운영할 수 있습니다.

## 동작
1. 릴스에 키워드 댓글 (예: "링크")
2. 이미 팔로워면 → 비공개 답장(DM)으로 바로 링크 전송
3. 아니면 → "팔로우했어요" 버튼 DM → 클릭 시 팔로우 재검증 → 통과하면 링크 전송

## 설정
1. Meta 개발자 앱 생성 → Instagram 제품 추가, 계정별(ko/en) 프로페셔널 계정 연결
2. 권한: `instagram_business_manage_comments`, `instagram_business_manage_messages`
3. 웹훅 콜백 URL `https://<도메인>/webhook`, 구독 필드 `comments`, `messages`
4. `.env.example` → `.env` 복사 후 값 입력 (사용할 계정만 채우면 됨)
5. `data/repos.json`에 영상(릴스) 미디어 ID ↔ 레포 정보 추가
6. `npm start` (Node 20.6+), 테스트: `npm test`

## 참고
- YouTube Shorts는 DM 기능이 없어 이 봇으로 자동 전송이 불가합니다 (고정 댓글/설명란에 링크 권장).
- 중복 방지는 메모리 기반이라 재시작 시 초기화됩니다. 운영 시 DB(Redis 등) 권장.

## 대시보드
- `.env`에 `DASHBOARD_TOKEN`을 설정하고 `https://<도메인>/dashboard?token=<토큰>` 접속 (토큰이 없으면 403)
- 표시 내용: 댓글→DM 전환 퍼널(계정별), 등록된 영상/레포 상태, 에이전트별 현재 상태·작업 지침·작업 로그·산출물
- 에이전트(`.claude/agents/*`)는 작업 시작/완료 시 `node scripts/log-activity.js <agent> <start|done|fail|info> "메시지" [산출물]`로 `data/activity.jsonl`에 기록하고, 대시보드가 이를 읽어 표시합니다.
- 댓글/DM 집계는 메모리 기반이라 서버 재시작 시 초기화됩니다.

## 토큰 자동 갱신
- 인스타 장기 토큰(60일)을 12시간마다 점검해 만료 20일 이내면 자동 갱신하고, 갱신된 토큰은 `TOKENS_FILE`(기본 `data/tokens.json`, 권한 0600)에 저장합니다. 재시작해도 유지됩니다.
- `.env`의 토큰을 새로 발급해 바꾸면 저장본보다 `.env` 값이 우선합니다.
- 토큰은 발급 후 24시간이 지나야 갱신됩니다. 첫 하루 동안은 갱신 오류가 대시보드에 기록될 수 있으나 이후 자동 재시도됩니다.
- 만료 후에는 갱신이 불가능하므로, 서버를 60일 넘게 중단하지 마세요. 대시보드 상단에서 남은 일수를 볼 수 있습니다.
- **반드시 `TOKENS_FILE`을 영구 저장소(볼륨/디스크)에 두세요.** 임시 디스크면 재배포 때 갱신본을 잃고 `.env`의 오래된 토큰으로 돌아갑니다.

## 배포
- **Docker:** `docker compose up -d --build` (`.env` 필요, 토큰은 `bot-data` 볼륨에 보존)
- **Render:** `render.yaml` Blueprint로 생성 → 환경변수 입력 → 1GB 디스크가 `/data`에 마운트됨
- 헬스체크: `GET /healthz`. 배포 후 웹훅 콜백 URL을 `https://<도메인>/webhook`으로 Meta 앱에 등록하세요.

## 캐릭터로 보는 작업 상태
대시보드의 작업자(에이전트) 카드는 캐릭터 스프라이트(`src/assets/char/`)로 상태를 보여줍니다.

| 상태 | 판정 | 모습 |
|---|---|---|
| 작업 중 | 마지막 기록이 `start`/`info` | 작업자별로 다름: repo-scout=책 읽기(자료 조사), script-writer=노트북(대본 작성), repo-registrar=폰(등록·검증), publish-checker=고민(점검). 진행 단계 목록과 경과 시간 표시 |
| 방금 완료 | `done` 후 10분 이내 | 웃는 얼굴 |
| 문제 발생 | 마지막 기록이 `fail` | 당황한 얼굴 |
| 응답 없음 | 작업 중인데 60분 넘게 기록 없음 | 고민하는 얼굴 (멈춘 작업 감지) |
| 휴식 중 | 기록 없음 또는 완료 후 10분 경과 | 잠자는 모습 + Zzz |

## repos.json 자동 동기화 (GitHub → 서버)
- `REPOS_SYNC_REPO=owner/repo`를 설정하면 서버가 **5분마다**(`REPOS_SYNC_INTERVAL_MIN`) 해당 저장소의 `data/repos.json`(기본 `main` 브랜치)을 가져와 `REPOS_FILE`에 반영합니다.
- 흐름: Claude Code 에이전트가 `repos.json` 수정 → PR 리뷰/머지 → 최대 5분 뒤 서버에 자동 반영 (재배포 불필요).
- 안전장치: 형식 검증(필수 필드, `https://github.com/...` URL, id 중복 없음)에 실패하면 현재 파일을 그대로 두고 대시보드에 오류를 표시합니다. 덮어쓰기 전에 `repos.json.bak`으로 백업하고, ETag 조건부 요청으로 변경이 없으면 API 한도를 쓰지 않습니다.
- 비공개 저장소는 해당 저장소 **Contents: Read-only** 권한만 가진 Fine-grained 토큰을 `GITHUB_TOKEN`에 넣으세요 (쓰기 권한 불필요).
- ⚠ 동기화를 켜면 **저장소가 기준**입니다. 서버에서 직접 고친 내용은 다음 동기화 때 저장소 내용으로 덮어써집니다 (직전 내용은 `.bak`에 남음). 직접 수정하려면 동기화를 끄세요.

## repos.json 관리 (볼륨)
- 배포 환경에서는 `REPOS_FILE=/data/repos.json`(영구 볼륨)을 사용합니다. 이미지에 들어 있는 `data/repos.json`은 **볼륨에 파일이 없을 때 최초 1회만** 복사되는 기본값입니다.
- 이후 볼륨의 파일만 수정하면 되고, 서버는 요청마다 파일을 읽으므로 **재시작/재배포 없이 바로 반영**됩니다. 파일 JSON이 깨지면 마지막 정상본을 유지하고 로그에 오류를 남깁니다.
- 수정 방법 예: `docker compose exec bot vi /data/repos.json` (또는 Render 셸).
- 주의: 저장소의 `data/repos.json`을 고쳐 재배포해도 이미 볼륨에 파일이 있으면 반영되지 않습니다.

## 에이전트 하네스
규칙은 [`CLAUDE.md`](CLAUDE.md)에 있습니다. 요약:
- **정의**: `agents/<id>.md` (에이전트 1명 = 파일 1개) → `npm run agents:sync`로 Supabase에 반영
- **상태·데이터**: Supabase `harness_*` 테이블 (`supabase/migrations/`), 진행 보고는 `npm run harness:report -- <id> <start|step|done|…>`
- **실행**: Agent Substrate Actor (에이전트 1명 = Actor 1개, `substrate/`)
- **모션**: HyperFrames 컴포지션 (`motion/`) → `npm run motions:render -- <id> --upload`

## 하네스 서버 사용 (`/harness`)

서버(Render/Docker)에 아래 환경변수를 넣으면 대시보드와 에이전트 보고 API가 같이 켜집니다. 규칙은 `CLAUDE.md` 6-1.

```
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...   # 서버 전용
DASHBOARD_TOKEN=...             # 사람용: https://<서버>/harness 로그인 폼에 입력 (주소에는 싣지 않음)
HARNESS_API_TOKEN=...           # 에이전트용
```

```bash
# 에이전트가 진행 보고 (Actor에는 HARNESS_API_URL, HARNESS_API_TOKEN만 둔다)
curl -X POST https://<서버>/api/harness/report -H "Authorization: Bearer $HARNESS_API_TOKEN" \
  -H 'Content-Type: application/json' -d '{"agent":"lumi","kind":"start","message":"10월 지출 분석","steps":["수집","분석","보고서"]}'
# 새 카테고리(섹션) 추가 → 메뉴에 바로 생김
curl -X POST https://<서버>/api/harness/sections -H "Authorization: Bearer $HARNESS_API_TOKEN" \
  -H 'Content-Type: application/json' -d '{"name":"법무팀","parent":"경영지원본부","pose":"book","color":"sky"}'
# 위젯 데이터 보내기
curl -X PUT https://<서버>/api/harness/widgets -H "Authorization: Bearer $HARNESS_API_TOKEN" \
  -H 'Content-Type: application/json' -d '{"section":"법무팀","title":"계약 현황","type":"kpi","data":{"items":[{"label":"검토 중","value":4,"unit":"건"}]}}'
# 대시보드 '작업 지시' 대화창에서 보낸 작업을 에이전트가 가져가기
node scripts/harness-report.js lumi next      # 가져오면 '진행 중', done/fail 보고 때 '완료'/'실패'
```

Supabase 없이 화면만 보려면 `node scripts/dev-harness.js` → `http://127.0.0.1:3100/harness` (로그인 토큰: `dev`).

### Netlify로 배포 (samgukji.netlify.app)

1. Netlify → 사이트 → Site configuration → Build & deploy → Continuous deployment → **Link repository** → `DooBae-KR/board`, 브랜치 `main` (빌드 설정은 `netlify.toml`이 알려줌)
2. Environment variables: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`(Secret), `DASHBOARD_TOKEN`, `HARNESS_API_TOKEN`, 그리고 인스타 봇용 `VERIFY_TOKEN`, `APP_SECRET`, `IG_KO_USER_ID`, `IG_KO_ACCESS_TOKEN`(영어 계정은 `IG_EN_*`)
3. 배포 후 `https://samgukji.netlify.app/harness`에서 `DASHBOARD_TOKEN`을 입력해 로그인. 에이전트의 `HARNESS_API_URL`은 `https://samgukji.netlify.app`
4. 메타 앱의 웹훅 콜백 URL을 `https://samgukji.netlify.app/webhook`으로 바꾸고, 확인 토큰은 `VERIFY_TOKEN`과 같은 값으로 넣기
