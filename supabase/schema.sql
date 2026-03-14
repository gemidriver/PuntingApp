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

alter table public.profiles enable row level security;
alter table public.app_settings enable row level security;
alter table public.user_submissions enable row level security;

-- Profiles
create policy if not exists "profiles_select_authenticated"
on public.profiles
for select
to authenticated
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
create policy if not exists "submissions_select_own_or_admin"
on public.user_submissions
for select
to authenticated
using (auth.uid() = user_id or public.is_admin_user(auth.uid()));

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
