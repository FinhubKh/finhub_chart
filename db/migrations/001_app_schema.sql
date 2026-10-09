-- FinHub Chart app schema for Cloud SQL + Firebase Auth UIDs (text).
create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id text primary key,
  email text,
  created_at timestamptz not null default now()
);

create table if not exists public.strategies (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public.profiles (id) on delete cascade,
  name text not null,
  pair text not null default 'XAUUSD',
  tf text not null default '1H',
  notes text,
  engine text,
  engine_params jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists strategies_user_id_updated_at_idx
  on public.strategies (user_id, updated_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists strategies_set_updated_at on public.strategies;
create trigger strategies_set_updated_at
  before update on public.strategies
  for each row execute function public.set_updated_at();

create table if not exists public.strategy_drawings (
  strategy_id uuid primary key references public.strategies (id) on delete cascade,
  user_id text not null references public.profiles (id) on delete cascade,
  payload jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

drop trigger if exists strategy_drawings_set_updated_at on public.strategy_drawings;
create trigger strategy_drawings_set_updated_at
  before update on public.strategy_drawings
  for each row execute function public.set_updated_at();

create table if not exists public.backtest_runs (
  id uuid primary key default gen_random_uuid(),
  strategy_id uuid not null references public.strategies (id) on delete cascade,
  user_id text not null references public.profiles (id) on delete cascade,
  engine text not null,
  params jsonb not null default '{}'::jsonb,
  tf text not null,
  start_at timestamptz,
  end_at timestamptz,
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists backtest_runs_strategy_created_at_idx
  on public.backtest_runs (strategy_id, created_at desc);

create table if not exists public.pine_scripts (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public.profiles (id) on delete cascade,
  name text not null,
  source text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pine_scripts_user_id_updated_at_idx
  on public.pine_scripts (user_id, updated_at desc);

drop trigger if exists pine_scripts_set_updated_at on public.pine_scripts;
create trigger pine_scripts_set_updated_at
  before update on public.pine_scripts
  for each row execute function public.set_updated_at();

create table if not exists public.strategy_pine_overlays (
  strategy_id uuid not null references public.strategies (id) on delete cascade,
  script_id uuid not null references public.pine_scripts (id) on delete cascade,
  user_id text not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (strategy_id, script_id)
);

create index if not exists strategy_pine_overlays_user_id_idx
  on public.strategy_pine_overlays (user_id);
