-- 대시보드 로그인 계정. 회원가입은 없고 개발자가 scripts/admin-user.js로만 만든다.
-- 비밀번호는 scrypt 해시로만 저장한다. 해시도 읽히면 안 되므로 읽기 정책을 만들지 않는다(service_role 전용).
-- 같은 프로젝트에 다른 앱의 로그인 사용자(authenticated)가 있어서, 그들이 읽지 못하게 막는다.

create table public.harness_admins (
  username       text primary key check (username ~ '^[a-z0-9][a-z0-9._-]{2,31}$'),
  password_hash  text not null check (password_hash like 'scrypt$%'),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

alter table public.harness_admins enable row level security;
revoke all on public.harness_admins from anon, authenticated;
