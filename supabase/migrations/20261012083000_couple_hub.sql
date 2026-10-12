-- 우리 허브(couple-hub): 2인 공유 가계부·일정·할 일(동적 카테고리) + 개인 스터디 플래너
-- 이미 적용된 DB와 같은 내용이며 여러 번 실행해도 안전하다(idempotent).
-- 하네스(`harness_`)·인스타 봇(`igbot_`)·다른 앱 테이블과 겹치지 않도록 모두 `cp_` 접두사를 쓴다.
-- 접근 제어는 전부 RLS로 한다: 커플 데이터는 두 구성원만, 스터디 데이터는 본인만.

-- ── 커플 ─────────────────────────────────────────────────
create table if not exists public.cp_couples (
  id uuid primary key default gen_random_uuid(),
  name text not null default '우리',
  invite_code text not null unique default substr(md5(random()::text || clock_timestamp()::text), 1, 8),
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);
create table if not exists public.cp_members (
  couple_id uuid not null references public.cp_couples(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null default '나',
  joined_at timestamptz not null default now(),
  primary key (couple_id, user_id)
);
create index if not exists cp_members_user_idx on public.cp_members(user_id);

create or replace function public.cp_is_member(cid uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.cp_members m where m.couple_id = cid and m.user_id = auth.uid()) $$;

-- kind: ledger(금액/차트) | event(날짜/일정) | todo(체크) | table(사용자 정의 필드)
create table if not exists public.cp_categories (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.cp_couples(id) on delete cascade,
  kind text not null check (kind in ('ledger','event','todo','table')),
  name text not null check (char_length(name) between 1 and 40),
  icon text not null default '📁',
  fields jsonb not null default '[]'::jsonb,
  sort int not null default 100,
  created_at timestamptz not null default now(),
  unique (couple_id, name)
);
create table if not exists public.cp_records (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.cp_couples(id) on delete cascade,
  category_id uuid not null references public.cp_categories(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  amount numeric,
  on_date date,
  done boolean not null default false,
  data jsonb not null default '{}'::jsonb,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists cp_records_cat_idx on public.cp_records(couple_id, category_id, on_date desc);

create table if not exists public.cp_watchlist (
  couple_id uuid not null references public.cp_couples(id) on delete cascade,
  symbol text not null check (symbol ~ '^[A-Z.\-]{1,10}$'),
  note text,
  added_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (couple_id, symbol)
);

alter table public.cp_couples enable row level security;
alter table public.cp_members enable row level security;
alter table public.cp_categories enable row level security;
alter table public.cp_records enable row level security;
alter table public.cp_watchlist enable row level security;

drop policy if exists cp_couples_sel on public.cp_couples;
create policy cp_couples_sel on public.cp_couples for select to authenticated using (public.cp_is_member(id));
drop policy if exists cp_couples_upd on public.cp_couples;
create policy cp_couples_upd on public.cp_couples for update to authenticated using (public.cp_is_member(id)) with check (public.cp_is_member(id));
drop policy if exists cp_members_sel on public.cp_members;
create policy cp_members_sel on public.cp_members for select to authenticated using (public.cp_is_member(couple_id));
drop policy if exists cp_members_upd on public.cp_members;
create policy cp_members_upd on public.cp_members for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists cp_members_del on public.cp_members;
create policy cp_members_del on public.cp_members for delete to authenticated using (user_id = auth.uid());
drop policy if exists cp_categories_all on public.cp_categories;
create policy cp_categories_all on public.cp_categories for all to authenticated using (public.cp_is_member(couple_id)) with check (public.cp_is_member(couple_id));
drop policy if exists cp_records_all on public.cp_records;
create policy cp_records_all on public.cp_records for all to authenticated using (public.cp_is_member(couple_id))
  with check (public.cp_is_member(couple_id) and exists (select 1 from public.cp_categories c where c.id = category_id and c.couple_id = cp_records.couple_id));
drop policy if exists cp_watchlist_all on public.cp_watchlist;
create policy cp_watchlist_all on public.cp_watchlist for all to authenticated using (public.cp_is_member(couple_id)) with check (public.cp_is_member(couple_id));

-- 커플 만들기 (+ 기본 카테고리 3개 시드)
create or replace function public.cp_create_couple(p_name text, p_display_name text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare cid uuid;
begin
  if auth.uid() is null then raise exception 'login required'; end if;
  insert into public.cp_couples(name) values (coalesce(nullif(p_name,''),'우리')) returning id into cid;
  insert into public.cp_members(couple_id, user_id, display_name) values (cid, auth.uid(), coalesce(nullif(p_display_name,''),'나'));
  insert into public.cp_categories(couple_id, kind, name, icon, sort) values
    (cid,'ledger','데이트통장','💰',10), (cid,'event','우리 일정','📅',20), (cid,'todo','같이 할 일','✅',30);
  return cid;
end $$;

-- 초대 코드로 합류 (커플당 최대 2명)
create or replace function public.cp_join_couple(p_code text, p_display_name text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare cid uuid;
begin
  if auth.uid() is null then raise exception 'login required'; end if;
  select id into cid from public.cp_couples where invite_code = lower(trim(p_code));
  if cid is null then raise exception 'invalid invite code'; end if;
  if (select count(*) from public.cp_members where couple_id = cid) >= 2
     and not exists (select 1 from public.cp_members where couple_id = cid and user_id = auth.uid()) then
    raise exception 'couple is full';
  end if;
  insert into public.cp_members(couple_id, user_id, display_name)
    values (cid, auth.uid(), coalesce(nullif(p_display_name,''),'나'))
    on conflict do nothing;
  return cid;
end $$;

revoke all on function public.cp_create_couple(text,text), public.cp_join_couple(text,text), public.cp_is_member(uuid) from public, anon;
grant execute on function public.cp_create_couple(text,text), public.cp_join_couple(text,text), public.cp_is_member(uuid) to authenticated;
revoke all on public.cp_couples, public.cp_members, public.cp_categories, public.cp_records, public.cp_watchlist from anon;

-- ── 스터디 플래너 (본인 전용) ───────────────────────────────
create table if not exists public.cp_study_exams (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 80),
  exam_date date not null,
  created_at timestamptz not null default now()
);
create table if not exists public.cp_study_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  plan_date date not null,
  subject text not null default '일반' check (char_length(subject) between 1 and 40),
  title text not null check (char_length(title) between 1 and 200),
  target_minutes int not null default 0 check (target_minutes between 0 and 1440),
  done boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists cp_study_plans_idx on public.cp_study_plans(user_id, plan_date);

-- 업로드한 학습 파일. 원본은 저장하지 않고 브라우저에서 추출한 텍스트만 저장한다
create table if not exists public.cp_study_files (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  study_date date not null,
  file_name text not null check (char_length(file_name) <= 200),
  mime text,
  size_bytes bigint,
  content_text text check (char_length(content_text) <= 200000),
  extract_status text not null default 'ok' check (extract_status in ('ok','empty','unsupported')),
  summary_status text not null default 'pending' check (summary_status in ('pending','done','failed','skipped')),
  created_at timestamptz not null default now()
);
create index if not exists cp_study_files_idx on public.cp_study_files(user_id, study_date);

-- 다음날 아침 요약 (하루 1건): key_points = [{text, importance(1~3), subject}]
create table if not exists public.cp_study_digests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  study_date date not null,
  summary text not null,
  key_points jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, study_date)
);
-- 에이전트가 학습한 주제 지식(반복 등장할수록 mentions 증가)
create table if not exists public.cp_study_topics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  subject text not null,
  topic text not null,
  mentions int not null default 1,
  last_seen date not null default current_date,
  note text,
  unique (user_id, subject, topic)
);
-- 주간 문서 + 다운로드 여부 알림 상태
create table if not exists public.cp_study_weekly (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  week_start date not null,
  doc_md text not null,
  status text not null default 'ready' check (status in ('ready','downloaded','dismissed','declined')),
  created_at timestamptz not null default now(),
  unique (user_id, week_start)
);

do $$
declare t text;
begin
  foreach t in array array['cp_study_exams','cp_study_plans','cp_study_files','cp_study_digests','cp_study_topics','cp_study_weekly'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_own', t);
    execute format('create policy %I on public.%I for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())', t || '_own', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- 이 프로젝트는 새 테이블에 authenticated 기본 권한을 주지 않으므로 명시 부여한다 (행 접근은 위 RLS 정책이 제한)
grant select, update on public.cp_couples to authenticated;
grant select, update, delete on public.cp_members to authenticated;
grant select, insert, update, delete on public.cp_categories, public.cp_records, public.cp_watchlist to authenticated;
grant select, insert, update, delete on public.cp_study_exams, public.cp_study_plans, public.cp_study_files,
  public.cp_study_digests, public.cp_study_topics, public.cp_study_weekly to authenticated;
