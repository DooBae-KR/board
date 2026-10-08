# substrate/

[Agent Substrate](https://docs.cloud.google.com/kubernetes-engine/ai-ml/about-agent-substrate) 매니페스트입니다. 규칙은 `CLAUDE.md` 4장.

| 개념 | 하네스에서 |
|---|---|
| ActorTemplate | `actortemplate.<이름>.yaml`. 에이전트 MD의 `substrate_template`이 이 이름을 가리킨다 |
| Actor | 에이전트 1명. 이름 = `agents/<id>.md`의 `id` |
| WorkerPool | `workerpool.harness.yaml`. 깨어난 Actor가 올라가는 샌드박스 묶음 |

## 설치 전 확인
- GKE Standard 1.36(베타 플래그) 또는 1.37 이상, Workload Identity Federation 필요
- Cloud Shell은 디스크가 부족해 설치에 쓸 수 없음
- 현재 평가·비운영 용도로 제공됨 (운영은 허용 목록 기반 비공개 GA)

## 에이전트 등록 흐름
```
node --env-file=.env scripts/agents-sync.js          # MD → Supabase
kubectl apply -f substrate/                          # 템플릿·풀 (최초 1회 / 변경 시)
kubectl ate create atespace harness                   # 최초 1회
kubectl ate create actor lumi -a harness --template=harness-agent
```

`<digest>`, `<registry>`, `<bucket>` 자리는 실제 값으로 바꿔야 합니다. 비밀값은 `harness-supabase` Secret으로만 넣습니다.
