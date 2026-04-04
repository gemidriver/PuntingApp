Commands you can run from terminal (replace placeholders):

1) Create table (run in Supabase SQL editor):

```sql
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
```

2) Verify table exists (PowerShell):

```powershell
Invoke-RestMethod -Uri "$env:NEXT_PUBLIC_SUPABASE_URL/rest/v1/race_reminders?select=*" -Headers @{ "apikey" = $env:SUPABASE_SERVICE_ROLE_KEY; "Authorization" = "Bearer $env:SUPABASE_SERVICE_ROLE_KEY" }
```

3) Trigger cron endpoint locally (requires dev server):

```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/race-reminders" -Method Post -Headers @{ "Authorization" = "Bearer $env:CRON_SECRET" }
```

4) Inspect notifications for a race (replace <RACE_ID>):

```powershell
Invoke-RestMethod -Uri "$env:NEXT_PUBLIC_SUPABASE_URL/rest/v1/notifications?race_id=eq.<RACE_ID>&order=created_at.desc" -Headers @{ "apikey" = $env:SUPABASE_SERVICE_ROLE_KEY; "Authorization" = "Bearer $env:SUPABASE_SERVICE_ROLE_KEY" }
```

Or use the provided PowerShell helper script:

```powershell
# run from project root
.
\scripts\check_and_trigger.ps1 -RaceId "demo-race-1"
```
