-- Run this in Supabase SQL editor.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique not null,
  username text unique not null,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.user_submissions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  selections jsonb not null default '[]'::jsonb,
  wildcard jsonb,
  submitted boolean not null default false,
  submitted_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.race_results (
  id bigserial primary key,
  meet_id text not null,
  race_id text not null,
  horse_id text not null,
  horse_name text,
  finishing_position int not null check (finishing_position >= 1),
  result_date date,
  imported_at timestamptz not null default now(),
  unique (meet_id, race_id, horse_id)
);

create table if not exists public.user_selection_scores (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  username text not null,
  meet_id text not null,
  race_id text not null,
  horse_id text not null,
  horse_name text,
  finishing_position int,
  base_points int not null default 0,
  wildcard_multiplier int not null default 1,
  total_points int not null default 0,
  scored_at timestamptz not null default now(),
  unique (user_id, meet_id, race_id)
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists app_settings_set_updated_at on public.app_settings;
create trigger app_settings_set_updated_at
before update on public.app_settings
for each row execute function public.set_updated_at();

drop trigger if exists user_submissions_set_updated_at on public.user_submissions;
create trigger user_submissions_set_updated_at
before update on public.user_submissions
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  is_first_user boolean;
  raw_username text;
  username_value text;
begin
  select not exists (select 1 from public.profiles) into is_first_user;

  raw_username := nullif(new.raw_user_meta_data ->> 'username', '');
  username_value := coalesce(raw_username, split_part(new.email, '@', 1));

  insert into public.profiles (id, email, username, is_admin)
  values (new.id, new.email, username_value, is_first_user)
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.is_admin_user(uid uuid)
returns boolean
language sql
stable
as $$
  select coalesce((select p.is_admin from public.profiles p where p.id = uid), false);
$$;

create or replace function public.points_for_position(position_value int)
returns int
language sql
immutable
as $$
  select case
    when position_value = 1 then 4
    when position_value = 2 then 2
    when position_value = 3 then 1
    else 0
  end;
$$;

create or replace function public.recalculate_scores_for_meet(target_meet_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.user_selection_scores
  where meet_id = target_meet_id;

  insert into public.user_selection_scores (
    user_id,
    username,
    meet_id,
    race_id,
    horse_id,
    horse_name,
    finishing_position,
    base_points,
    wildcard_multiplier,
    total_points
  )
  select
    us.user_id,
    us.username,
    sel.meet_id,
    sel.race_id,
    sel.horse_id,
    sel.horse_name,
    rr.finishing_position,
    public.points_for_position(rr.finishing_position) as base_points,
    case
      when us.wildcard ->> 'meetId' = sel.meet_id and us.wildcard ->> 'raceId' = sel.race_id then 2
      else 1
    end as wildcard_multiplier,
    public.points_for_position(rr.finishing_position) *
    case
      when us.wildcard ->> 'meetId' = sel.meet_id and us.wildcard ->> 'raceId' = sel.race_id then 2
      else 1
    end as total_points
  from public.user_submissions us
  join lateral (
    select
      selection ->> 'meetId' as meet_id,
      selection ->> 'raceId' as race_id,
      selection ->> 'horseId' as horse_id,
      selection ->> 'horseName' as horse_name
    from jsonb_array_elements(us.selections) selection
  ) sel on true
  left join public.race_results rr
    on rr.meet_id = sel.meet_id
   and rr.race_id = sel.race_id
   and rr.horse_id = sel.horse_id
  where us.submitted = true
    and sel.meet_id = target_meet_id;
end;
$$;

alter table public.profiles enable row level security;
alter table public.app_settings enable row level security;
alter table public.user_submissions enable row level security;
alter table public.race_results enable row level security;
alter table public.user_selection_scores enable row level security;

-- Profiles
create policy if not exists "profiles_select_authenticated"
on public.profiles
for select
to authenticated
using (true);

create policy if not exists "profiles_select_anon_for_login"
on public.profiles
for select
to anon
using (true);

create policy if not exists "profiles_insert_own"
on public.profiles
for insert
to authenticated
with check (auth.uid() = id);

create policy if not exists "profiles_update_own_or_admin"
on public.profiles
for update
to authenticated
using (auth.uid() = id or public.is_admin_user(auth.uid()))
with check (auth.uid() = id or public.is_admin_user(auth.uid()));

-- App settings
create policy if not exists "settings_select_authenticated"
on public.app_settings
for select
to authenticated
using (true);

create policy if not exists "settings_upsert_admin"
on public.app_settings
for all
to authenticated
using (public.is_admin_user(auth.uid()))
with check (public.is_admin_user(auth.uid()));

-- Submissions
drop policy if exists "submissions_select_own_or_admin" on public.user_submissions;
drop policy if exists "submissions_select_authenticated" on public.user_submissions;

create policy "submissions_select_authenticated"
on public.user_submissions
for select
to authenticated
using (true);

create policy if not exists "submissions_insert_own"
on public.user_submissions
for insert
to authenticated
with check (auth.uid() = user_id);

create policy if not exists "submissions_update_own_or_admin"
on public.user_submissions
for update
to authenticated
using (auth.uid() = user_id or public.is_admin_user(auth.uid()))
with check (auth.uid() = user_id or public.is_admin_user(auth.uid()));

-- Race results
create policy if not exists "race_results_select_authenticated"
on public.race_results
for select
to authenticated
using (true);

create policy if not exists "race_results_write_admin"
on public.race_results
for all
to authenticated
using (public.is_admin_user(auth.uid()))
with check (public.is_admin_user(auth.uid()));

-- Scored selections
create policy if not exists "scores_select_own_or_admin"
on public.user_selection_scores
for select
to authenticated
using (auth.uid() = user_id or public.is_admin_user(auth.uid()));

create policy if not exists "scores_write_admin"
on public.user_selection_scores
for all
to authenticated
using (public.is_admin_user(auth.uid()))
with check (public.is_admin_user(auth.uid()));
