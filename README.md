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
