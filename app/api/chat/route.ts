import { getSupabaseClient } from '../../../lib/supabase';
import { getMentionedUsers } from './mention-utils';
import { sendMentionEmail } from './email-utils';

export const maxDuration = 30;

export async function GET() {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('chat_messages')
    .select('id, user_id, username, message, created_at')
    .order('created_at', { ascending: true });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ messages: data });
}

export async function POST(request: Request) {
  const supabase = getSupabaseClient();
  const { user_id, username, message } = await request.json();
  if (!user_id || !username || !message) {
    return Response.json({ error: 'Missing fields' }, { status: 400 });
  }
  const { error } = await supabase
    .from('chat_messages')
    .insert([{ user_id, username, message }]);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  // --- Mention logic ---
  const mentionedUsers = await getMentionedUsers(message);
  for (const user of mentionedUsers) {
    // Send email
    if (user.email) {
      await sendMentionEmail(user.email, username, message);
    }
    // In-app notification (provide all required fields)
    await supabase.from('notifications').insert({
      user_id: user.id,
      race_id: 'chat',
      race_name: 'Chat',
      course: 'Chat',
      notification_type: 'race_started', // Use allowed value, or add 'chat' to allowed types in schema if desired
      message: `You were mentioned in chat by @${username}: ${message}`,
    });
  }

  return Response.json({ success: true });
}
