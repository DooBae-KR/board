-- 대시보드 "작업 지시" 대화창: 사람이 적은 작업을 에이전트별 요청함에 쌓는다.
-- 에이전트는 서버 API(POST /api/harness/tasks/next)로 가져가고, done/fail 보고 때 상태가 닫힌다.
-- 작업 내용에는 민감한 문장이 들어갈 수 있으므로 읽기 정책을 만들지 않는다(service_role 전용).
-- 같은 프로젝트에 다른 앱의 로그인 사용자(authenticated)가 있어서, 그들이 읽지 못하게 막는다.

create table public.harness_tasks (
  id          uuid primary key default gen_random_uuid(),
  agent_id    text not null references public.harness_agents(id) on delete cascade,
  body        text not null check (char_length(body) between 1 and 2000),
  status      text not null default 'queued' check (status in ('queued', 'claimed', 'done', 'failed', 'cancelled')),
  created_at  timestamptz not null default now(),
  claimed_at  timestamptz,
  closed_at   timestamptz
);
create index harness_tasks_agent_idx  on public.harness_tasks (agent_id, created_at desc);
create index harness_tasks_queue_idx  on public.harness_tasks (agent_id, created_at) where status = 'queued';

alter table public.harness_tasks enable row level security;
revoke all on public.harness_tasks from anon, authenticated;
