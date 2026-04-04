import { Resend } from 'resend';
import { getSupabaseClient } from '../../../lib/supabase';
import { getSupabaseAdminClient } from '../../../lib/supabaseAdmin';
import { fetchRacesForCourse } from '../../../lib/betfair';
import { fetchMarketResults } from '../../../lib/theracingapi';

export const maxDuration = 60;

// Configurable reminder windows (minutes)
const REMINDER_MINUTES = Number(process.env.RACE_REMINDER_MINUTES || '5');
const STARTED_WINDOW_MINUTES = Number(process.env.RACE_STARTED_WINDOW_MINUTES || '2');

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
                const historyPayload = [{
                  meet_id: meet.meet_id,
                  race_id: race.id,
                  race_name: race.name,
                  course: meet.course,
                  race_time: raceTime.toISOString(),
                  runners: Array.isArray(race.runners) ? race.runners : [],
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
                  if (raceRes && raceRes.winnerId) {
                    rows.push({ meet_id: meet.meet_id, race_id: race.id, horse_id: raceRes.winnerId, horse_name: raceRes.winnerName ?? null, finishing_position: 1, result_date: new Date().toISOString() });
                  }
                  if (raceRes && raceRes.secondId) rows.push({ meet_id: meet.meet_id, race_id: race.id, horse_id: raceRes.secondId, horse_name: raceRes.secondName ?? null, finishing_position: 2, result_date: new Date().toISOString() });
                  if (raceRes && raceRes.thirdId) rows.push({ meet_id: meet.meet_id, race_id: race.id, horse_id: raceRes.thirdId, horse_name: raceRes.thirdName ?? null, finishing_position: 3, result_date: new Date().toISOString() });

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
