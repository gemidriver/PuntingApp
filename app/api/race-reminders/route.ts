import { Resend } from 'resend';
import { getSupabaseClient } from '../../../lib/supabase';
import { getSupabaseAdminClient } from '../../../lib/supabaseAdmin';
import { fetchRacesForCourse, fetchMarketRunners } from '../../../lib/betfair';
import { fetchMarketResults } from '../../../lib/theracingapi';

export const maxDuration = 60;

// Configurable reminder windows (minutes)
const REMINDER_MINUTES = Number(process.env.RACE_REMINDER_MINUTES || '5');
const STARTED_WINDOW_MINUTES = Number(process.env.RACE_STARTED_WINDOW_MINUTES || '2');
const BACKFILL_INTERVAL_MINUTES = Number(process.env.BACKFILL_INTERVAL_MINUTES || '60');
const BACKFILL_BATCH_SIZE = Number(process.env.BACKFILL_BATCH_SIZE || '500');

export async function POST(request: Request) {
  try {
    // Verify this is being called from Vercel Cron
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return Response.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const resendApiKey = String(process.env.RESEND_API_KEY || '').trim();
    const resendFromEmail = String(process.env.RESEND_FROM_EMAIL || '').trim();
    const canSendEmail = Boolean(resendApiKey && resendFromEmail);
    const resend = canSendEmail ? new Resend(resendApiKey) : null;

    // Use admin client on server so this cron can read/write protected settings/tables
    const supabase = getSupabaseAdminClient();

    // Get global meets from app_settings
    const { data: globalMeetsData } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'global_meets')
      .single();

    const globalMeets = Array.isArray(globalMeetsData?.value) ? globalMeetsData.value : [];
    
    if (globalMeets.length === 0) {
      return Response.json({ message: 'No active meets' });
    }

    const now = new Date();
    const fiveMinutesFromNow = new Date(now.getTime() + REMINDER_MINUTES * 60 * 1000);
    const twoMinutesAgo = new Date(now.getTime() - STARTED_WINDOW_MINUTES * 60 * 1000);
    const remindersToSend: Array<{
      raceId: string;
      raceName: string;
      raceTime: Date;
      course: string;
      email: string;
      username: string;
      userId?: string;
    }> = [];

    // Get all users for notifications
    const { data: allUsers } = await supabase
      .from('profiles')
      .select('id, email, username');

    // Check each meet for races starting in ~5 minutes
    for (const meet of globalMeets) {
      try {
        const racesResult = await fetchRacesForCourse(
          meet.meet_id,
          meet.date,
          meet.raceType
        );
        const races = racesResult.races || [];

        for (const race of races.slice(-4)) { // Last 4 races
          const raceTime = new Date(race.time);

          // Fetch current market runners with status to detect scratches/changes
          let currentRunnersWithStatus: Array<{ id: string; name: string; number: number | null; status?: string | null }> = [];
          try {
            const fetched = await fetchMarketRunners(race.id as string, true);
            currentRunnersWithStatus = Array.isArray(fetched) ? fetched.map((r: any) => ({ id: String(r.id), name: r.name || '', number: r.number ?? null, status: String(r.status ?? '').toUpperCase() || null })) : [];
          } catch (e) {
            console.error('Failed to fetch market runners (with status) for scratch detection', race.id, e);
          }

          // Compare to stored race_history to find newly-scratched runners
          try {
            const admin = getSupabaseAdminClient();
            const { data: existingHistory } = await admin.from('race_history').select('runners').eq('meet_id', meet.meet_id).eq('race_id', race.id).maybeSingle();
            const prevRunners: Array<any> = Array.isArray(existingHistory?.runners) ? existingHistory.runners : [];
            const prevStatusById = new Map<string, string | null>();
            for (const pr of prevRunners) {
              if (pr && pr.id) prevStatusById.set(String(pr.id), String(pr.status ?? '').toUpperCase() || null);
            }

            const newlyScratched = (currentRunnersWithStatus || []).filter((cr) => String(cr.status || '').toUpperCase() === 'REMOVED' && prevStatusById.get(String(cr.id)) !== 'REMOVED');
            if (newlyScratched.length) {
              console.log(`Detected ${newlyScratched.length} newly scratched runners for race ${race.id}:`, newlyScratched.map((r) => r.name));

              // Build notifications for all users (same approach as reminders)
              // Notify only users who have submissions for this meet
              try {
                const admin2 = getSupabaseAdminClient();
                const { data: submissions } = await admin2
                  .from('user_submissions')
                  .select('user_id,selections')
                  .eq('submitted', true);

                const userIds = new Set<string>();
                for (const s of submissions || []) {
                  try {
                    const sels = Array.isArray(s.selections) ? s.selections : [];
                    if (sels.find((x: any) => String(x?.meetId || '') === String(meet.meet_id))) {
                      if (s.user_id) userIds.add(String(s.user_id));
                    }
                  } catch (e) {
                    // ignore malformed rows
                  }
                }

                if (userIds.size) {
                  const { data: profilesForMeet, error: profErr } = await admin2
                    .from('profiles')
                    .select('id,email,username')
                    .in('id', [...userIds]);

                  if (profErr) {
                    console.error('Failed to load profiles for meet notifications', profErr);
                  } else if (Array.isArray(profilesForMeet) && profilesForMeet.length) {
                    const message = `Scratched: ${newlyScratched.map((r) => r.name).join(', ')}`;
                    const payload = (profilesForMeet || []).map((user: any) => ({
                      user_id: user.id,
                      race_id: race.id,
                      race_name: race.name,
                      course: meet.course,
                      notification_type: 'race_scratched',
                      message,
                      read_at: null,
                    }));

                    try {
                      const { data: notifData, error: notifErr } = await admin2.from('notifications').upsert(payload, { onConflict: 'user_id,race_id,notification_type' });
                      if (notifErr) console.error('Failed to upsert race_scratched notifications:', notifErr);
                    } catch (e) {
                      console.error('Exception upserting race_scratched notifications:', e);
                    }

                    // Send emails to these users only
                    if (canSendEmail && resend) {
                      try {
                        const emails = (profilesForMeet || []).map((u: any) => String(u.email || '')).filter(Boolean);
                        const unique = [...new Set(emails)];
                        const subject = `Scratch update: ${meet.course} - ${race.name}`;
                        const html = `<p>${message}</p>`;
                        const sendPromises = unique.map((to) => resend.emails.send({ from: resendFromEmail, to, subject, html }));
                        await Promise.allSettled(sendPromises);
                      } catch (e) {
                        console.error('Failed sending scratch emails', e);
                      }
                    }
                  }
                }
              } catch (e) {
                console.error('Error preparing meet-specific scratch notifications', e);
              }
            }
          } catch (e) {
            console.error('Scratch detection error for race', race.id, e);
          }
          
          // Check if race is in the 5-10 minute window (race starting soon)
          if (raceTime > now && raceTime <= fiveMinutesFromNow) {
            // Check if reminder already sent for this race
            const { data: existingReminder } = await supabase
              .from('race_reminders')
              .select('id')
              .eq('race_id', race.id)
              .maybeSingle();

            if (!existingReminder) {
              if (allUsers) {
                for (const user of allUsers) {
                  remindersToSend.push({
                    raceId: race.id,
                    raceName: race.name,
                    raceTime,
                    course: meet.course,
                    email: user.email,
                    username: user.username,
                    userId: user.id,
                  });
                }
              }

              // Mark reminder as sent
              await supabase
                .from('race_reminders')
                .insert({
                  race_id: race.id,
                  race_name: race.name,
                  race_time: raceTime.toISOString(),
                  course: meet.course,
                  meet_id: meet.meet_id,
                })
                .throwOnError();

              // Create in-app notifications for "race starting soon"
              if (allUsers) {
                const admin = getSupabaseAdminClient();
                const notificationPayload = allUsers.map(user => ({
                  user_id: user.id,
                  race_id: race.id,
                  race_name: race.name,
                  course: meet.course,
                  notification_type: 'race_starting_soon',
                  message: `${meet.course} - ${race.name} starts in 5 minutes!`,
                  read_at: null,
                }));

                const { data: upsertData, error: upsertError } = await admin
                  .from('notifications')
                  .upsert(notificationPayload, { onConflict: 'user_id,race_id,notification_type' });
                if (upsertError) {
                  console.error('Failed to upsert race_starting_soon notifications:', upsertError, { sample: notificationPayload && notificationPayload[0] });
                } else {
                  const upsertCount = Array.isArray(upsertData as any) ? (upsertData as any).length : 0;
                  console.log(`Upserted ${upsertCount} race_starting_soon notifications for race ${race.id}`);
                }
              }
            }
          }
          
          // Check if race has just started (within last 2 minutes)
          if (raceTime <= now && raceTime > twoMinutesAgo) {
            // Check if we already sent started notification
            const { data: existingStarted } = await supabase
              .from('notifications')
              .select('id')
              .eq('race_id', race.id)
              .eq('notification_type', 'race_started')
              .maybeSingle();

            if (!existingStarted && allUsers) {
              const admin = getSupabaseAdminClient();
              const notificationPayload = allUsers.map(user => ({
                user_id: user.id,
                race_id: race.id,
                race_name: race.name,
                course: meet.course,
                notification_type: 'race_started',
                message: `🏁 ${meet.course} - ${race.name} has started!`,
                read_at: null,
              }));

              // Save core race details to race_history for historical record
              try {
                // Prefer saving the richer runner list (with status) when available
                const historyPayload = [{
                  meet_id: meet.meet_id,
                  race_id: race.id,
                  race_name: race.name,
                  course: meet.course,
                  race_time: raceTime.toISOString(),
                  runners: Array.isArray(currentRunnersWithStatus) && currentRunnersWithStatus.length ? currentRunnersWithStatus : (Array.isArray(race.runners) ? race.runners : []),
                }];
                const { data: histData, error: histError } = await admin
                  .from('race_history')
                  .upsert(historyPayload, { onConflict: 'meet_id,race_id' });
                if (histError) {
                  console.error('Failed to upsert race_history for started race:', histError, { sample: historyPayload[0] });
                } else {
                  console.log(`Saved race_history for race ${race.id} (meet ${meet.meet_id})`);
                }
              } catch (e) {
                console.error('race_history insert exception:', e);
              }
              
              // Attempt to persist market results for this race immediately (server-side)
              try {
                const marketResults = await fetchMarketResults([race.id]);
                if (Array.isArray(marketResults) && marketResults.length) {
                  const rows: any[] = [];
                  const raceRes = marketResults[0];

                  // Attempt to resolve runner names for this market so we store names where possible
                  let runnerMap: Record<string, string> = {};
                  try {
                    const runners = await fetchMarketRunners(race.id);
                    runnerMap = (runners || []).reduce((acc: Record<string, string>, r: any) => {
                      if (r && r.id) acc[String(r.id)] = r.name || acc[String(r.id)] || '';
                      return acc;
                    }, {});
                  } catch (e) {
                    console.error('Failed to fetch market runners for', race.id, e);
                  }

                  if (raceRes && raceRes.winnerId) {
                    rows.push({ meet_id: meet.meet_id, race_id: race.id, horse_id: raceRes.winnerId, horse_name: runnerMap[String(raceRes.winnerId)] || null, finishing_position: 1, result_date: new Date().toISOString() });
                  }
                  if (raceRes && raceRes.secondId) rows.push({ meet_id: meet.meet_id, race_id: race.id, horse_id: raceRes.secondId, horse_name: runnerMap[String(raceRes.secondId)] || null, finishing_position: 2, result_date: new Date().toISOString() });
                  if (raceRes && raceRes.thirdId) rows.push({ meet_id: meet.meet_id, race_id: race.id, horse_id: raceRes.thirdId, horse_name: runnerMap[String(raceRes.thirdId)] || null, finishing_position: 3, result_date: new Date().toISOString() });

                  if (rows.length) {
                    try {
                      const { error: upsertErr } = await admin.from('race_results').upsert(rows, { onConflict: 'meet_id,race_id,horse_id' });
                      if (upsertErr) console.error('Failed to upsert race_results from cron:', upsertErr);
                      else console.log(`Persisted ${rows.length} race_results for race ${race.id}`);
                    } catch (e) {
                      console.error('Exception upserting race_results from cron:', e);
                    }

                    // Recalculate scores for the meet
                    try {
                      await admin.rpc('recalculate_scores_for_meet', { target_meet_id: meet.meet_id });
                      console.log(`Recalculated scores for meet ${meet.meet_id} (cron)`);
                    } catch (err) {
                      console.error('Failed to recalculate scores from cron for meet', meet.meet_id, err);
                    }
                  }
                }
              } catch (e) {
                console.error('Failed to fetch/persist market results from cron for race', race.id, e);
              }

              const { data: upsertData2, error: upsertError2 } = await admin
                .from('notifications')
                .upsert(notificationPayload, { onConflict: 'user_id,race_id,notification_type' });
              if (upsertError2) {
                console.error('Failed to upsert race_started notifications:', upsertError2, { sample: notificationPayload && notificationPayload[0] });
              } else {
                const upsertCount2 = Array.isArray(upsertData2 as any) ? (upsertData2 as any).length : 0;
                console.log(`Upserted ${upsertCount2} race_started notifications for race ${race.id}`);
              }
            }
          }
        }
      } catch (err) {
        console.error(`Error fetching races for ${meet.course}:`, err);
        continue;
      }
    }

    // Send emails in batches when Resend is configured.
    let sentCount = 0;
    if (canSendEmail && resend) {
      const emailPromises = remindersToSend.map(reminder =>
        resend.emails.send({
          from: resendFromEmail,
          to: reminder.email,
          subject: `🏇 Race Starting in 5 Minutes: ${reminder.course} - ${reminder.raceName}`,
          html: `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
              <h2>Race Starting Soon!</h2>
              <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
                <p style="margin: 0 0 10px 0;"><strong>Course:</strong> ${reminder.course}</p>
                <p style="margin: 0 0 10px 0;"><strong>Race:</strong> ${reminder.raceName}</p>
                <p style="margin: 0;"><strong>Time:</strong> ${reminder.raceTime.toLocaleTimeString('en-AU', {
                  hour: '2-digit',
                  minute: '2-digit',
                  hour12: false
                })}</p>
              </div>
              <p style="color: #666;">Get ready - this race starts in approximately 5 minutes!</p>
              <p style="margin: 0 0 10px 0;">
                <a href="https://thetoppunter.com" style="color: #2563eb; text-decoration: none;">Open The Top Punter</a>
              </p>
              <p style="color: #999; font-size: 12px;">
                You're receiving this because you're registered for The Top Punter.
              </p>
            </div>
          `,
        })
      );

      const results = await Promise.allSettled(emailPromises);
      sentCount = results.filter(r => r.status === 'fulfilled').length;
    }

    return Response.json({
      success: true,
      remindersProcessed: remindersToSend.length,
      emailsSent: sentCount,
      emailProviderConfigured: canSendEmail,
      timestamp: new Date().toISOString(),
    });

    // Periodic backfill: resolve missing horse_name values in race_results
    try {
      const admin = supabase; // admin client
      const { data: lastBackfillRow } = await admin.from('app_settings').select('value').eq('key', 'last_backfill_at').maybeSingle();
      const lastBackfillValue = lastBackfillRow?.value ?? null;
      const lastBackfill = lastBackfillValue ? new Date(String(lastBackfillValue)) : null;
      const lastBackfillTs = lastBackfill ? lastBackfill.getTime() : 0;
      const shouldBackfill = lastBackfill === null || (Date.now() - lastBackfillTs) >= BACKFILL_INTERVAL_MINUTES * 60 * 1000;
      if (shouldBackfill) {
        console.log('Running periodic backfill of race_results horse_name...');
        const { data: missingRows, error: missErr } = await admin
          .from('race_results')
          .select('id,meet_id,race_id,horse_id')
          .is('horse_name', null)
          .limit(BACKFILL_BATCH_SIZE);

        if (missErr) {
          console.error('Backfill: failed to query missing race_results rows', missErr);
        } else if (Array.isArray(missingRows) && missingRows.length) {
          const byRace: Record<string, any[]> = {};
          for (const r of missingRows) {
            if (!r?.race_id) continue;
            byRace[r.race_id] = byRace[r.race_id] || [];
            byRace[r.race_id].push(r);
          }

          let updatedCount = 0;
          for (const raceId of Object.keys(byRace)) {
            try {
              const runners = await fetchMarketRunners(raceId);
              const runnerMap: Record<string, string> = {};
              (runners || []).forEach((rr: any) => { if (rr?.id) runnerMap[String(rr.id)] = rr.name || ''; });

              for (const r of byRace[raceId]) {
                const name = runnerMap[String(r.horse_id)];
                if (name) {
                  const { error: upErr } = await admin.from('race_results').update({ horse_name: name }).eq('id', r.id);
                  if (!upErr) updatedCount++;
                  else console.error('Backfill: failed to update race_result id', r.id, upErr);
                }
              }
            } catch (e) {
              console.error('Backfill: failed for race', raceId, e);
            }
          }

          // record last_backfill_at
          try {
            await admin.from('app_settings').upsert({ key: 'last_backfill_at', value: new Date().toISOString() }, { onConflict: 'key' });
            console.log(`Backfill completed. Rows processed: ${missingRows.length}, updated: ${updatedCount}`);
          } catch (e) {
            console.error('Backfill: failed to persist last_backfill_at', e);
          }
        } else {
          // still update last_backfill_at to avoid repeated empty checks
          try { await admin.from('app_settings').upsert({ key: 'last_backfill_at', value: new Date().toISOString() }, { onConflict: 'key' }); } catch (e) { /* ignore */ }
        }
      }
    } catch (e) {
      console.error('Periodic backfill error:', e);
    }
  } catch (error) {
    console.error('Race reminder error:', error);
    return Response.json(
      { error: 'Failed to process race reminders' },
      { status: 500 }
    );
  }
}

// Health check endpoint
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }

  return Response.json({
    status: 'ready',
    timestamp: new Date().toISOString(),
  });
}
