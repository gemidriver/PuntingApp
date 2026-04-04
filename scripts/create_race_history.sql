-- Create race_history table to store core race details when a race starts
create table if not exists public.race_history (
  id bigserial primary key,
  meet_id text not null,
  race_id text not null,
  race_name text not null,
  course text not null,
  race_time timestamptz,
  runners jsonb default '[]'::jsonb,
  meta jsonb default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(meet_id, race_id)
);
