# 대시보드 → Claude Code 요청 연결 매뉴얼

대시보드 상단 입력창에 적은 글을 **Claude Code 루틴(API 트리거)** 으로 보내 새 Claude Code 세션을 시작합니다.
공식 문서: [Automate work with routines](https://code.claude.com/docs/en/routines) (연구 미리보기 기능이라 요청 형식·한도가 바뀔 수 있습니다).

```
대시보드 입력창 ─▶ 서버 POST /api/harness/request ─▶ 루틴 /fire (토큰은 서버에만) ─▶ 새 Claude Code 세션
                                                                                   │ 작업하며 harness-report.js로 상태 보고
                                                                                   └▶ 코드 변경이 있으면 claude/ 브랜치 + PR (머지는 사람)
```

## 이미 만들어진 것
- 루틴 **"대시보드 요청 처리"** (`trig_01Um5GaG3tKd88EVAm6NqnFm`). 스케줄 없음, 실행할 때마다 새 세션, 커넥터 없음.
- 루틴 프롬프트: `<routine-fire-payload>`의 요청을 수행하되 `CLAUDE.md`를 따르고, `claude/` 브랜치에서만 작업, **PR은 열되 머지 금지**, 비밀값·운영 DB 변경·워크플로/설정 파일 변경 금지.

## 사용자가 직접 해야 하는 설정 (claude.ai 웹에서만 가능)

1. https://claude.ai/code/routines → **대시보드 요청 처리** → 메뉴 → **Edit**
2. **저장소 추가**: `DooBae-KR/board`. (지금은 비어 있습니다. 비어 있어도 세션이 스스로 추가를 시도하도록 프롬프트에 적어 뒀지만, 여기서 추가하는 쪽이 확실합니다.)
3. **커넥터 확인**: 하나도 없어야 합니다. 웹 폼은 연결된 커넥터를 기본으로 모두 포함하므로, 있다면 전부 제거하세요(특히 Supabase 커넥터는 DB를 직접 바꿀 수 있습니다).
4. **환경(Environment)**:
   - 환경변수 `HARNESS_API_URL`(예: `https://samgukji.netlify.app`)과 `HARNESS_API_TOKEN`을 넣으면 세션이 진행 상황을 대시보드에 보고합니다. 환경변수는 그 환경을 쓰는 사람에게 보이므로 **`HARNESS_API_TOKEN`처럼 권한이 작은 값만** 넣고, 서비스 롤 키 같은 강한 비밀값은 넣지 마세요.
   - 네트워크 접근: 기본(Trusted)은 허용 목록 밖 도메인을 막습니다. 보고하려면 **Custom**으로 바꿔 대시보드 도메인을 허용하세요.
5. **Select a trigger → Add another trigger → API**. 저장하면 URL이 나오고 **Generate token**으로 토큰을 만듭니다. **토큰은 한 번만 보이니 바로 복사하세요.**
6. 서버 환경변수에 넣고 재배포합니다 (Netlify: Site configuration → Environment variables, 토큰은 Secret).

   | 이름 | 값 |
   |---|---|
   | `ROUTINE_FIRE_URL` | `https://api.anthropic.com/v1/claude_code/routines/trig_…/fire` |
   | `ROUTINE_FIRE_TOKEN` | 5단계에서 복사한 토큰 (`sk-ant-oat01-…`) |

7. 대시보드 상단 입력창에 요청을 적고 **요청 보내기** → "세션 열기" 링크로 세션이 시작됐는지 확인합니다. 시험은 `다음 영상 후보 3개 찾아서 알려줘`처럼 파일을 바꾸지 않는 요청으로 하세요.

## 동작 규칙
- 요청은 최대 2000자. 토큰·키로 보이는 값은 서버가 거절합니다. 서버는 시간당 10번까지 보냅니다(인스턴스 단위 보조 장치). 루틴 쪽 한도는 **루틴당 시간당 30회, 계정당 100회**입니다.
- 보낸 글은 루틴에 "신뢰할 수 없는 데이터"로 감싸져 전달되고, 루틴 프롬프트가 그 블록을 수행하라고 명시합니다.
- 요청 하나가 풀 세션 하나이며 **구독 사용량**이 차감됩니다(API 키 요금이 아님).
- 최근 요청 20개는 이 브라우저에만 기록됩니다("최근 요청" 버튼).

## 안전
- **대시보드에 로그인한 사람은 누구나 저장소 작업을 시킬 수 있습니다.** 세션은 승인 없이 셸 명령을 실행합니다. 그래서 커넥터 제거, 서비스 키 미제공, PR만 열고 머지는 사람이라는 세 가지가 전제입니다. 머지는 GitHub 브랜치 보호로 막아 두면 더 안전합니다.
- 토큰이 유출되면 루틴 화면의 **Regenerate / Revoke**로 즉시 폐기하고 `ROUTINE_FIRE_TOKEN`을 바꿉니다. 이 토큰은 이 루틴을 시작하는 것 외에는 아무것도 못 합니다.
- 시작된 세션은 응답의 세션 주소(claude.ai/code)에서 볼 수 있고 거기서 중단할 수 있습니다.

## 문제 해결

| 증상 | 확인할 것 |
|---|---|
| "아직 연결되지 않았어요" (503) | `ROUTINE_FIRE_URL`, `ROUTINE_FIRE_TOKEN` 설정과 재배포. URL 형식은 `…/routines/trig_…/fire` |
| "토큰이 거절됐어요" (502) | 토큰 만료·폐기·잘못 복사. 루틴에서 Regenerate 후 환경변수 교체 |
| "시간당 호출 한도" (429) | 잠시 뒤 재시도. 서버 10회/시간, 루틴 30회/시간 |
| 세션이 시작되지만 저장소가 없다고 함 | 2단계에서 저장소 추가 |
| 에이전트 카드에 상태가 안 뜸 | 4단계 환경변수(`HARNESS_API_URL`/`TOKEN`)와 네트워크 허용 확인 |
| 요청이 무시됨 | 루틴 프롬프트가 `<routine-fire-payload>`를 수행하라고 적혀 있는지 확인 (지금 프롬프트에는 있음) |
