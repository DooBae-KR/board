# motion/

에이전트 캐릭터 모션을 [HyperFrames](https://github.com/heygen-com/hyperframes)(HeyGen) HTML 컴포지션으로 관리합니다. 규칙은 `CLAUDE.md` 5장.

| 상태 | 언제 재생 | 기본 스프라이트 |
|---|---|---|
| `idle` | 대기 | 에이전트 `pose` |
| `working` | 업무 중 | 에이전트 `pose` |
| `walk` | 부서 이동(assign) 직후 | 에이전트 `pose` |
| `done` | 완료 | `happy` |
| `blocked` | 확인 필요·실패 | `flustered` |

- 공용 클립: `motion/templates/<state>/index.html` (512×512, 3초, GSAP)
- 전용 클립: `motion/<id>/<state>/index.html`을 만들면 그 에이전트는 공용 대신 이것을 씁니다.

## 렌더
```
node scripts/render-motions.js --dry-run            # motion/.build/<id>-<state>/ 준비만
cd motion/.build/lumi-working && npx hyperframes preview   # 브라우저 미리보기
node --env-file=.env scripts/render-motions.js lumi --upload   # lint → render → Storage 업로드
```
- 필요: Node 22+, FFmpeg, Chrome. Chrome 자동 다운로드가 막힌 환경이면 `export HYPERFRAMES_BROWSER_PATH=/usr/bin/google-chrome`처럼 설치된 브라우저를 지정합니다.
- 결과: Supabase Storage `agent-motions/<id>/<state>.mp4` + `harness_agent_motions`에 경로·SHA256 기록.
- `motion/.build/`는 커밋하지 않습니다.
