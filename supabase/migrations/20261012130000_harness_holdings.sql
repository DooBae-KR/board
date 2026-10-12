-- 대시보드 "나의 주식수익률": 사람이 직접 입력한 보유·거래 종목.
-- 개인 투자 정보라서 service_role 전용이다(RLS 켬, anon/authenticated 권한 없음). 브라우저는 서버 API(/api/harness/holdings)만 쓴다.

create table public.harness_holdings (
  id             uuid primary key default gen_random_uuid(),
  name           text not null check (char_length(name) between 1 and 40),
  code           text check (code is null or code ~ '^[0-9A-Za-z]{6}$'),
  sector         text not null default '미분류' check (char_length(sector) between 1 and 20),
  qty            integer not null check (qty > 0),
  buy_price      numeric(14,2) not null check (buy_price > 0),
  buy_date       date not null default current_date,
  sell_price     numeric(14,2) check (sell_price is null or sell_price > 0),
  sell_date      date,
  current_price  numeric(14,2) check (current_price is null or current_price > 0), -- 아직 팔지 않은 종목의 평가용 가격(직접 입력)
  created_at     timestamptz not null default now(),
  constraint harness_holdings_sell_pair check ((sell_price is null) = (sell_date is null))
);
create index harness_holdings_buy_idx on public.harness_holdings (buy_date desc, created_at desc);

alter table public.harness_holdings enable row level security;
revoke all on public.harness_holdings from anon, authenticated;
