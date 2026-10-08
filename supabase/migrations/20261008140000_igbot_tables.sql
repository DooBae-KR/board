-- 인스타 DM 봇을 Netlify Functions(서버리스)에서 돌리기 위한 테이블.
-- 디스크가 없으므로 토큰 파일, 웹훅 중복 방지 메모리, 집계 메모리를 DB로 옮긴다.
-- 하네스(harness_)와 다른 앱 테이블은 건드리지 않는다. 접근은 service_role(서버 전용)만 한다.

create table public.igbot_tokens (
  lang        text primary key check (lang in ('ko', 'en')),
  token       text not null,
  seed_sha256 text not null,            -- 환경변수 토큰의 해시: 값이 바뀌면(수동 재발급) 저장본보다 환경변수를 쓴다
  expires_at  timestamptz,
  updated_at  timestamptz not null default now()
);

create table public.igbot_seen (
  key        text primary key,          -- 처리한 웹훅 이벤트 키 (예: c:<댓글 id>)
  created_at timestamptz not null default now()
);
create index igbot_seen_created_idx on public.igbot_seen (created_at);

create table public.igbot_events (
  id      bigint generated always as identity primary key,
  at      timestamptz not null default now(),
  lang    text not null,
  event   text not null,
  repo_id text,
  detail  text
);
create index igbot_events_at_idx on public.igbot_events (at desc);

alter table public.igbot_tokens enable row level security;
alter table public.igbot_seen   enable row level security;
alter table public.igbot_events enable row level security;
-- 정책을 만들지 않으므로 anon/authenticated는 읽지도 쓰지도 못한다. 권한도 회수해 둔다.
revoke all on public.igbot_tokens, public.igbot_seen, public.igbot_events from anon, authenticated;
