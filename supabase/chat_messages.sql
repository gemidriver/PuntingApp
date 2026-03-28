-- Chat messages table for The Top Punter
create table if not exists public.chat_messages (
  id bigserial primary key,
  user_id uuid references auth.users(id) on delete set null,
  username text not null,
  message text not null,
  created_at timestamptz not null default now()
);

-- Allow all authenticated users to insert and select messages
create policy "chat_select_authenticated" on public.chat_messages
  for select to authenticated using (true);
create policy "chat_insert_authenticated" on public.chat_messages
  for insert to authenticated with check (true);
