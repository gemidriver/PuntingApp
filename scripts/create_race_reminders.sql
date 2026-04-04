-- Run this in Supabase SQL editor (or psql) to create the race_reminders table

create table if not exists public.race_reminders (
  id bigserial primary key,
  race_id text not null,
  race_name text not null,
  race_time timestamptz not null,
  course text not null,
  meet_id text not null,
  reminder_sent_at timestamptz not null default now(),
  unique (race_id)
);
