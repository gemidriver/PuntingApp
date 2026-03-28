-- RLS: Block updates to user_submissions within 1 hour of first race
-- (Assumes you have a function to get the earliest race time for a user's meets)

-- Example: Add this to your Supabase SQL editor
-- You may need to adjust the logic to match your schema and timezone handling

create or replace function public.can_update_submission(user_id uuid) returns boolean as $$
declare
  earliest_race timestamptz;
  now_time timestamptz := now();
begin
  -- Find the earliest race time for this user's selected meets
  select min((r.value->>'time')::timestamptz)
    into earliest_race
    from user_submissions s,
         jsonb_array_elements(s.selections) as sel,
         lateral (
           select value from jsonb_array_elements(sel->'races') as value
         ) r
   where s.user_id = user_id;

  if earliest_race is null then
    return true; -- allow if no races found
  end if;

  -- Only allow update if now is at least 1 hour before the earliest race
  return now_time < (earliest_race - interval '1 hour');
end;
$$ language plpgsql security definer;

-- Policy: Only allow update if can_update_submission returns true
alter policy "submissions_update_own_or_admin" on public.user_submissions
  using ((auth.uid() = user_id or public.is_admin_user(auth.uid())) and public.can_update_submission(user_id));
