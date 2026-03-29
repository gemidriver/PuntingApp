-- RLS: Block updates to user_submissions within 5 minutes of first race
-- (Assumes you have a function to get the earliest race time for a user's meets)

-- Example: Add this to your Supabase SQL editor
-- You may need to adjust the logic to match your schema and timezone handling

create or replace function public.can_update_submission(p_user_id uuid) returns boolean as $$
begin
  -- Lockout removed: allow updates at any time
  return true;
end;
$$ language plpgsql security definer;

-- Policy: Only allow update if can_update_submission returns true
alter policy "submissions_update_own_or_admin" on public.user_submissions
  using ((auth.uid() = user_id or public.is_admin_user(auth.uid())) and public.can_update_submission(user_id));
