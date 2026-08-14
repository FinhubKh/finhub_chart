-- Pine Script library (user-owned) + which scripts are on a workspace chart
-- Apply in the Supabase SQL editor after 001_strategies.sql

create table if not exists public.pine_scripts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  source text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pine_scripts_user_id_updated_at_idx
  on public.pine_scripts (user_id, updated_at desc);

alter table public.pine_scripts enable row level security;

create policy "pine_scripts_select_own"
  on public.pine_scripts for select
  using (auth.uid() = user_id);

create policy "pine_scripts_insert_own"
  on public.pine_scripts for insert
  with check (auth.uid() = user_id);

create policy "pine_scripts_update_own"
  on public.pine_scripts for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "pine_scripts_delete_own"
  on public.pine_scripts for delete
  using (auth.uid() = user_id);

drop trigger if exists pine_scripts_set_updated_at on public.pine_scripts;
create trigger pine_scripts_set_updated_at
  before update on public.pine_scripts
  for each row execute function public.set_updated_at();

create table if not exists public.strategy_pine_overlays (
  strategy_id uuid not null references public.strategies (id) on delete cascade,
  script_id uuid not null references public.pine_scripts (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (strategy_id, script_id)
);

create index if not exists strategy_pine_overlays_user_id_idx
  on public.strategy_pine_overlays (user_id);

alter table public.strategy_pine_overlays enable row level security;

create policy "strategy_pine_overlays_select_own"
  on public.strategy_pine_overlays for select
  using (auth.uid() = user_id);

create policy "strategy_pine_overlays_insert_own"
  on public.strategy_pine_overlays for insert
  with check (auth.uid() = user_id);

create policy "strategy_pine_overlays_delete_own"
  on public.strategy_pine_overlays for delete
  using (auth.uid() = user_id);
