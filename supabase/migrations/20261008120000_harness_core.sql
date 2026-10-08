-- 하네스 핵심 스키마 (CLAUDE.md 2장)
-- 접두사 harness_ : 같은 프로젝트의 다른 앱 테이블(agent_team, agent_staff 등)과 섞이지 않게 한다.
-- 쓰기는 service_role(하네스 서버·스크립트)만. 대시보드 로그인 사용자는 읽기만.

create extension if not exists pgcrypto;

create or replace function public.harness_touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- 부서(섹션). 대시보드에서 만든 카테고리가 메뉴에 동적으로 생긴다.
create table public.harness_sections (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique check (length(name) between 1 and 40),
  parent_id   uuid references public.harness_sections(id) on delete set null,
  lead_agent  text,
  pose        text not null default 'idle',
  color       text not null default 'lavender',
  status      text not null default 'live' check (status in ('live', 'idle')),
  sort        int  not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (parent_id is distinct from id)
);
comment on table public.harness_sections is '하네스 부서(섹션). parent_id로 본부 › 팀 트리를 만든다';

-- 부서 위젯
create table public.harness_widgets (
  id          uuid primary key default gen_random_uuid(),
  section_id  uuid not null references public.harness_sections(id) on delete cascade,
  type        text not null check (type in ('kpi', 'donut', 'bars', 'line', 'list', 'feed')),
  title       text not null,
  size        text check (size in ('full', 'half', 'third')),
  data        jsonb not null default '{}'::jsonb,
  sort        int  not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index harness_widgets_section_idx on public.harness_widgets(section_id, sort);

-- 에이전트. 정의 컬럼은 agents/<id>.md에서 동기화되고, 런타임 컬럼은 harness-report.js가 쓴다.
create table public.harness_agents (
  id                  text primary key check (id ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
  -- 정의 (agents/<id>.md)
  name                text not null,
  role                text not null default '',
  pose                text not null default 'idle',
  color               text,
  model               text,
  substrate_template  text not null default 'harness-agent',
  motions             text[] not null default array['idle','working','walk','done','blocked'],
  tools               text[] not null default '{}',
  example             boolean not null default false,
  md_path             text not null,
  md_sha256           text,
  -- 런타임
  section_id          uuid references public.harness_sections(id) on delete set null,
  task                text not null default '',
  steps               jsonb not null default '[]'::jsonb,   -- [{ "t": "단계", "done": false }]
  progress            int  not null default 0 check (progress between 0 and 100),
  status              text not null default 'waiting' check (status in ('working', 'waiting', 'blocked', 'done', 'failed')),
  note                text not null default '',
  last_report_at      timestamptz,
  archived_at         timestamptz,            -- MD가 지워지면 --prune으로 표시 (기록은 남김)
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index harness_agents_section_idx on public.harness_agents(section_id) where archived_at is null;
comment on table public.harness_agents is '하네스 에이전트. 정의는 agents/*.md가 기준, 런타임 상태는 이 테이블이 기준';

-- 진행·이동 기록 (append-only)
create table public.harness_agent_events (
  id            bigint generated always as identity primary key,
  agent_id      text not null references public.harness_agents(id) on delete cascade,
  kind          text not null check (kind in ('start', 'step', 'progress', 'blocked', 'done', 'fail', 'assign', 'info')),
  message       text not null default '',
  from_section  uuid references public.harness_sections(id) on delete set null,
  to_section    uuid references public.harness_sections(id) on delete set null,
  output        text,
  data          jsonb,
  created_at    timestamptz not null default now()
);
create index harness_agent_events_agent_idx on public.harness_agent_events(agent_id, created_at desc);

-- HyperFrames 모션 클립 (CLAUDE.md 5장)
create table public.harness_agent_motions (
  agent_id          text not null references public.harness_agents(id) on delete cascade,
  state             text not null check (state in ('idle', 'working', 'walk', 'done', 'blocked')),
  composition_path  text not null,            -- motion/<id>/<state>/index.html 또는 motion/templates/<state>/index.html
  storage_path      text,                     -- agent-motions/<id>/<state>.mp4
  sha256            text,
  rendered_at       timestamptz,
  primary key (agent_id, state)
);

create trigger harness_sections_touch before update on public.harness_sections
  for each row execute function public.harness_touch_updated_at();
create trigger harness_widgets_touch before update on public.harness_widgets
  for each row execute function public.harness_touch_updated_at();
create trigger harness_agents_touch before update on public.harness_agents
  for each row execute function public.harness_touch_updated_at();

-- RLS: 로그인 사용자 읽기 전용, 쓰기는 service_role(RLS 우회)만
alter table public.harness_sections       enable row level security;
alter table public.harness_widgets        enable row level security;
alter table public.harness_agents         enable row level security;
alter table public.harness_agent_events   enable row level security;
alter table public.harness_agent_motions  enable row level security;

create policy harness_sections_read      on public.harness_sections      for select to authenticated using (true);
create policy harness_widgets_read       on public.harness_widgets       for select to authenticated using (true);
create policy harness_agents_read        on public.harness_agents        for select to authenticated using (archived_at is null);
create policy harness_agent_events_read  on public.harness_agent_events  for select to authenticated using (true);
create policy harness_agent_motions_read on public.harness_agent_motions for select to authenticated using (true);

revoke all on public.harness_sections, public.harness_widgets, public.harness_agents,
              public.harness_agent_events, public.harness_agent_motions from anon;

-- 대시보드 실시간 갱신
alter publication supabase_realtime add table
  public.harness_sections, public.harness_widgets, public.harness_agents, public.harness_agent_events;

-- 모션 영상 저장소 (비공개, 대시보드는 서명 URL로 재생)
insert into storage.buckets (id, name, public)
values ('agent-motions', 'agent-motions', false)
on conflict (id) do nothing;
