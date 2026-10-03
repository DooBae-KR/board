# GitHub 레포 소개 숏츠/릴스 대본 템플릿

길이 목표: **30~45초** · 구성: 훅 → 문제 → 해결(레포) → 데모 → 댓글 유도(CTA)
같은 영상 마스터에 **한국어/영어 대본만 바꿔** 두 계정에 올립니다.

---

## 0. 영상별 입력 시트 (먼저 채우기)

| 항목 | 값 |
|---|---|
| 레포 이름 | |
| GitHub URL | |
| 한 줄 요약 (무엇을 해주나) | |
| 해결하는 문제 | |
| 핵심 기능 3가지 | 1) 2) 3) |
| 스타 수 / 언어 | ★ / |
| 데모 화면 (녹화할 장면) | |
| 댓글 키워드 (KO / EN) | 링크 / link |
| 인스타 미디어 ID (KO / EN) | → `data/repos.json`에 등록 |

---

## 1. 한국어 대본

| 시간 | 장면 | 대사 / 자막 |
|---|---|---|
| 0–3초 **훅** | 결과물 먼저 보여주기 | "이거 **{문제}** 한 방에 해결해줍니다." / "아직도 **{불편한 방식}** 쓰세요?" |
| 3–8초 **문제** | 불편한 기존 방식 화면 | "보통은 **{기존 방식}** 때문에 **{고통}**." |
| 8–15초 **해결** | 레포 페이지, ★수 | "**{레포 이름}**, 깃허브 ★**{N}**개. **{한 줄 요약}**." |
| 15–32초 **데모** | 화면 녹화 (설치 → 실행 → 결과) | "기능 1: **{…}** / 기능 2: **{…}** / 기능 3: **{…}**" (기능마다 5초, 큰 자막) |
| 32–40초 **CTA** | 키워드 자막 크게 | "깃허브 주소가 필요하면 **'링크'** 라고 댓글 남겨주세요. **팔로우**하면 DM으로 바로 보내드려요." |

훅 패턴 예시
- "개발자 90%가 모르는 **{분야}** 레포"
- "이거 **무료 오픈소스**라고요?"
- "**{시간}** 걸리던 걸 **{시간}**으로 줄여줍니다"
- "스타 **{N}**개 레포, 이유 있습니다"

캡션: `{한 줄 요약} 🔗 주소는 '링크' 댓글 + 팔로우 → DM 자동 발송 #깃허브 #오픈소스 #개발자 #코딩`

---

## 2. English script

| Time | Scene | Voice / Caption |
|---|---|---|
| 0–3s **Hook** | Show the result first | "This **{solves problem}** in one command." / "Still **{painful way}**?" |
| 3–8s **Problem** | The old, painful way | "Normally you'd **{old way}**, which means **{pain}**." |
| 8–15s **Solution** | Repo page, star count | "**{Repo name}** — **{N}**★ on GitHub. **{one-line summary}**." |
| 15–32s **Demo** | Screen recording (install → run → result) | "Feature 1: **{…}** / Feature 2: **{…}** / Feature 3: **{…}**" (~5s each, big captions) |
| 32–40s **CTA** | Keyword on screen | "Want the GitHub link? Comment **'link'** and **follow** — I'll DM it to you." |

Hook patterns
- "99% of devs don't know this **{topic}** repo"
- "This is **free and open source**?"
- "What took **{time}** now takes **{time}**"
- "There's a reason this repo has **{N}**k stars"

Caption: `{one-line summary} 🔗 Comment 'link' + follow → link in your DMs #github #opensource #developer #coding`

---

## 3. 제작 체크리스트
- [ ] 첫 3초에 결과물/문제를 보여줬는가 (자기소개 금지)
- [ ] 자막은 화면 중앙 상단, 한 줄 5~8단어 이내
- [ ] 마지막 CTA에 **키워드**와 **"팔로우"** 문구를 모두 넣었는가
- [ ] 키워드가 `data/repos.json`의 `keyword`와 일치하는가
- [ ] 업로드 후 미디어 ID를 `repos.json`에 등록했는가 (계정별로 다름)
- [ ] 유튜브 쇼츠는 고정 댓글/설명란에 링크 (DM 불가)
