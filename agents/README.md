# agents/

하네스 에이전트 정의 폴더입니다. 파일 하나가 에이전트 한 명입니다. 규칙 전체는 루트의 `CLAUDE.md`를 보세요.

- 새 에이전트: `_template.md`를 복사해 `<id>.md`로 저장하고 frontmatter를 채운 뒤 `node scripts/agents-sync.js`
- 미리 보기(쓰지 않고 검사만): `node scripts/agents-sync.js --dry-run`
- 삭제한 MD를 Supabase에서도 내리기: `node scripts/agents-sync.js --prune`
- `_`로 시작하는 파일과 `README.md`는 동기화하지 않습니다.

| 파일 | 담는 것 | 기준 |
|---|---|---|
| `agents/<id>.md` | 이름, 역할, 캐릭터, 기본 부서, 도구, 작업 지침 | 저장소 |
| Supabase `harness_agents` 등 | 현재 부서, 업무, 단계, 진행률, 상태, 이동 기록 | Supabase |
| `motion/<id>/<state>/` | HyperFrames 모션 컴포지션 | 저장소 → 렌더 결과는 Storage |
| `substrate/` | Agent Substrate 매니페스트 | 클러스터 |

지금 들어 있는 14명(루미, 하루 등)은 대시보드 예시와 같은 **예시 에이전트**입니다(`example: true`). 실제 에이전트로 바꾸거나 지워도 됩니다.
