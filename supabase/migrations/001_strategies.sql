-- FinHub Chart: strategies hub + drawings + backtest runs
-- Apply in Supabase SQL editor (or `supabase db push`) after creating the project.

create extension if not exists "pgcrypto";

-- Profiles (1:1 with auth.users)
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles_select_own"
  on public.profiles for select
  using (auth.uid() = id);

create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Strategies (named chart workspaces)
create table if not exists public.strategies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
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

alter table public.strategies enable row level security;

create policy "strategies_select_own"
  on public.strategies for select
  using (auth.uid() = user_id);

create policy "strategies_insert_own"
  on public.strategies for insert
  with check (auth.uid() = user_id);

create policy "strategies_update_own"
  on public.strategies for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "strategies_delete_own"
  on public.strategies for delete
  using (auth.uid() = user_id);

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

-- Drawings: one row per strategy (full Drawing[] JSON)
create table if not exists public.strategy_drawings (
  strategy_id uuid primary key references public.strategies (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  payload jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.strategy_drawings enable row level security;

create policy "strategy_drawings_select_own"
  on public.strategy_drawings for select
  using (auth.uid() = user_id);

create policy "strategy_drawings_insert_own"
  on public.strategy_drawings for insert
  with check (auth.uid() = user_id);

create policy "strategy_drawings_update_own"
  on public.strategy_drawings for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "strategy_drawings_delete_own"
  on public.strategy_drawings for delete
  using (auth.uid() = user_id);

drop trigger if exists strategy_drawings_set_updated_at on public.strategy_drawings;
create trigger strategy_drawings_set_updated_at
  before update on public.strategy_drawings
  for each row execute function public.set_updated_at();

-- Backtest run history
create table if not exists public.backtest_runs (
  id uuid primary key default gen_random_uuid(),
  strategy_id uuid not null references public.strategies (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
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

alter table public.backtest_runs enable row level security;

create policy "backtest_runs_select_own"
  on public.backtest_runs for select
  using (auth.uid() = user_id);

create policy "backtest_runs_insert_own"
  on public.backtest_runs for insert
  with check (auth.uid() = user_id);

create policy "backtest_runs_delete_own"
  on public.backtest_runs for delete
  using (auth.uid() = user_id);
