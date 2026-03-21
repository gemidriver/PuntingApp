import { Resend } from 'resend';
import { getSupabaseClient } from '../../../lib/supabase';
import { fetchRacesForCourse } from '../../../lib/betfair';

export const maxDuration = 60;

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

    const supabase = getSupabaseClient();

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
    const fiveMinutesFromNow = new Date(now.getTime() + 5 * 60 * 1000);
    const twoMinutesAgo = new Date(now.getTime() - 2 * 60 * 1000);
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
                const notificationPayload = allUsers.map(user => ({
                  user_id: user.id,
                  race_id: race.id,
                  race_name: race.name,
                  course: meet.course,
                  notification_type: 'race_starting_soon',
                  message: `${meet.course} - ${race.name} starts in 5 minutes!`,
                }));

                await supabase
                  .from('notifications')
                  .upsert(notificationPayload, { onConflict: 'user_id,race_id,notification_type' })
                  .throwOnError();
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
              // Create in-app notifications for "race started"
              const notificationPayload = allUsers.map(user => ({
                user_id: user.id,
                race_id: race.id,
                race_name: race.name,
                course: meet.course,
                notification_type: 'race_started',
                message: `🏁 ${meet.course} - ${race.name} has started!`,
              }));

              await supabase
                .from('notifications')
                .upsert(notificationPayload, { onConflict: 'user_id,race_id,notification_type' })
                .throwOnError();
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
              <p style="color: #999; font-size: 12px;">
                You're receiving this because you're registered for Braddo's Punting.
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
