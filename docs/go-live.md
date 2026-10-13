# 인스타 DM 봇 go-live 런북

처음 하는 사람도 번호 순서대로 따라 하면 되도록 썼습니다. 이 문서는 **실계정 설정을 사람이 직접** 하는 것을 전제로 하며, 메타(Meta) 화면의 메뉴 이름은 자주 바뀝니다. 화면이 다르면 [Instagram Platform 공식 문서](https://developers.facebook.com/docs/instagram-platform)에서 최신 위치를 확인하세요. 이 문서에서 "공식 문서에서 확인하세요"라고 한 부분은 필자가 확신하지 못해 단정하지 않은 곳입니다.

> 비밀값(토큰, 앱 시크릿, 서비스 롤 키)은 채팅·커밋·스크린샷·이슈에 절대 붙이지 마세요. 환경변수 칸에만 넣습니다.

## 우리 앱 정보와 공식 문서 확인 사항 (2026-10-13 조회)

- **Meta 앱 ID: `1109070718261713`**, **Instagram 앱 ID: `1082443284780720`** (앱 이름 "비서-IG", 둘 다 비밀이 아닌 공개 값입니다. Instagram 앱 ID와 시크릿은 앱 대시보드의 *Instagram → API setup with Instagram login* 화면 맨 위에 있습니다). 앱 대시보드: https://developers.facebook.com/apps/1109070718261713/
  - 대시보드에는 **Meta 앱 ID/시크릿**(설정 → 기본 설정)과, Instagram 제품 안의 **Instagram 앱 ID/시크릿**이 따로 있을 수 있습니다. 어느 쪽이 웹훅 서명 시크릿인지는 공식 문서가 "앱 시크릿"이라고만 써서 단정할 수 없습니다. **`APP_SECRET`에는 먼저 위 *Instagram 앱 시크릿 코드*(Instagram 설정 화면의 "표시" 버튼)를 넣고**, 웹훅이 401로 거절되면 Meta 앱 시크릿으로 바꿔 보세요.
- **권한 이름**(확정): `instagram_business_basic`, `instagram_business_manage_comments`, `instagram_business_manage_messages`
- **토큰**: 대시보드의 *Instagram > API setup with Instagram business login → Generate token*으로 만든 토큰은 **60일** 유효합니다. 갱신은 `GET https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token` — **발급 24시간 후부터, 만료 전에만** 가능합니다. 만료되면 갱신 불가(재발급).
- **웹훅**: 콜백은 유효한 TLS 인증서의 HTTPS여야 합니다(Netlify는 해당). 계정 구독은 `POST https://graph.instagram.com/v25.0/<IG계정ID>/subscribed_apps?subscribed_fields=comments,messages`. **공식 문서: "웹훅을 받으려면 앱이 Live 모드여야 한다"**, 그리고 `comments` 필드는 **고급 액세스(Advanced Access)** 가 필요하다고 되어 있습니다. 또한 댓글 알림은 **공개 계정**이어야 옵니다.
- **비공개 답장**(댓글 → DM): 댓글 작성 후 **7일 이내**, 한 댓글 작성자에게 **먼저 보낼 수 있는 메시지는 1통**이며, 이후 후속 메시지는 상대가 응답한 뒤 **24시간 안**에만 가능합니다. 받는 사람이 **팔로워면 받은편지함, 아니면 "메시지 요청함"** 으로 들어갑니다. 라이브 방송 댓글은 방송 중에만 답장할 수 있습니다.
- **팔로우 조회**(`is_user_follow_business`): 이 필드는 문서에 있습니다(권한 `instagram_business_basic` + `instagram_business_manage_messages`). 단 **상대의 동의가 필요**하고, 동의는 *상대가 우리에게 DM을 보내거나 아이스브레이커/고정 메뉴를 눌렀을 때만* 생깁니다. **댓글만 단 사용자는 처음에는 조회가 실패**합니다("User consent is required"). 그래서 봇은 먼저 조회를 시도하고(실패해도 정상), 실패하면 "팔로우했어요" 버튼 DM을 보내며, 상대가 버튼을 눌러 응답한 뒤에 다시 조회합니다.
- **접근 수준**: 내가 소유·관리하는 계정은 Standard Access로 쓸 수 있고, 앱 심사는 "여러 사업체에 서비스하는 앱(Tech Provider)"에서 필수라고 합니다. 다만 위 `comments` 웹훅은 고급 액세스를 요구한다고 적혀 있어 **내 계정 전용이라도 심사가 필요한지는 문서만으로 단정할 수 없습니다 → 7단계에서 실제로 댓글 이벤트가 오는지 먼저 시험해 보세요.**
- API 버전: 공식 예시는 v25.0이고 봇 코드는 v23.0을 씁니다. 동작에는 지장이 없을 가능성이 높지만 실계정 시험에서 확인하세요.

## 전체 흐름

1. Meta 앱 만들기
2. 인스타 계정 연결과 권한
3. 접근 토큰 발급
4. Netlify 환경변수 입력
5. 웹훅 등록과 구독
6. Supabase 마이그레이션 적용 확인
7. 개발 모드 테스트 (계정 2개)
8. `npm run bot:check` 로 점검
9. 첫 영상 업로드 후 미디어 ID 찾기, `data/repos.json` 등록
10. PR 올리고 배포 반영 확인
11. (나중에) 앱 심사

준비물: 인스타그램 **프로페셔널(비즈니스/크리에이터) 계정** 한국어용·영어용 각 1개, 테스트용 개인 계정 1~2개, Meta 개발자 계정, Netlify 사이트(예: `https://samgukji.netlify.app`), Supabase 프로젝트.

---

## 1. Meta 앱 생성

1. 앱은 이미 있습니다: https://developers.facebook.com/apps/1109070718261713/ (새로 만들 필요 없음. 앱 유형은 **Business** 여야 합니다).
2. 앱 대시보드 왼쪽 메뉴에 **Instagram** 이 없다면 제품/사용 사례 추가에서 Instagram(Instagram 로그인 방식)을 추가합니다.
3. **App Secret**: 앱 대시보드 **앱 설정 → 기본 설정**의 앱 시크릿, 그리고 Instagram 설정 화면에 별도 *Instagram 앱 시크릿*이 있으면 그것도 확인합니다. `APP_SECRET`에는 웹훅 서명용 시크릿을 넣습니다(위 '확인 사항' 참고). 복사해 Netlify에만 넣습니다.
4. 앱 상단의 모드(**Development / Live**)를 확인합니다. 문서상 웹훅은 **Live 모드**에서만 전송되므로, 7단계에서 이벤트가 오지 않으면 Live 전환(개인정보처리방침 URL·앱 아이콘 등 필요)을 검토합니다.

## 2. 인스타 계정 연결과 권한

이 봇은 `graph.instagram.com` (Instagram 로그인 방식의 API)을 쓰며, 댓글을 읽고 DM을 보내고 팔로우 여부를 확인합니다.

1. 한국어 계정, 영어 계정 모두 인스타 앱에서 **프로페셔널 계정**으로 전환되어 있어야 합니다.
2. 앱 대시보드의 Instagram 설정에서 각 계정을 연결(테스터로 추가)하고, 인스타 앱 **설정 → 웹사이트 권한(앱 및 웹사이트) → 테스터 초대**에서 수락합니다. 정확한 메뉴는 공식 문서에서 확인하세요.
3. 봇에 필요한 권한(공식 문서에서 현재 이름 확인): 댓글 관리, 메시지 관리 계열(예: `instagram_business_basic`, `instagram_business_manage_comments`, `instagram_business_manage_messages`). 토큰 발급 시 이 범위(scope)를 모두 승인해야 합니다.
4. 인스타 앱에서 DM 관련 설정(메시지 요청 허용 등)이 막혀 있지 않은지 확인합니다.

## 3. 접근 토큰 발급

1. 앱 대시보드의 Instagram 설정에서 각 계정의 **토큰 생성(Generate token)** 을 누르고 로그인·권한을 승인합니다. 나온 값이 `IG_KO_ACCESS_TOKEN` / `IG_EN_ACCESS_TOKEN` 입니다.
2. 같은 화면(또는 `GET https://graph.instagram.com/v23.0/me?fields=user_id,username` 를 `Authorization: Bearer <토큰>` 헤더로 호출)에서 계정 ID를 확인합니다. 이것이 `IG_KO_USER_ID` / `IG_EN_USER_ID` 입니다.
3. 발급 직후 토큰이 단기인지 장기(약 60일)인지는 발급 화면·공식 문서에서 확인하세요. 봇의 예약 함수(`refresh-tokens`, 12시간마다)가 만료 20일 전부터 장기 토큰을 자동 갱신합니다. 단기 토큰이면 장기 토큰으로 교환(공식 문서의 long-lived token 절차)한 값을 넣어야 합니다.
4. 이후 토큰이 DB에 저장·갱신되므로, 수동으로 토큰을 새로 발급해 환경변수를 바꾸면(해시가 달라지면) 환경변수 값이 우선합니다.

## 4. Netlify 환경변수

Netlify → 사이트 → **Site configuration → Environment variables**. Functions와 Builds 범위에 넣고, 비밀값은 **Secret** 으로 표시합니다.

| 이름 | 설명 |
|---|---|
| `VERIFY_TOKEN` | 임의의 긴 문자열. 5단계에서 메타에도 똑같이 입력 |
| `APP_SECRET` | 1단계의 앱 시크릿. 없으면 웹훅 POST를 모두 거부함 |
| `IG_KO_USER_ID`, `IG_KO_ACCESS_TOKEN` | 한국어 계정 |
| `IG_EN_USER_ID`, `IG_EN_ACCESS_TOKEN` | 영어 계정 (한쪽만 운영해도 됨) |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Supabase 프로젝트 설정 → API. 서비스 롤 키는 서버 전용 |
| `DASHBOARD_TOKEN` | 대시보드 로그인·세션 키 |
| `HARNESS_API_TOKEN` | 에이전트 보고용. `DASHBOARD_TOKEN`과 다른 값 |

환경변수를 바꾼 뒤에는 **새로 배포(Deploys → Trigger deploy)** 해야 함수에 반영됩니다.

## 5. 웹훅 등록과 구독

1. 먼저 `main` 이 배포되어 `https://<사이트>/webhook` 이 살아 있어야 합니다. 브라우저에서 `https://<사이트>/webhook` 을 열어 `forbidden` 이 보이면 함수가 도는 것입니다(토큰 없이 접속했으니 정상).
2. 앱 대시보드의 Instagram 웹훅 설정에서 **콜백 URL** = `https://<사이트>/webhook`, **확인 토큰** = `VERIFY_TOKEN` 과 같은 값 → 확인 및 저장.
3. 구독 필드에서 **`comments`** 와 **`messages`** 를 켭니다.
4. 각 계정이 앱에 구독되어 있어야 합니다(계정 연결 화면의 웹훅 구독 토글, 또는 API `POST /{ig-user-id}/subscribed_apps?subscribed_fields=comments,messages`). 방법은 공식 문서에서 확인하세요. `npm run bot:check -- --online` 이 구독 여부를 대신 확인해 줍니다.

## 6. Supabase 마이그레이션 적용 확인

봇은 `igbot_tokens`, `igbot_seen`, `igbot_events` 테이블이 필요합니다(`supabase/migrations/20261008140000_igbot_tables.sql`).

1. Supabase 대시보드 → **Table Editor** 에서 위 세 테이블이 있는지 봅니다.
2. 없으면 SQL Editor에서 마이그레이션 파일 내용을 실행하거나 Supabase CLI(`supabase db push`)로 적용합니다. 운영 DB에 적용하는 일이므로 파일을 먼저 읽고 하세요.
3. 테이블이 없으면 웹훅이 500(`token store unavailable`)을 돌려줍니다.

## 7. 실계정 테스트 (계정 2개)

준비: 봇 계정(예: 한국어 계정)과, 앱 역할에 **테스터로 추가·수락한** 개인 계정 2개(A, B).

> ⚠ 공식 문서는 "웹훅을 받으려면 앱이 Live 모드여야 하고, `comments` 필드는 고급 액세스가 필요하다"고 합니다. 따라서 **개발 모드에서 댓글 이벤트가 오지 않아도 설정 실수가 아닐 수 있습니다.** 이벤트가 안 오면 ① 앱을 Live로 전환 ② 11단계의 앱 심사(고급 액세스) 순서로 진행하세요. 어느 경우에 이벤트가 오는지는 실제로 시험해야 알 수 있습니다.

1. 임시 테스트 릴스/게시물을 봇 계정에 올리고, 그 미디어 ID를 9단계 방법으로 찾아 **테스트용 항목**을 `data/repos.json` 에 넣어 배포합니다(운영 항목과 섞이지 않게 `id` 에 `test-` 를 붙이고 끝나면 삭제).
2. 계정 A: 봇 계정을 **팔로우한 상태**로 댓글에 키워드(예 `링크`) → DM으로 GitHub 주소가 와야 합니다.
3. 계정 B: 봇 계정을 **팔로우하지 않은 상태**로 댓글 → 팔로우 안내 DM이 **"메시지 요청함"** 으로 들어옵니다(받은편지함이 아님). 요청을 열어 "팔로우했어요" 버튼을 누르면(팔로우한 뒤) 주소가 와야 합니다.
   - 계정 A처럼 **이미 팔로우 중인데도 버튼 안내가 온다면** 정상일 수 있습니다: 댓글만 단 사용자는 처음엔 팔로우 조회가 막히기 때문입니다(위 '팔로우 조회' 항목). 버튼을 누르면 곧바로 주소가 와야 합니다.
4. 같은 댓글이 두 번 처리되지 않는지(중복 방지), 키워드가 틀린 댓글에는 반응이 없는지 확인합니다.
5. 안 되면 아래 "막혔을 때"를 보세요. Netlify → Functions → webhook 로그, Supabase `igbot_events` 테이블에서 원인을 볼 수 있습니다.

## 8. `npm run bot:check` 실행

로컬에서 `.env`(저장소 `.env.example` 참고, git에 올리지 않음)에 값을 넣고:

```bash
npm run bot:check                                   # 오프라인: 환경변수 이름·repos.json
npm run bot:check -- --online                       # + 각 계정 토큰 /me, comments·messages 구독
npm run bot:check -- --online --url https://<사이트>  # + 웹훅 핸드셰이크
```

- 표에 통과/경고/실패/확인못함이 나오고, 실패가 하나라도 있으면 종료 코드 1입니다. 환경변수 값은 출력되지 않으며, 토큰은 요청 헤더로만 전송됩니다.
- `확인못함` 은 네트워크 오류로 판단하지 못한 것이니 네트워크를 확인하고 다시 실행하세요.
- 로컬 `.env` 값과 Netlify에 넣은 값이 같아야 핸드셰이크 결과가 의미 있습니다. 핸드셰이크 실패는 보통 Netlify의 `VERIFY_TOKEN` 불일치 또는 환경변수 변경 후 재배포를 안 한 경우입니다.
- `placeholder mediaId` 경고는 아직 영상이 안 올라간 동안은 정상입니다. 9단계 후에는 사라져야 합니다.

## 9. 첫 영상 업로드, 미디어 ID 찾기, repos.json 등록

1. `docs/publish-markitdown.md` 의 패키지대로 한국어 릴스는 한국어 계정에, 영어 릴스는 영어 계정에 업로드합니다. 대본은 `docs/script-markitdown.md`.
2. 미디어 ID 조회 (계정별로 따로, 토큰은 헤더로):

   ```bash
   curl -s -H "Authorization: Bearer $IG_KO_ACCESS_TOKEN" \
     "https://graph.instagram.com/v23.0/$IG_KO_USER_ID/media?fields=id,caption,permalink,media_type,timestamp"
   ```

   응답의 `data[]` 에서 방금 올린 영상의 `permalink`/`caption` 으로 구분해 **`id`** 를 복사합니다(숫자). 영어 계정은 `IG_EN_*` 로 같은 호출. 같은 영상이라도 계정마다 ID가 다릅니다.
   **더 쉬운 방법 (토큰 없이):** 영상을 올린 뒤 **앱 역할에 등록한 다른 계정으로 그 영상에 댓글을 하나 답니다**(키워드가 아니어도 됩니다). 봇은 등록되지 않은 게시물의 댓글이면 반응하지 않고 `igbot_events`에 `unmatched` 이벤트와 `detail = media:<게시물 ID>`만 남깁니다(댓글 내용·작성자는 저장하지 않음). Supabase에서 `select at, lang, detail from igbot_events where event = 'unmatched' order by at desc` 로 보거나 Claude Code에 "unmatched 이벤트의 미디어 ID 알려줘"라고 요청하세요. 이 방법은 웹훅이 실제로 도착한다는 확인도 겸합니다.
3. `data/repos.json` 의 예시 항목을 지우고 실제 값으로 바꿉니다(`docs/script-markitdown.md` 하단 예시 참고).

   ```json
   [
     { "id": "markitdown-ko", "mediaId": "<한국어 릴스 미디어 ID>", "keyword": "링크",
       "name": "MarkItDown", "url": "https://github.com/microsoft/markitdown" },
     { "id": "markitdown-en", "mediaId": "<영어 릴스 미디어 ID>", "keyword": "link",
       "name": "MarkItDown", "url": "https://github.com/microsoft/markitdown" }
   ]
   ```
4. 키워드는 영상의 마지막 CTA 자막과 정확히 같아야 합니다. `npm run bot:check` 로 형식·중복을 확인합니다.

## 10. PR과 배포 반영 확인

1. 브랜치를 만들어 `data/repos.json` 변경을 커밋하고 PR을 엽니다. 병합하면 Netlify가 빌드하면서 `repos.json` 을 검증해 함수에 넣습니다(형식이 틀리면 빌드가 실패해 잘못된 값이 배포되지 않습니다).
2. Netlify **Deploys** 에서 빌드 로그의 `netlify-build: 영상 N개` 가 기대한 개수인지 확인합니다.
3. `npm run bot:check -- --online --url https://<사이트>` 로 마지막 점검.
4. 실제 영상에 본인 두 번째 계정으로 댓글을 달아 DM이 오는지 확인합니다.

## 막혔을 때 (증상별)

| 증상 | 확인할 것 |
|---|---|
| 웹훅 "확인 실패"(콜백 URL 또는 확인 토큰이 유효하지 않음) | 사이트가 배포되었는지, URL이 `/webhook` 인지, 메타에 넣은 확인 토큰 = Netlify `VERIFY_TOKEN` 인지, 환경변수 변경 뒤 재배포했는지. `bot:check -- --url` 로 재현 |
| 대시보드(`/harness`) 403 또는 로그인 안 됨 | `DASHBOARD_TOKEN` 설정·재배포 여부. 로그인 계정은 Supabase `harness_admins` 에서 관리(`node scripts/admin-user.js`). 다른 주소(origin)에서 접속하면 403이 날 수 있으니 배포 주소로 접속 |
| 댓글을 달아도 아무 반응 없음 | `comments` 구독 여부(`bot:check --online`), **앱이 Live 모드인지, `comments`에 고급 액세스가 있는지**(공식 문서 기준 필요), 계정이 공개 계정인지, `mediaId`·`keyword` 불일치(`repos.json`), 계정이 한쪽만 설정됨 |
| DM이 안 감 | 비공개 답장은 댓글 후 **7일 이내**, 같은 사람에게 **먼저 보낼 수 있는 건 1통**, 후속 DM은 상대 응답 후 **24시간 이내**. 받는 쪽이 비팔로워면 **메시지 요청함**에 있음. `messages` 구독·권한, `igbot_events`의 `error` 행 detail 참고 |
| 웹훅이 401 | `APP_SECRET` 이 서명 시크릿과 다름. **Meta 앱 시크릿 ↔ Instagram 앱 시크릿 중 다른 쪽**을 넣어 보세요 |
| 웹훅이 500 `APP_SECRET is not configured` | `APP_SECRET` 미설정 |
| 웹훅이 500 `token store unavailable` | Supabase URL/키 오류 또는 6단계 테이블 없음 |
| `/me` 가 400/401(토큰 오류) | 토큰 만료·권한 철회·잘못 복사. 3단계로 재발급해 Netlify 값을 바꾸고 재배포 |
| 토큰이 만료됨 | 예약 함수가 갱신하지만, 오래 방치되면 만료되어 갱신 불가. 재발급 필요. Netlify의 `refresh-tokens` 함수 로그 확인 |
| 같은 댓글에 DM이 두 번 | `igbot_seen` 접근 오류 여부 확인(로그의 "중복 확인 실패") |

## 11. Live 전환과 앱 심사 (고급 액세스) — 별도 절

공식 문서 기준 요구사항입니다([앱 심사 문서](https://developers.facebook.com/documentation/instagram-platform/app-review)).

- **고급 액세스 대상 권한**: `instagram_business_manage_comments`, `instagram_business_manage_messages` (그리고 `instagram_business_basic`).
- **신청 위치**: 앱 대시보드 → *Instagram → API setup with Instagram login* → **Complete app review** → *Continue to app review*, 이어서 *App Review → Requests*에서 **Edit**.
- **준비물**: 앱 아이콘(1024×1024), **개인정보처리방침 URL**, 앱 카테고리, 심사 결과를 받을 업무용 이메일, 심사자가 따라 할 수 있는 단계별 테스트 방법(필요하면 테스트 계정), 권한마다 **성공한 API 호출 1회 이상**, 권한별 사용 설명, 권한별 **화면 녹화(스크린캐스트)**(영어 UI 권장, 자막/설명 추가).
- 문서상 "여러 사업체에 서비스하는 앱"은 심사가 필수이고, **내가 소유·관리하는 계정만 쓰는 앱은 Standard Access로 심사 없이 가능**하다고 합니다. 그러나 `comments` 웹훅은 고급 액세스를 요구한다고도 적혀 있어, **우리 경우 심사가 필요한지는 7단계 실험 결과로 판단**하세요.
- **문서에 없어서 확인하지 못한 것**: 비즈니스 인증(Business Verification) 필요 여부, 심사 소요 기간. 심사 화면의 안내를 따르세요.
