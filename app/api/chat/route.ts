import { getSupabaseAdminClient } from '../../../lib/supabaseAdmin';
import { getMentionedUsers } from './mention-utils';
import { sendMentionEmail } from './email-utils';

export const maxDuration = 30;

export async function GET() {
  try {
    const supabase = getSupabaseAdminClient();
    const { data, error } = await supabase
      .from('chat_messages')
      .select('id, user_id, username, message, created_at')
      .order('created_at', { ascending: true });
    if (error) {
      console.error('GET /api/chat supabase error:', error.message);
      return Response.json({ error: error.message }, { status: 500 });
    }
    return Response.json({ messages: data });
  } catch (err: any) {
    console.error('GET /api/chat exception:', err?.message ?? err);
    return Response.json({ error: String(err?.message ?? err) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const supabase = getSupabaseAdminClient();
    const { user_id, username, message } = await request.json();
    if (!user_id || !username || !message) {
      return Response.json({ error: 'Missing fields' }, { status: 400 });
    }
    const { error } = await supabase
      .from('chat_messages')
      .insert([{ user_id, username, message }]);
    if (error) {
      console.error('POST /api/chat insert error:', error.message);
      return Response.json({ error: error.message }, { status: 500 });
    }

  // --- Mention logic ---
  const mentionedUsers = await getMentionedUsers(message);
    for (const user of mentionedUsers) {
    // Log user.id and notification payload for debugging
    const notificationPayload = {
      user_id: user.id,
      race_id: 'chat',
      race_name: 'Chat',
      course: 'Chat',
      notification_type: 'chat',
        message: `You were mentioned in chat by @${username}: ${message}`,
        // ensure the notification is treated as unread when upserting
        read_at: null,
        created_at: new Date().toISOString(),
    };
    console.log('Attempting to upsert notification:', notificationPayload);
    // Send email
    if (user.email) {
      await sendMentionEmail(user.email, username, message);
    }
    // In-app notification (provide all required fields)
    const { error: notifError } = await supabase.from('notifications')
      .upsert(notificationPayload, { onConflict: 'user_id,race_id,notification_type' });
    if (notifError) {
      console.error('Failed to insert chat notification:', notifError.message);
    }
  }

    // Only broadcast a generic "new chat message" notification to ALL users
    // when the sender used @everyone. Otherwise, only the explicit
    // mentioned users above receive notifications.
    let recipientCount = 0;
    try {
      const isEveryone = /@everyone\b/i.test(message);
      if (isEveryone) {
        const { data: profiles, error: profilesError } = await supabase
          .from('profiles')
          .select('id')
          .neq('id', user_id);

        if (!profilesError && Array.isArray(profiles) && profiles.length) {
          recipientCount = profiles.length;
          const preview = message.length > 120 ? message.slice(0, 117) + '...' : message;
          const rows = profiles.map((p: any) => ({
            user_id: p.id,
            race_id: 'chat',
            race_name: 'Chat',
            course: 'Chat',
            notification_type: 'chat',
            message: `New chat message from @${username}: ${preview}`,
            read_at: null,
            created_at: new Date().toISOString(),
          }));
          const { data: upserted, error: upsertAllError } = await supabase.from('notifications').upsert(rows, { onConflict: 'user_id,race_id,notification_type' }).select('*');
          if (upsertAllError) {
            console.error('Failed to upsert chat notifications for users:', upsertAllError.message);
          } else {
            console.log(`Upserted ${Array.isArray(upserted) ? upserted.length : 0} chat notification rows for ${profiles.length} recipients.`);
          }
        }
      } else {
        console.log('Skipping broadcast notifications: no @everyone found in message.');
      }
    } catch (err) {
      console.error('Error creating chat notifications for users:', err);
    }

    return Response.json({ success: true, recipients: recipientCount });
  } catch (err: any) {
    console.error('POST /api/chat exception:', err?.message ?? err);
    return Response.json({ error: String(err?.message ?? err) }, { status: 500 });
  }
}
