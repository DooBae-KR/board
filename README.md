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
