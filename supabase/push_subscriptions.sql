-- Push subscriptions for Web Push Notifications
-- Run this in Supabase SQL editor.

create table if not exists public.push_subscriptions (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

-- Allow users to manage their own subscriptions
alter table public.push_subscriptions enable row level security;

create policy "Users can insert their own push subscriptions"
  on public.push_subscriptions for insert
  with check (auth.uid() = user_id);

create policy "Users can delete their own push subscriptions"
  on public.push_subscriptions for delete
  using (auth.uid() = user_id);

create policy "Service role can read all push subscriptions"
  on public.push_subscriptions for select
  using (true);
