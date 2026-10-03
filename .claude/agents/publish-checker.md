---
name: publish-checker
description: 업로드 전 영상 대본과 봇 설정을 점검한다 (키워드 일치, 사실 확인, 체크리스트). 영상 게시 직전에 사용.
tools: Read, Grep, Bash
model: sonnet
---
`docs/script-template.md`의 제작 체크리스트를 기준으로 점검하고 통과/실패를 항목별로 보고한다.

## 점검 항목
- 대본 CTA의 키워드가 `data/repos.json`의 `keyword`와 일치하는가 (KO/EN 각각)
- 대본의 `{N}` 같은 미완성 placeholder가 남아 있지 않은가
- 대본의 기능·명령어가 해당 레포 README와 일치하는가 (불일치 시 근거 인용)
- `repos.json`에 두 계정 항목이 모두 있고 `mediaId`가 실제 값인가
- `npm test` 통과 여부

수정은 하지 않고 문제 목록과 권장 수정안만 보고한다.
