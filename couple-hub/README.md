# 우리 허브 (couple-hub)

두 사람이 같이 쓰는 데이트통장·일정·할 일, 미장 지표 분석, 개인 스터디 플래너입니다.
하네스(`agents/`, `src/`)·인스타 DM 봇과는 별개이며 서로의 코드와 테이블을 건드리지 않습니다.

## 구성
| 경로 | 내용 |
|---|---|
| `web/index.html` | 단일 페이지 앱. Supabase 로그인, 동적 카테고리 메뉴, 자동 차트, 미장 분석, 스터디 플래너 |
| `agent/app.py` | 미장 분석 API (FastAPI + yfinance + gs-quant 지표). 테스트: `python test_app.py` |
| `agent/study-digest-job.md` | 스터디 아침 요약·주간 문서 작업 지침 (예약 실행용) |
| `../supabase/migrations/20261012083000_couple_hub.sql` | `cp_` 테이블·RLS·함수 (여러 번 실행해도 안전) |
| `../agents/{stock-analyst,study-digest,web-qa,budget-advisor}.md` | 하네스 에이전트 정의 (부서: 우리 허브) |

`budget-advisor`(예산도우미)는 월별 거래를 정산·식비·생필품·세탁으로 분류하고, 절감 시나리오(전 → 후)와 실제 통계를 만든다. 분류 기준은 에이전트 정의 본문에 있다. 거래 내역은 개인 금융 정보라서 저장소에 올리지 않는다.

## 실행
1. 마이그레이션을 Supabase에 적용합니다. 운영 DB에는 이미 같은 내용이 적용돼 있습니다.
2. `web/index.html`을 정적 호스팅에 올리거나 `python -m http.server`로 엽니다.
3. 가입 → 커플 만들기 → 초대 코드를 상대에게 전달합니다 (커플당 2명).
4. 미장 분석은 `agent/`에서 `pip install -r requirements.txt && uvicorn app:app --port 8000`으로 켭니다.

## 보안 메모
- `web/index.html`에는 Supabase 프로젝트 주소와 **publishable(공개용) 키**가 들어 있습니다. 공개용 키라 노출돼도 되지만, 데이터 보호는 전적으로 RLS에 의존합니다. 서비스 롤 키는 절대 넣지 않습니다.
- 커플 데이터는 두 구성원만, 스터디 데이터는 본인만 읽고 씁니다. 스터디 파일은 원본을 저장하지 않고 브라우저에서 추출한 텍스트만 저장합니다.
- `cp_` 테이블은 하네스 규칙(`CLAUDE.md` 2장 3항)의 "브라우저는 서버 API만 쓴다"와 달리 브라우저가 Supabase에 직접 닿습니다. 하네스 테이블(`harness_`)과 별개의 앱이라 RLS로 보호하는 방식을 택했습니다.

## 알려진 한계
- gs-quant의 데이터 API는 Goldman Sachs 기관 자격증명이 필요해 쓰지 않습니다. 시세는 무료 소스(yfinance), gs-quant는 지표 계산 함수만 사용합니다.
- 매수·매도·손절 가격은 과거 가격 지표로 계산한 **참고 구간**이며 투자 권유나 수익 보장이 아닙니다. 백테스트로 검증된 규칙이 아닙니다.
- 스터디 요약은 txt·md·텍스트가 들어 있는 PDF만 지원합니다 (이미지·스캔본·Word 미지원).
- **하네스 보고 규칙과의 차이:** 평일 07:30 예약 작업(스터디 아침 요약)은 현재 `harness_agents`의 상태를 SQL로 직접 갱신합니다. `CLAUDE.md` 2장 5항은 `harness-report.js`(`HARNESS_API_TOKEN`)로 보고하라고 하므로, 예약 작업 환경에 API 주소·토큰을 연결하면 그쪽으로 바꿔야 합니다.
